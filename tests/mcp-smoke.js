// MCP 서버를 실제 클라이언트처럼 띄워서 확인한다.
// 브라우저에 도트공방(http://localhost:5174 또는 5173)이 열려 있어야 그리기까지 확인된다.
//   node tests/mcp-smoke.js [출력 폴더]
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const outDir = process.argv[2] || path.join(require('node:os').tmpdir(), 'dotstudio-mcp-smoke');
const server = spawn(process.execPath, [path.join(__dirname, '../mcp/server.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', nextId = 1;
const waiting = new Map();
server.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    waiting.get(msg.id)?.(msg);
  }
});
const rpc = (method, params = {}) => new Promise(resolve => {
  const id = nextId++;
  waiting.set(id, resolve);
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) throw new Error(r.error.message);
  const text = r.result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const image = r.result.content.find(c => c.type === 'image');
  console.log(`\n▶ ${name}${r.result.isError ? ' (오류)' : ''}\n${text.slice(0, 400)}${image ? `\n[이미지 ${image.data.length}자]` : ''}`);
  return { ...r.result, text, image };
};

(async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'dotstudio');
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await rpc('tools/list');
  console.log('도구:', list.result.tools.map(t => t.name).join(', '));
  assert.ok(list.result.tools.length >= 15);
  assert.equal((await rpc('nope')).error.code, -32601);

  // 브라우저가 붙을 때까지 기다린다 (롱폴링 재시도 간격 고려)
  let state;
  for (let i = 0; i < 15; i++) {
    state = await call('get_state');
    if (!state.isError) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  if (state.isError) { console.log('\n브라우저가 연결되지 않아 프로토콜 확인까지만 했어요.'); server.kill(); return; }

  await call('new_sprite', { width: 16, height: 16 });
  const slime = await call('draw_ascii', {
    rows: [
      '................',
      '................',
      '.....######.....',
      '...##gggggg##...',
      '..#gggggggggg#..',
      '..#ggwwggwwgg#..',
      '.#gggwkggwkggg#.',
      '.#gggggggggggg#.',
      '.#ggggg##ggggg#.',
      '.#gggggggggggg#.',
      '..############..',
    ],
    legend: { '#': '#222034', g: '#6abe30', w: '#ffffff', k: '#222034' },
    y: 3,
  });
  assert.match(slime.text, /칸이 바뀌었어요/);
  await call('frame', { action: 'duplicate' });
  await call('transform', { kind: 'shift', dy: 1 });
  await call('frame', { action: 'duration', ms: 200, all: true });
  await call('tag', { action: 'add', name: 'Idle', from: 0, to: 1, direction: 'pingpong' });
  await call('apply_effect', { effect: 'adjust', scope: 'cel', hue: 30 });
  await call('history', { action: 'undo' });
  const img = await call('get_image', { frame: 0, grid: true });
  assert.ok(img.image && img.image.data.length > 1000);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'preview.png'), Buffer.from(img.image.data, 'base64'));

  const sheet = await call('export', { format: 'sheet', path: path.join(outDir, 'slime'), padding: 1 });
  assert.ok(fs.existsSync(path.join(outDir, 'slime.png')) && fs.existsSync(path.join(outDir, 'slime.json')));
  const json = JSON.parse(fs.readFileSync(path.join(outDir, 'slime.json'), 'utf8'));
  assert.equal(json.frames.length, 2);
  assert.equal(json.meta.frameTags[0].name, 'Idle');
  await call('export', { format: 'aseprite', path: path.join(outDir, 'slime.aseprite') });
  await call('export', { format: 'gif', path: path.join(outDir, 'slime.gif'), scale: 4 });

  // 다시 열어서 확인
  await call('open_file', { path: path.join(outDir, 'slime.aseprite') });
  await call('import_sheet', { path: path.join(outDir, 'slime.png'), json_path: path.join(outDir, 'slime.json'), mode: 'frames' });
  const after = JSON.parse((await call('get_state')).text);
  assert.equal(after.frames.length, 4);
  assert.equal(after.tags.length, 2);

  // 잘못된 입력은 오류로 돌아온다
  assert.ok((await call('draw_shape', { shape: 'star', x1: 0, y1: 0, x2: 1, y2: 1, color: '#fff' })).isError);
  assert.ok((await call('set_pixels', { pixels: [{ x: 0, y: 0, color: 'red' }] })).isError);

  console.log(`\nPASS: MCP 프로토콜 + 브라우저 왕복. 결과 파일: ${outDir}`);
  server.kill();
})().catch(e => { console.error('FAIL:', e); server.kill(); process.exit(1); });
