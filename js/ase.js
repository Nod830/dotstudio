// .aseprite / .ase 파일 읽기 · 쓰기
// 형식: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
// 쓰기는 RGBA(32비트)로 저장하고, 읽기는 RGBA · 그레이스케일 · 인덱스 파일을 모두 RGBA로 바꿔 읽는다.

async function zlibCompress(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function zlibDecompress(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class ByteWriter {
  constructor() { this.buf = new Uint8Array(1024); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  byte(v) { this.ensure(1); this.buf[this.len++] = v & 255; }
  word(v) { this.byte(v); this.byte(v >> 8); }
  short(v) { this.word(v & 0xffff); }
  dword(v) { this.word(v & 0xffff); this.word((v >>> 16) & 0xffff); }
  zeros(n) { this.ensure(n); this.len += n; }
  bytes(u8) { this.ensure(u8.length); this.buf.set(u8, this.len); this.len += u8.length; }
  string(s) { const u = new TextEncoder().encode(s); this.word(u.length); this.bytes(u); }
  setDword(at, v) { const d = new DataView(this.buf.buffer); d.setUint32(at, v >>> 0, true); }
  result() { return this.buf.slice(0, this.len); }
}

const AseFile = {
  // ---------- 쓰기 ----------
  async write(sprite, palette) {
    const s = sprite;
    if (!palette.length) palette = [[0, 0, 0, 255]];
    const tilesets = s.tilesets();
    const out = new ByteWriter();

    // 헤더 (128바이트)
    out.dword(0);            // 파일 크기 (나중에 채움)
    out.word(0xa5e0);
    out.word(s.frames.length);
    out.word(s.width);
    out.word(s.height);
    out.word(32);            // RGBA
    out.dword(1);            // 레이어 투명도 값 유효
    out.word(100);           // (안 씀) 속도
    out.dword(0); out.dword(0);
    out.byte(0);             // 투명 인덱스
    out.zeros(3);
    out.word(Math.min(256, palette.length));
    out.byte(1); out.byte(1); // 픽셀 비율
    out.short(0); out.short(0);
    out.word(16); out.word(16); // 격자
    out.zeros(84);

    for (let f = 0; f < s.frames.length; f++) {
      const chunks = [];
      const chunk = (type, fill) => {
        const w = new ByteWriter();
        fill(w);
        chunks.push({ type, data: w.result() });
      };

      if (f === 0) {
        chunk(0x2007, w => { w.word(1); w.word(0); w.dword(0); w.zeros(8); }); // sRGB
        chunk(0x2019, w => {
          w.dword(palette.length); w.dword(0); w.dword(Math.max(0, palette.length - 1)); w.zeros(8);
          for (const c of palette) { w.word(0); w.byte(c[0]); w.byte(c[1]); w.byte(c[2]); w.byte(255); }
        });
        for (let i = 0; i < tilesets.length; i++) {
          const ts = tilesets[i];
          const strip = new Uint8Array(ts.tileW * ts.tileH * 4 * ts.tiles.length);
          ts.tiles.forEach((t, k) => strip.set(t.data, k * t.data.length));
          const z = await zlibCompress(strip);
          chunk(0x2023, w => {
            w.dword(i); w.dword(2 | 4); w.dword(ts.tiles.length);
            w.word(ts.tileW); w.word(ts.tileH); w.short(1); w.zeros(14);
            w.string(ts.name || '타일셋');
            w.dword(z.length); w.bytes(z);
          });
        }
        for (const l of s.layers) {
          chunk(0x2004, w => {
            w.word((l.visible ? 1 : 0) | (l.locked ? 0 : 2) | (l.reference ? 64 : 0));
            w.word(l.tileset ? 2 : 0);
            w.word(0);           // 그룹 단계
            w.word(0); w.word(0);
            w.word(0);           // 블렌드: 일반
            w.byte(l.opacity);
            w.zeros(3);
            w.string(l.name);
            if (l.tileset) w.dword(tilesets.indexOf(l.tileset));
          });
        }
        if (s.tags.length) {
          chunk(0x2018, w => {
            w.word(s.tags.length); w.zeros(8);
            for (const t of s.tags) {
              const rgb = hexToColor(t.color) || [0, 0, 0];
              w.word(t.from); w.word(t.to);
              w.byte({ forward: 0, reverse: 1, pingpong: 2 }[t.direction] || 0);
              w.word(0); w.zeros(6);
              w.byte(rgb[0]); w.byte(rgb[1]); w.byte(rgb[2]); w.byte(0);
              w.string(t.name);
            }
          });
          // 태그 색 (새 형식): 태그마다 사용자 데이터 청크 하나
          for (const t of s.tags) {
            const rgb = hexToColor(t.color) || [0, 0, 0];
            chunk(0x2020, w => { w.dword(2); w.byte(rgb[0]); w.byte(rgb[1]); w.byte(rgb[2]); w.byte(255); });
          }
        }
      }

      for (let li = 0; li < s.layers.length; li++) {
        const l = s.layers[li], cel = l.cels[f];
        // 앞 프레임과 같은 셀이면 링크로 저장한다 (빈 셀이면 아무것도 쓰지 않음)
        const first = l.cels.indexOf(cel);
        if (first < f) {
          if (!cel.empty || (l.tileset && cel.map.some(v => v))) {
            chunk(0x2005, w => { w.word(li); w.short(0); w.short(0); w.byte(255); w.word(1); w.short(0); w.zeros(5); w.word(first); });
          }
          continue;
        }
        if (l.tileset) {
          if (!cel.map.some(v => v)) continue;
          const { cols, rows } = s.tileGrid(l.tileset);
          const tilesLE = new Uint8Array(cel.map.length * 4);
          const dv = new DataView(tilesLE.buffer);
          cel.map.forEach((v, i) => dv.setUint32(i * 4, v, true));
          const z = await zlibCompress(tilesLE);
          chunk(0x2005, w => {
            w.word(li); w.short(0); w.short(0); w.byte(255); w.word(3); w.short(0); w.zeros(5);
            w.word(cols); w.word(rows); w.word(32);
            w.dword(0x1fffffff); w.dword(0x80000000); w.dword(0x40000000); w.dword(0x20000000);
            w.zeros(10);
            w.bytes(z);
          });
          continue;
        }
        // 그림이 있는 부분만 잘라서 저장
        const b = this.contentBounds(cel.image);
        if (!b) continue;
        const crop = new Uint8Array(b.w * b.h * 4);
        for (let y = 0; y < b.h; y++) {
          const from = ((b.y + y) * s.width + b.x) * 4;
          crop.set(cel.image.data.subarray(from, from + b.w * 4), y * b.w * 4);
        }
        const z = await zlibCompress(crop);
        chunk(0x2005, w => {
          w.word(li); w.short(b.x); w.short(b.y); w.byte(255); w.word(2); w.short(0); w.zeros(5);
          w.word(b.w); w.word(b.h);
          w.bytes(z);
        });
      }

      const frameStart = out.len;
      out.dword(0);
      out.word(0xf1fa);
      out.word(Math.min(chunks.length, 0xffff));
      out.word(s.frames[f].duration);
      out.zeros(2);
      out.dword(chunks.length);
      for (const c of chunks) {
        out.dword(c.data.length + 6);
        out.word(c.type);
        out.bytes(c.data);
      }
      out.setDword(frameStart, out.len - frameStart);
    }
    out.setDword(0, out.len);
    return out.result();
  },

  contentBounds(img) {
    let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
    const d = img.data;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      if (!d[(y * img.w + x) * 4 + 3]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  },

  // ---------- 읽기 ----------
  async read(buffer) {
    const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
    let p = 0;
    const byte = () => dv.getUint8(p++);
    const word = () => { const v = dv.getUint16(p, true); p += 2; return v; };
    const short = () => { const v = dv.getInt16(p, true); p += 2; return v; };
    const dword = () => { const v = dv.getUint32(p, true); p += 4; return v; };
    const string = () => { const n = word(); const s = new TextDecoder().decode(u8.subarray(p, p + n)); p += n; return s; };

    if (buffer.byteLength < 128 || dv.getUint16(4, true) !== 0xa5e0) throw new Error('Aseprite 파일이 아니에요.');
    p = 6;
    const nFrames = word(), W = word(), H = word(), depth = word(), headerFlags = dword();
    p = 28;
    const transparentIndex = byte();
    if (![8, 16, 32].includes(depth)) throw new Error('지원하지 않는 색 깊이예요.');
    p = 128;

    let palette = [];
    let newPaletteSeen = false;
    const layers = [], tags = [], tilesets = [], frames = [];
    const cels = []; // { frame, layer, x, y, opacity, kind, w, h, data, link, tile }
    let tagQueue = [];

    for (let f = 0; f < nFrames; f++) {
      const frameStart = p;
      const frameBytes = dword();
      if (word() !== 0xf1fa) throw new Error('프레임 정보가 망가졌어요.');
      const oldChunks = word();
      const duration = word();
      p += 2;
      const newChunks = dword();
      const nChunks = newChunks || oldChunks;
      frames.push({ duration: duration || 100 });

      for (let k = 0; k < nChunks; k++) {
        const chunkStart = p;
        const size = dword(), type = word(), end = chunkStart + size;
        // 사용자 데이터 청크는 바로 앞의 태그들에 순서대로 붙는다
        if (type !== 0x2020 && type !== 0x2018) tagQueue = [];

        if (type === 0x2019) {
          newPaletteSeen = true;
          const total = dword(), first = dword(), last = dword();
          p += 8;
          palette.length = Math.max(palette.length, total);
          for (let i = first; i <= last; i++) {
            const flags = word();
            palette[i] = [byte(), byte(), byte(), byte()];
            if (flags & 1) string();
          }
        } else if ((type === 0x0004 || type === 0x0011) && !newPaletteSeen) {
          const packets = word();
          let idx = 0;
          for (let i = 0; i < packets; i++) {
            idx += byte();
            const n = byte() || 256;
            for (let j = 0; j < n; j++, idx++) {
              let r = byte(), g = byte(), b = byte();
              if (type === 0x0011) { r = r * 255 / 63 | 0; g = g * 255 / 63 | 0; b = b * 255 / 63 | 0; }
              palette[idx] = [r, g, b, 255];
            }
          }
        } else if (type === 0x2004) {
          const flags = word(), ltype = word(), level = word();
          p += 4;
          word(); // 블렌드 (일반만 지원)
          const opacity = byte();
          p += 3;
          const name = string();
          const tilesetIndex = ltype === 2 ? dword() : -1;
          layers.push({ flags, type: ltype, level, opacity: (headerFlags & 1) ? opacity : 255, name, tilesetIndex });
        } else if (type === 0x2005) {
          const layer = word(), x = short(), y = short(), opacity = byte(), kind = word();
          short(); p += 5;
          const cel = { frame: f, layer, x, y, opacity, kind };
          if (kind === 0) {
            cel.w = word(); cel.h = word();
            cel.data = u8.slice(p, end);
          } else if (kind === 1) {
            cel.link = word();
          } else if (kind === 2) {
            cel.w = word(); cel.h = word();
            cel.data = await zlibDecompress(u8.subarray(p, end));
          } else if (kind === 3) {
            cel.w = word(); cel.h = word();
            const bits = word(), idMask = dword();
            dword(); dword(); dword(); p += 10;
            cel.tile = { bits, idMask };
            cel.data = await zlibDecompress(u8.subarray(p, end));
          }
          cels.push(cel);
        } else if (type === 0x2018) {
          const n = word();
          p += 8;
          tagQueue = [];
          for (let i = 0; i < n; i++) {
            const from = word(), to = word(), dir = byte();
            word(); p += 6;
            const r = byte(), g = byte(), b = byte();
            p += 1;
            const name = string();
            const t = { name, from, to, direction: ['forward', 'reverse', 'pingpong', 'pingpong'][dir] || 'forward', color: colorToHex([r, g, b]) };
            tags.push(t);
            tagQueue.push(t);
          }
        } else if (type === 0x2020) {
          const flags = dword();
          if (flags & 1) string();
          const target = tagQueue.shift();
          if (flags & 2 && target) {
            const c = [byte(), byte(), byte()];
            target.color = colorToHex(c);
          }
        } else if (type === 0x2023) {
          const id = dword(), flags = dword(), n = dword(), tw = word(), th = word();
          short(); p += 14;
          const name = string();
          if (flags & 1) p += 8;
          let data = null;
          if (flags & 2) { const len = dword(); data = await zlibDecompress(u8.subarray(p, p + len)); }
          tilesets[id] = { n, tw, th, name, data, emptyZero: !!(flags & 4) };
        }
        p = end;
      }
      p = frameStart + frameBytes;
    }

    // ---------- 우리 형식으로 바꾸기 ----------
    for (let i = 0; i < palette.length; i++) if (!palette[i]) palette[i] = [0, 0, 0, 255];
    const isBg = l => !!(l.flags & 8);
    // 픽셀 한 칸을 RGBA로
    const decode = (data, i, layerInfo) => {
      if (depth === 32) return [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
      if (depth === 16) { const v = data[i * 2]; return [v, v, v, data[i * 2 + 1]]; }
      const idx = data[i];
      if (idx === transparentIndex && !isBg(layerInfo)) return TRANSPARENT;
      const c = palette[idx] || [0, 0, 0, 255];
      return [c[0], c[1], c[2], c[3] === undefined ? 255 : c[3]];
    };

    const s = new Sprite(W, H);
    s.frames = frames;
    s.tags = tags.map(t => ({ ...t, to: Math.min(t.to, nFrames - 1) }));
    s.colorMode = depth === 8 ? 'indexed' : 'rgb';

    const sets = tilesets.map(t => {
      if (!t) return null;
      const ts = new Tileset(t.tw, t.th);
      ts.name = t.name;
      ts.tiles = [];
      const tileLen = t.tw * t.th;
      for (let k = 0; k < t.n; k++) {
        const img = new PixelImage(t.tw, t.th);
        if (t.data) for (let i = 0; i < tileLen; i++) {
          const off = k * tileLen;
          img.set(i % t.tw, (i / t.tw) | 0, decode(t.data, off + i, { flags: 0 }));
        }
        ts.tiles.push(img);
      }
      if (!ts.tiles.length) ts.tiles.push(new PixelImage(t.tw, t.th));
      return ts;
    });

    // 그룹 레이어는 펼치고, 그룹이 숨겨져 있으면 안의 레이어도 숨긴다
    const stack = [], layerMap = [];
    for (const info of layers) {
      stack[info.level] = info;
      stack.length = info.level + 1;
      const parentsVisible = stack.slice(0, info.level).every(g => g.flags & 1);
      if (info.type === 1) { layerMap.push(-1); continue; }
      const ts = info.type === 2 ? sets[info.tilesetIndex] || null : null;
      const l = s.newLayer(info.name, ts);
      l.visible = !!(info.flags & 1) && parentsVisible;
      l.locked = !(info.flags & 2);
      l.reference = !!(info.flags & 64);
      l.opacity = info.opacity;
      l.info = info;
      layerMap.push(s.layers.length);
      s.layers.push(l);
    }
    if (!s.layers.length) s.layers.push(s.newLayer('레이어 1'));

    const placed = new Map(); // "layer:frame" → 파일의 셀
    for (const c of cels) {
      const li = layerMap[c.layer];
      if (li === undefined || li < 0) continue;
      const layer = s.layers[li];
      if (!layer.cels[c.frame]) continue;
      if (c.kind === 1) continue;
      placed.set(li + ':' + c.frame, c);
      const cel = layer.cels[c.frame];
      if (c.kind === 3 && layer.tileset) {
        const ts = layer.tileset, { cols, rows } = s.tileGrid(ts);
        const c0 = Math.round(c.x / ts.tileW), r0 = Math.round(c.y / ts.tileH);
        const bytesPer = c.tile.bits / 8, tdv = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
        for (let r = 0; r < c.h; r++) for (let col = 0; col < c.w; col++) {
          const i = r * c.w + col;
          const v = bytesPer === 4 ? tdv.getUint32(i * 4, true) : bytesPer === 2 ? tdv.getUint16(i * 2, true) : tdv.getUint8(i);
          const id = v & c.tile.idMask;
          const gc = c0 + col, gr = r0 + r;
          if (gc >= 0 && gr >= 0 && gc < cols && gr < rows && id < ts.tiles.length) cel.map[gr * cols + gc] = id;
        }
      } else if (c.kind === 0 || c.kind === 2) {
        const alpha = c.opacity / 255;
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
          const px = decode(c.data, y * c.w + x, layer.info);
          if (!px[3]) continue;
          cel.image.set(c.x + x, c.y + y, alpha < 1 ? [px[0], px[1], px[2], Math.round(px[3] * alpha)] : px);
        }
      }
    }
    // 링크된 셀은 원본 셀을 복사한다
    for (const c of cels) {
      if (c.kind !== 1) continue;
      const li = layerMap[c.layer];
      if (li === undefined || li < 0) continue;
      const layer = s.layers[li], src = layer.cels[c.link], dst = layer.cels[c.frame];
      if (!src || !dst) continue;
      layer.cels[c.frame] = src; // 링크를 그대로 살린다
    }
    for (const l of s.layers) delete l.info;
    for (const ts of s.tilesets()) {
      for (const l of s.layers) if (l.tileset === ts) for (const cel of l.cels) Tilemap.renderCel(l, cel, s);
    }

    const colors = palette.filter((c, i) => !(depth === 8 && i === transparentIndex) && c[3] !== 0).map(c => [c[0], c[1], c[2], 255]);
    return { sprite: s, palette: colors };
  },
};
