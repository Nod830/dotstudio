// 내보내기: PNG · GIF 애니메이션 · 스프라이트 시트(+ Aseprite 형식 JSON)

// 기준점: x는 왼쪽(0)~오른쪽(1), y는 위(0)~아래(1). unity는 Sprite Editor의 Pivot 이름
const PIVOTS = {
  bottom: { x: 0.5, y: 1, unity: 'Bottom Center' },
  center: { x: 0.5, y: 0.5, unity: 'Center' },
  bottomleft: { x: 0, y: 1, unity: 'Bottom Left' },
  topleft: { x: 0, y: 0, unity: 'Top Left' },
};

const Exporter = {
  // 'all' 또는 'tag:번호' → 프레임 번호 목록
  frameList(range) {
    const s = App.sprite;
    if (range && range.startsWith('tag:')) {
      const t = s.tags[+range.slice(4)];
      if (t) return Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i);
    }
    return s.frames.map((_, i) => i);
  },

  // 한 프레임을 scale배로 키운 캔버스. bg를 주면 바탕을 칠한다.
  renderFrame(f, scale = 1, bg = null) {
    const s = App.sprite;
    const fc = document.createElement('canvas');
    fc.width = s.width; fc.height = s.height;
    Editor.drawFrame(fc.getContext('2d'), f, true);
    const c = document.createElement('canvas');
    c.width = s.width * scale; c.height = s.height * scale;
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
    g.imageSmoothingEnabled = false;
    g.drawImage(fc, 0, 0, c.width, c.height);
    return c;
  },

  download(blob, name) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  png(name, scale) {
    this.renderFrame(App.frame, scale).toBlob(b => this.download(b, name + '.png'), 'image/png');
  },

  gifBytes(scale, frames, bg) {
    const s = App.sprite;
    const list = frames.map(f => ({
      pixels: this.renderFrame(f, scale, bg).getContext('2d').getImageData(0, 0, s.width * scale, s.height * scale).data,
      delay: s.frames[f].duration,
    }));
    return encodeGif(s.width * scale, s.height * scale, list);
  },

  gif(name, scale, frames, bg) {
    this.download(new Blob([this.gifBytes(scale, frames, bg)], { type: 'image/gif' }), name + '.gif');
  },

  sheetLayout(n, layout) {
    if (layout === 'vertical') return { cols: 1, rows: n };
    if (layout === 'grid') { const cols = Math.ceil(Math.sqrt(n)); return { cols, rows: Math.ceil(n / cols) }; }
    return { cols: n, rows: 1 };
  },

  sheetSize(n, scale, layout, pad) {
    const s = App.sprite, { cols, rows } = this.sheetLayout(n, layout);
    const cw = s.width * scale, ch = s.height * scale;
    return { cols, rows, cw, ch, w: cols * cw + (cols - 1) * pad, h: rows * ch + (rows - 1) * pad };
  },

  // 시트 캔버스와 Aseprite 형식 JSON을 만든다
  buildSheet(name, scale, frames, layout, pad, pivot = 'bottom') {
    const pv = PIVOTS[pivot] || PIVOTS.bottom;
    const s = App.sprite;
    const L = this.sheetSize(frames.length, scale, layout, pad);
    const c = document.createElement('canvas');
    c.width = L.w; c.height = L.h;
    const g = c.getContext('2d');
    const jsonFrames = [];
    frames.forEach((f, i) => {
      const x = (i % L.cols) * (L.cw + pad), y = Math.floor(i / L.cols) * (L.ch + pad);
      g.drawImage(this.renderFrame(f, scale), x, y);
      jsonFrames.push({
        filename: `${name} ${i}.png`,
        frame: { x, y, w: L.cw, h: L.ch },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: L.cw, h: L.ch },
        sourceSize: { w: L.cw, h: L.ch },
        pivot: { x: pv.x, y: pv.y },
        duration: s.frames[f].duration,
      });
    });
    // 내보낸 프레임 안에 완전히 들어오는 태그만, 시트 안 번호로 바꿔서 넣는다
    const first = frames[0], last = frames[frames.length - 1];
    const frameTags = s.tags
      .filter(t => t.from >= first && t.to <= last)
      .map(t => ({ name: t.name, from: t.from - first, to: t.to - first, direction: t.direction, color: t.color + 'ff' }));
    const json = {
      frames: jsonFrames,
      meta: {
        app: 'DotStudio (도트공방)',
        version: '0.3',
        image: name + '.png',
        format: 'RGBA8888',
        size: { w: L.w, h: L.h },
        scale: String(scale),
        frameTags,
        layers: s.layers.map(l => ({ name: l.name, opacity: l.opacity, blendMode: 'normal' })),
        // Aseprite 슬라이스 형식의 기준점 (픽셀, 프레임 왼쪽 위 기준)
        slices: [{ name: 'pivot', color: '#0000ffff', keys: [{ frame: 0, bounds: { x: 0, y: 0, w: L.cw, h: L.ch }, pivot: { x: Math.round(pv.x * L.cw), y: Math.round(pv.y * L.ch) } }] }],
      },
    };
    return { canvas: c, json };
  },

  sheet(name, scale, frames, layout, pad, withJson, pivot) {
    const { canvas, json } = this.buildSheet(name, scale, frames, layout, pad, pivot);
    canvas.toBlob(b => this.download(b, name + '.png'), 'image/png');
    if (!withJson) return;
    // 브라우저가 연속 다운로드를 막지 않도록 살짝 늦춘다
    setTimeout(() => this.download(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), name + '.json'), 300);
  },
};

