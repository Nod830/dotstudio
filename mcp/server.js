#!/usr/bin/env node
// 도트공방 MCP 서버
//
// Claude Code · Codex 같은 AI 도구가 이 서버에 MCP(stdio)로 붙으면, 서버가 브라우저에 열린
// 도트공방에 명령을 전달하고 결과를 돌려준다. 외부 패키지 없이 Node 기본 모듈만 쓴다.
//
//   AI 도구 ──stdio(JSON-RPC)──> 이 서버 ──HTTP 롱폴링(127.0.0.1)──> 브라우저의 도트공방
//
// 서버는 도트공방 화면도 직접 띄운다: http://localhost:5174
// (node serve.js 로 띄운 5173 화면도 자동으로 연결된다)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.DOTSTUDIO_MCP_PORT || 5174;
const APP_DIR = path.join(__dirname, '..');
const APP_URL = `http://localhost:${PORT}`;
const log = (...a) => process.stderr.write('[dotstudio-mcp] ' + a.join(' ') + '\n');

// ---------- 도구 목록 ----------
const color = { type: 'string', description: 'Color as "#rrggbb", "#rrggbbaa", or "transparent".' };
const target = {
  layer: { type: 'integer', description: 'Layer index (0 = bottom). Defaults to the current layer.' },
  frame: { type: 'integer', description: 'Frame index (0-based). Defaults to the current frame.' },
};
const int = d => ({ type: 'integer', description: d });

const TOOLS = [
  {
    name: 'get_state',
    description: 'Get the document state: size, color mode, layers, frames, tags, palette, current layer/frame, primary/secondary colors and selection. Call this first.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_image',
    description: 'Render a frame as a PNG so you can see the result. Transparent pixels are shown on a checkerboard. Use grid=true to count pixels.',
    inputSchema: {
      type: 'object',
      properties: {
        frame: int('Frame index. Defaults to the current frame.'),
        layer: int('Only render this layer. Omit for all visible layers.'),
        scale: int('Zoom 1-32. Defaults to fit about 512px.'),
        grid: { type: 'boolean', description: 'Draw pixel grid lines (every 8 pixels stronger). Default true when scale >= 8.' },
      },
    },
  },
  {
    name: 'new_sprite',
    description: 'Start a new drawing (replaces the current one; the user can still reopen the old one only if it was saved).',
    inputSchema: {
      type: 'object',
      properties: {
        width: int('1-1024'), height: int('1-1024'),
        background: { type: 'string', description: '"transparent" (default, best for game sprites) or a color like "#ffffff".' },
      },
      required: ['width', 'height'],
    },
  },
  {
    name: 'draw_ascii',
    description: 'Draw pixels from ASCII rows: each character is one pixel, mapped through legend. Characters missing from the legend (e.g. "." or " ") are left untouched; map a character to "transparent" to erase. The easiest way to draw sprites.',
    inputSchema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'string' }, description: 'Rows from top to bottom.' },
        legend: { type: 'object', additionalProperties: { type: 'string' }, description: 'Character → color, e.g. {"#":"#222034","r":"#d95763","w":"#ffffff"}.' },
        x: int('Left position of the first column. Default 0.'),
        y: int('Top position of the first row. Default 0.'),
        ...target,
      },
      required: ['rows', 'legend'],
    },
  },
  {
    name: 'set_pixels',
    description: 'Set individual pixels.',
    inputSchema: {
      type: 'object',
      properties: {
        pixels: {
          type: 'array',
          items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, color }, required: ['x', 'y', 'color'] },
        },
        ...target,
      },
      required: ['pixels'],
    },
  },
  {
    name: 'draw_shape',
    description: 'Draw a pixel-perfect line, rectangle or ellipse (ellipse fits inside the box x1,y1-x2,y2).',
    inputSchema: {
      type: 'object',
      properties: {
        shape: { type: 'string', enum: ['line', 'rect', 'ellipse'] },
        x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' },
        color,
        filled: { type: 'boolean', description: 'Fill rect/ellipse. Default false.' },
        size: int('Brush size 1-16 for outlines. Default 1.'),
        ...target,
      },
      required: ['shape', 'x1', 'y1', 'x2', 'y2', 'color'],
    },
  },
  {
    name: 'fill',
    description: 'Flood fill from a point (like the bucket tool).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer' }, y: { type: 'integer' }, color,
        contiguous: { type: 'boolean', description: 'Only connected area (default true). False replaces that color everywhere in the cel.' },
        ...target,
      },
      required: ['x', 'y', 'color'],
    },
  },
  {
    name: 'clear',
    description: 'Erase a cel, or only a rectangle of it.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' },
        ...target,
      },
    },
  },
  {
    name: 'transform',
    description: 'Flip, rotate 90°, or shift (move) the whole content of a cel.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['flipH', 'flipV', 'rotCW', 'rotCCW', 'shift'] },
        dx: int('For shift: pixels to move right (negative = left).'),
        dy: int('For shift: pixels to move down (negative = up).'),
        ...target,
      },
      required: ['kind'],
    },
  },
  {
    name: 'layer',
    description: 'Add, update, move or delete a layer.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'update', 'delete', 'select'] },
        index: int('Layer index for update/delete/select. For add, the new layer goes above this index (default: above current).'),
        name: { type: 'string' },
        visible: { type: 'boolean' },
        locked: { type: 'boolean' },
        opacity: int('0-255'),
        move_to: int('For update: new index for this layer.'),
      },
      required: ['action'],
    },
  },
  {
    name: 'frame',
    description: 'Add, duplicate, delete, move or select frames, or set frame durations.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'duplicate', 'delete', 'select', 'move', 'duration', 'unlink'] },
        linked: { type: 'boolean', description: 'For duplicate: share the same cels instead of copying (editing one changes both). unlink makes the current frame\'s cel on the given layer independent again.' },
        layer: int('For unlink: layer index (default current).'),
        index: int('Target frame. add/duplicate insert after it (default: current).'),
        to: int('For move: new index.'),
        ms: int('For duration: milliseconds (10-5000).'),
        all: { type: 'boolean', description: 'For duration: apply to all frames.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'tag',
    description: 'Add or remove an animation tag (named frame range such as Idle or Run).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove'] },
        name: { type: 'string' },
        from: int('First frame (0-based).'),
        to: int('Last frame (0-based).'),
        direction: { type: 'string', enum: ['forward', 'reverse', 'pingpong'] },
        color: { type: 'string', description: '#rrggbb' },
        index: int('For remove: tag index.'),
      },
      required: ['action'],
    },
  },
  {
    name: 'palette',
    description: 'Change the palette (preset or custom colors), and/or set the primary/secondary colors shown to the user.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['DawnBringer 32', 'Endesga 32', 'PICO-8', 'Sweetie 16', '게임보이', '흑백 8'] },
        colors: { type: 'array', items: { type: 'string' }, description: 'Custom palette as #rrggbb list.' },
        primary: color,
        secondary: color,
      },
    },
  },
  {
    name: 'apply_effect',
    description: 'Outline, replace a color, or adjust hue/saturation/lightness.',
    inputSchema: {
      type: 'object',
      properties: {
        effect: { type: 'string', enum: ['outline', 'replace', 'adjust'] },
        scope: { type: 'string', enum: ['cel', 'layer', 'all'], description: 'cel = current cel, layer = all frames of current layer, all = everything. Default cel.' },
        color: { type: 'string', description: 'outline color' },
        diagonal: { type: 'boolean', description: 'outline: also fill diagonals' },
        from: { type: 'string', description: 'replace: color to find' },
        to: { type: 'string', description: 'replace: new color' },
        tolerance: int('replace: 0-60 (0 = exact)'),
        hue: int('adjust: -180..180'), saturation: int('adjust: -100..100'), lightness: int('adjust: -100..100'),
        ...target,
      },
      required: ['effect'],
    },
  },
  {
    name: 'history',
    description: 'Undo or redo the last actions (works for both your edits and the user\'s).',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['undo', 'redo'] }, steps: int('Default 1.') },
      required: ['action'],
    },
  },
  {
    name: 'export',
    description: 'Export the drawing. With "path" the file is written there (e.g. a Unity Assets folder); without it the browser downloads it. sheet writes <path>.png and <path>.json (Aseprite JSON with frame rects, durations and tags).',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['aseprite', 'png', 'gif', 'sheet'] },
        path: { type: 'string', description: 'Absolute output path, or relative to the MCP server working directory.' },
        scale: int('1-16, default 1.'),
        frame: int('png: frame index (default current).'),
        tag: { type: 'string', description: 'gif/sheet: only frames of this tag.' },
        layout: { type: 'string', enum: ['horizontal', 'vertical', 'grid'], description: 'sheet layout (default horizontal).' },
        padding: int('sheet: pixels between frames (default 0).'),
        pivot: { type: 'string', enum: ['bottom', 'center', 'bottomleft', 'topleft'], description: 'sheet: pivot written to the JSON (default bottom = feet center).' },
      },
      required: ['format'],
    },
  },
  {
    name: 'open_file',
    description: 'Open an .aseprite/.ase file or an image (PNG/GIF/JPG) from disk as the current drawing.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'import_sheet',
    description: 'Split a sprite sheet image into frames, either by a grid or using an Aseprite JSON file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Sheet image path.' },
        json_path: { type: 'string', description: 'Optional Aseprite JSON with frame rects/durations/tags.' },
        frame_width: int('Grid cell width (needed without json).'),
        frame_height: int('Grid cell height (needed without json).'),
        offset_x: int('default 0'), offset_y: int('default 0'),
        gap_x: int('default 0'), gap_y: int('default 0'),
        order: { type: 'string', enum: ['rows', 'columns'] },
        count: int('Only the first N cells.'),
        duration: int('ms per frame, default 100.'),
        mode: { type: 'string', enum: ['new', 'frames', 'layer'], description: 'new = replace drawing (default), frames = append frames, layer = add as new layer.' },
      },
      required: ['path'],
    },
  },
];
const TOOL_NAMES = new Set(TOOLS.map(t => t.name));