// ---------- GIF89a 인코더 ----------
// frames: [{ pixels: RGBA Uint8ClampedArray, delay: ms }]. 알파 128 미만은 투명으로 처리한다.
function encodeGif(w, h, frames) {
  // 1) 팔레트 만들기 (0번은 투명용). 256색을 넘으면 비트를 줄여 색을 합친다.
  let shift = 0, colorIndex, palette;
  const hasTransparent = frames.some(f => { for (let i = 3; i < f.pixels.length; i += 4) if (f.pixels[i] < 128) return true; return false; });
  for (;;) {
    colorIndex = new Map();
    palette = hasTransparent ? [[0, 0, 0]] : [];
    let overflow = false;
    outer: for (const f of frames) {
      const p = f.pixels;
      for (let i = 0; i < p.length; i += 4) {
        if (p[i + 3] < 128) continue;
        const r = (p[i] >> shift) << shift, g = (p[i + 1] >> shift) << shift, b = (p[i + 2] >> shift) << shift;
        const key = (r << 16) | (g << 8) | b;
        if (colorIndex.has(key)) continue;
        if (palette.length >= 256) { overflow = true; break outer; }
        colorIndex.set(key, palette.length);
        palette.push([r, g, b]);
      }
    }
    if (!overflow) break;
    shift++;
  }

  let bits = 1;
  while ((1 << bits) < palette.length) bits++;
  const tableSize = 1 << bits;

  const out = [];
  const byte = v => out.push(v & 255);
  const word = v => { byte(v); byte(v >> 8); };
  const str = s => { for (const ch of s) byte(ch.charCodeAt(0)); };

  str('GIF89a');
  word(w); word(h);
  byte(0xf0 | (bits - 1)); // 전역 색상표 있음, 색 해상도 8비트
  byte(0); byte(0);
  for (let i = 0; i < tableSize; i++) { const c = palette[i] || [0, 0, 0]; byte(c[0]); byte(c[1]); byte(c[2]); }

  // 무한 반복
  byte(0x21); byte(0xff); byte(11); str('NETSCAPE2.0'); byte(3); byte(1); word(0); byte(0);

  const minCode = Math.max(2, bits);
  for (const f of frames) {
    // 그래픽 제어 확장: 다음 프레임 전에 지우기(disposal 2), 투명색 0번
    byte(0x21); byte(0xf9); byte(4);
    byte((2 << 2) | (hasTransparent ? 1 : 0));
    word(Math.max(2, Math.round(f.delay / 10)));
    byte(0); byte(0);

    byte(0x2c); word(0); word(0); word(w); word(h); byte(0);

    const p = f.pixels, idx = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < idx.length; i += 4, j++) {
      if (p[i + 3] < 128) { idx[j] = 0; continue; }
      const key = (((p[i] >> shift) << shift) << 16) | (((p[i + 1] >> shift) << shift) << 8) | ((p[i + 2] >> shift) << shift);
      idx[j] = colorIndex.get(key);
    }
    byte(minCode);
    const data = lzwEncode(idx, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      byte(n);
      for (let k = 0; k < n; k++) out.push(data[i + k]);
    }
    byte(0);
  }
  byte(0x3b);
  return new Uint8Array(out);
}

function lzwEncode(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  let dict = new Map();
  const bytes = [];
  let cur = 0, curBits = 0;
  const emit = code => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { bytes.push(cur & 255); cur >>>= 8; curBits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      dict = new Map();
      codeSize = minCode + 1;
      next = eoi + 1;
    } else {
      if (next >= (1 << codeSize)) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) bytes.push(cur & 255);
  return bytes;
}