const INSTRUCTIONS = `DotStudio (도트공방) is a pixel-art and sprite-animation editor running in the user's browser.
Coordinates are pixels, 0-based, origin top-left. Layer 0 is the bottom layer; frames are 0-based.
Workflow: call get_state first, draw (draw_ascii is easiest for sprites), then call get_image to check your work and fix mistakes.
Every edit is recorded in the editor's undo history, so the user can undo it.
The editor must be open in a browser: ${APP_URL}`;

// ---------- 브라우저 연결 (롱폴링) ----------
let waiter = null;   // 기다리는 브라우저 요청
const queue = [];    // 아직 전달하지 못한 명령
const pending = new Map();
let nextId = 1, lastPoll = 0;
// 기다리는 중이거나, 방금 명령을 받아 처리 중이면 연결된 것으로 본다
const browserConnected = () => !!waiter || pending.size > 0 || Date.now() - lastPoll < 5000;

function sendToBrowser(name, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('도트공방이 60초 안에 답하지 않았어요. 브라우저 탭이 열려 있는지 확인하세요.'));
    }, 60000);
    pending.set(id, { resolve, timer });
    const cmd = { id, name, args };
    if (waiter) { const w = waiter; waiter = null; w(cmd); } else queue.push(cmd);
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  // 이 컴퓨터의 페이지(localhost · 파일로 연 페이지)만 허용한다
  const origin = req.headers.origin;
  if (origin) {
    if (!/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|null)$/.test(origin)) { res.writeHead(403); return res.end(); }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/mcp/poll') {
    lastPoll = Date.now();
    res.setHeader('Cache-Control', 'no-store');
    if (queue.length) return sendJson(res, queue.shift());
    if (waiter) waiter(null); // 다른 탭이 기다리고 있었으면 비워 준다
    const w = cmd => {
      clearTimeout(timer);
      if (waiter === w) waiter = null;
      if (!cmd) { res.writeHead(204); return res.end(); }
      sendJson(res, cmd);
    };
    const timer = setTimeout(() => w(null), 25000);
    waiter = w;
    res.on('close', () => { clearTimeout(timer); if (waiter === w) waiter = null; lastPoll = Date.now(); });
    return;
  }

  if (url.pathname === '/mcp/result' && req.method === 'POST') {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 80e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      try {
        const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const p = pending.get(msg.id);
        if (p) { clearTimeout(p.timer); pending.delete(msg.id); p.resolve(msg); }
        res.writeHead(200); res.end('ok');
      } catch { res.writeHead(400); res.end(); }
    });
    return;
  }

  // 도트공방 화면 (정적 파일)
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.join(APP_DIR, rel);
  if (!file.startsWith(APP_DIR + path.sep) || file.startsWith(path.join(APP_DIR, 'mcp') + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (MIME[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

function sendJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

let listenError = null;
server.on('error', e => {
  listenError = e.code === 'EADDRINUSE'
    ? `포트 ${PORT}을(를) 이미 다른 프로그램이 쓰고 있어요. 다른 AI 도구가 도트공방 MCP를 먼저 켰을 수 있어요. 그쪽을 끄거나 DOTSTUDIO_MCP_PORT 환경 변수로 포트를 바꾸세요.`
    : String(e.message);
  log(listenError);
});
server.listen(PORT, '127.0.0.1', () => log(`도트공방: ${APP_URL}`));

// ---------- 파일 도우미 ----------
const resolvePath = p => path.resolve(process.cwd(), p);
function readFileArg(p) {
  const full = resolvePath(p);
  if (!fs.existsSync(full)) throw new Error(`파일이 없어요: ${full}`);
  const stat = fs.statSync(full);
  if (stat.size > 50e6) throw new Error('파일이 너무 커요 (최대 50MB).');
  return { name: path.basename(full), base64: fs.readFileSync(full).toString('base64') };
}
function writeOut(base, ext, base64) {
  const full = resolvePath(base.toLowerCase().endsWith(ext) ? base : base + ext);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.from(base64, 'base64'));
  return full;
}

// ---------- 도구 실행 ----------
async function callTool(name, args) {
  if (!TOOL_NAMES.has(name)) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  const fail = text => ({ content: [{ type: 'text', text }], isError: true });
  if (listenError) return fail(listenError);

  // 디스크 파일은 서버가 읽어서 브라우저로 넘긴다
  const payload = { ...args };
  try {
    if (name === 'open_file') payload.file = readFileArg(args.path);
    if (name === 'import_sheet') {
      payload.file = readFileArg(args.path);
      if (args.json_path) payload.json = fs.readFileSync(resolvePath(args.json_path), 'utf8');
    }
  } catch (e) { return fail(e.message); }

  if (!browserConnected()) {
    return fail(`도트공방이 브라우저에 열려 있지 않아요. 사용자에게 ${APP_URL} 을 브라우저로 열어 달라고 요청하세요.`);
  }

  let reply;
  try { reply = await sendToBrowser(name, payload); } catch (e) { return fail(e.message); }
  if (!reply.ok) return fail(reply.error || '실패했어요.');

  const content = [];
  let text = reply.text || '완료';

  // 내보낸 파일을 경로에 쓴다
  if (name === 'export' && reply.files) {
    if (args.path) {
      try {
        const base = args.format === 'sheet' ? resolvePath(args.path).replace(/\.(png|json)$/i, '') : args.path;
        const written = reply.files.map(f => writeOut(base, f.ext, f.base64));
        text += `\n저장한 파일:\n${written.join('\n')}`;
      } catch (e) { return fail('파일을 쓰지 못했어요: ' + e.message); }
    } else {
      text += '\n(path가 없어서 브라우저에서 내려받기로 저장했어요.)';
    }
  }
  content.push({ type: 'text', text });
  if (reply.image) content.push({ type: 'image', data: reply.image, mimeType: 'image/png' });
  return { content };
}

// ---------- MCP (JSON-RPC over stdio) ----------
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function dispatch(method, params) {
  if (method === 'initialize') {
    return {
      protocolVersion: params.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'dotstudio', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS };
  if (method === 'tools/call') return callTool(params.name, params.arguments || {});
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}

async function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  if (msg.id === undefined || msg.id === null) return; // 알림
  try {
    send({ jsonrpc: '2.0', id: msg.id, result: await dispatch(msg.method, msg.params || {}) });
  } catch (e) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));
