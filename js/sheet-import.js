// 스프라이트 시트를 프레임으로 가져온다.
//   칸 나누기: 일정한 크기 · 여백 · 간격으로 자른다
//   JSON: 내보내기에서 만든(또는 Aseprite가 만든) JSON의 칸 위치 · 속도 · 태그를 그대로 쓴다
// 가져오는 방법: 새 그림으로 열기 / 지금 그림 뒤에 프레임으로 붙이기 / 새 레이어로 넣기
const SheetImporter = {
  source: null,
  json: null,
  mode: 'new',
  revision: 0,

  init() {
    document.querySelector('#sheet-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) this.readFile(file);
    });
    document.querySelector('#sheet-json').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) this.readJson(file);
    });
    document.querySelector('#sheet-json-clear').addEventListener('click', () => {
      this.json = null;
      document.querySelector('#sheet-json').value = '';
      this.preview();
    });
    document.querySelectorAll('#dlg-sheet input[type="number"], #sheet-order').forEach(n => {
      n.addEventListener('input', () => this.preview());
    });
    document.querySelectorAll('#sheet-mode button').forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      this.mode = b.dataset.mode;
      this.preview();
    }));
    document.querySelector('#sheet-go').addEventListener('click', () => this.import());
  },

  reset() {
    this.revision++;
    this.source = null;
    this.json = null;
  },

  show() {
    this.reset();
    document.querySelector('#sheet-file').value = '';
    document.querySelector('#sheet-json').value = '';
    document.querySelector('#sheet-source-info').textContent = 'PNG · WebP · JPG, 최대 4096×4096 픽셀. 투명 배경은 PNG를 사용하세요.';
    if (!App.sprite) this.mode = 'new';
    this.preview();
    UI.openModal('#dlg-sheet');
  },

  async readFile(file) {
    this.revision++;
    this.source = null;
    const revision = this.revision;
    this.preview();
    document.querySelector('#sheet-source-info').textContent = '이미지를 읽고 있어요…';
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('이미지를 읽지 못했어요. PNG · WebP · JPG 파일을 선택하세요.'));
        image.src = url;
      });
      if (revision !== this.revision) return;
      if (image.naturalWidth > 4096 || image.naturalHeight > 4096) {
        throw new Error('시트 이미지는 최대 4096×4096 픽셀까지 가져올 수 있어요.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0);
      this.source = { canvas, name: file.name.replace(/\.[^.]+$/, '') };
      document.querySelector('#sheet-source-info').textContent = `${file.name} · ${canvas.width}×${canvas.height} 픽셀`;
      this.preview();
    } catch (e) {
      if (revision !== this.revision) return;
      document.querySelector('#sheet-source-info').textContent = e.message;
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  async readJson(file) {
    try {
      this.json = this.parseJson(await file.text());
      this.json.fileName = file.name;
    } catch (e) {
      this.json = null;
      document.querySelector('#sheet-json').value = '';
      UI.toast('JSON을 읽지 못했어요: ' + e.message);
    }
    this.preview();
  },

  // Aseprite 형식 JSON (array · hash 둘 다)
  parseJson(text) {
    let j;
    try { j = JSON.parse(text); } catch { throw new Error('JSON 형식이 아니에요.'); }
    const list = Array.isArray(j.frames) ? j.frames : j.frames && typeof j.frames === 'object' ? Object.values(j.frames) : null;
    if (!list || !list.length) throw new Error('"frames" 목록이 없어요. 스프라이트 시트 JSON인지 확인하세요.');
    const frames = list.map((f, i) => {
      const r = f.frame;
      if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) throw new Error(`${i + 1}번 프레임의 위치 정보가 없어요.`);
      if (f.rotated) throw new Error('회전해서 담긴 프레임(rotated)은 아직 지원하지 않아요.');
      const src = f.sourceSize || { w: r.w, h: r.h };
      const off = f.spriteSourceSize || { x: 0, y: 0 };
      return { x: r.x, y: r.y, w: r.w, h: r.h, ox: off.x || 0, oy: off.y || 0, sw: src.w, sh: src.h, duration: f.duration || 100 };
    });
    const w = Math.max(...frames.map(f => f.sw)), h = Math.max(...frames.map(f => f.sh));
    if (w > 1024 || h > 1024) throw new Error('프레임 크기는 최대 1024×1024예요.');
    if (frames.length > 1024) throw new Error('한 번에 최대 1024프레임을 가져올 수 있어요.');
    const dirs = { forward: 'forward', reverse: 'reverse', pingpong: 'pingpong', pingpong_reverse: 'pingpong' };
    const tags = ((j.meta && j.meta.frameTags) || [])
      .filter(t => Number.isInteger(t.from) && Number.isInteger(t.to) && t.from <= t.to && t.to < frames.length)
      .map((t, i) => ({
        name: String(t.name || '태그 ' + (i + 1)),
        from: t.from, to: t.to,
        direction: dirs[t.direction] || 'forward',
        color: typeof t.color === 'string' && /^#[0-9a-f]{6}/i.test(t.color) ? t.color.slice(0, 7) : TAG_COLORS[i % TAG_COLORS.length],
      }));
    return { frames, tags, w, h };
  },

  options() {
    const number = id => {
      const value = document.querySelector(id).value;
      return value === '' ? NaN : Number(value);
    };
    return {
      w: number('#sheet-w'), h: number('#sheet-h'),
      x: number('#sheet-x'), y: number('#sheet-y'),
      gapX: number('#sheet-gap-x'), gapY: number('#sheet-gap-y'),
      duration: number('#sheet-duration'), order: document.querySelector('#sheet-order').value,
      count: document.querySelector('#sheet-count').value === '' ? null : number('#sheet-count'),
    };
  },

  // 미리보기와 실제 가져오기에서 같은 좌표/검증을 사용한다.
  layout(width, height, o) {
    if (![o.w, o.h].every(v => Number.isInteger(v) && v >= 1 && v <= 1024)) {
      throw new Error('프레임 가로·세로는 1~1024 사이의 정수로 입력하세요.');
    }
    if (![o.x, o.y, o.gapX, o.gapY].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 4096)) {
      throw new Error('여백과 간격은 0~4096 사이의 정수로 입력하세요.');
    }
    if (!Number.isInteger(o.duration) || o.duration < 1 || o.duration > 65535) {
      throw new Error('프레임 시간은 1~65535ms 사이의 정수로 입력하세요.');
    }
    if (!['rows', 'columns'].includes(o.order)) throw new Error('읽는 순서를 선택하세요.');
    const cols = Math.floor((width - o.x + o.gapX) / (o.w + o.gapX));
    const rows = Math.floor((height - o.y + o.gapY) / (o.h + o.gapY));
    if (cols < 1 || rows < 1) throw new Error('프레임 크기와 여백을 확인하세요. 이미지 안에 온전한 프레임이 없어요.');
    const total = cols * rows, count = o.count === null ? total : o.count;
    if (!Number.isInteger(count) || count < 1 || count > total) {
      throw new Error(`가져올 프레임 수는 1~${total} 사이의 정수로 입력하세요.`);
    }
    if (count > 1024) throw new Error('한 번에 최대 1024프레임을 가져올 수 있어요. 프레임 수를 줄여 주세요.');
    const cells = Array.from({ length: count }, (_, i) => {
      const col = o.order === 'rows' ? i % cols : Math.floor(i / rows);
      const row = o.order === 'rows' ? Math.floor(i / cols) : i % rows;
      return { x: o.x + col * (o.w + o.gapX), y: o.y + row * (o.h + o.gapY) };
    });
    return {
      cols, rows, total, cells,
      remainderX: width - (o.x + cols * (o.w + o.gapX) - o.gapX),
      remainderY: height - (o.y + rows * (o.h + o.gapY) - o.gapY),
    };
  },

  // 시트에서 프레임 그림들을 잘라 낸다 → { w, h, images, durations, tags }
  extract(source, o, json) {
    const g = source.getContext('2d', { willReadFrequently: true });
    if (json) {
      this.extractCheck(source, json);
      const images = json.frames.map(f => {
        const img = new PixelImage(json.w, json.h), part = g.getImageData(f.x, f.y, f.w, f.h).data;
        for (let y = 0; y < f.h; y++) {
          const ty = y + f.oy;
          if (ty < 0 || ty >= json.h) continue;
          for (let x = 0; x < f.w; x++) {
            const tx = x + f.ox;
            if (tx < 0 || tx >= json.w) continue;
            img.data.set(part.subarray((y * f.w + x) * 4, (y * f.w + x) * 4 + 4), (ty * json.w + tx) * 4);
          }
        }
        return img;
      });
      return { w: json.w, h: json.h, images, durations: json.frames.map(f => f.duration), tags: json.tags };
    }
    const grid = this.layout(source.width, source.height, o);
    return {
      w: o.w, h: o.h,
      images: grid.cells.map(cell => new PixelImage(o.w, o.h, g.getImageData(cell.x, cell.y, o.w, o.h).data)),
      durations: grid.cells.map(() => o.duration),
      tags: [],
    };
  },

  split(source, o, json = null) {
    const r = this.extract(source, o, json);
    const sprite = new Sprite(r.w, r.h), layer = new Layer('레이어 1');
    sprite.frames = r.durations.map(duration => ({ duration }));
    layer.cels = r.images.map(img => new Cel(img));
    sprite.tags = r.tags.map(t => ({ ...t }));
    sprite.layers.push(layer);
    return sprite;
  },

  // 프레임 크기가 그림과 다르면 가운데에 맞춰 넣는다 (넘치는 부분은 잘림)
  fit(img, W, H) {
    if (img.w === W && img.h === H) return img;
    const out = new PixelImage(W, H), dx = Math.floor((W - img.w) / 2), dy = Math.floor((H - img.h) / 2);
    for (let y = 0; y < img.h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < img.w; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= W) continue;
        out.data.set(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4), (ty * W + tx) * 4);
      }
    }
    return out;
  },

  // 지금 그림에 더한다 (실행 취소 가능)
  addToSprite(r, mode, name) {
    const s = App.sprite;
    const images = r.images.map(img => this.fit(img, s.width, s.height));
    App.exec(mode === 'frames' ? '시트를 프레임으로 추가' : '시트를 레이어로 추가', sp => {
      if (mode === 'frames') {
        const start = sp.frames.length;
        // 지금 레이어에 넣는다. 타일맵 레이어면 새 레이어를 만든다.
        let target = App.layer;
        if (sp.layers[target].tileset) {
          sp.layers.splice(target + 1, 0, sp.newLayer(name));
          target++;
        }
        images.forEach((img, i) => {
          sp.frames.push({ duration: r.durations[i] });
          sp.layers.forEach((l, li) => l.cels.push(li === target ? new Cel(img) : sp.newCel(l)));
        });
        r.tags.forEach(t => sp.tags.push({ ...t, from: t.from + start, to: t.to + start }));
        App.layer = target;
        App.frame = start;
      } else {
        const layer = new Layer(name);
        while (sp.frames.length < images.length) {
          sp.frames.push({ duration: r.durations[sp.frames.length] });
          sp.layers.forEach(l => l.cels.push(sp.newCel(l)));
        }
        layer.cels = sp.frames.map((_, f) => images[f] ? new Cel(images[f]) : sp.newCel(layer));
        sp.layers.splice(App.layer + 1, 0, layer);
        App.layer++;
        App.frame = 0;
      }
    });
  },

  renderMode() {
    document.querySelectorAll('#sheet-mode button').forEach(b => {
      b.disabled = b.dataset.mode !== 'new' && !App.sprite;
      b.classList.toggle('on', b.dataset.mode === this.mode);
    });
    const s = App.sprite;
    document.querySelector('#sheet-mode-note').textContent = {
      new: '지금 그림은 바뀌고, 실행 취소로 되돌릴 수 없어요. 필요하면 먼저 저장하세요.',
      frames: s ? `지금 그림(${s.width}×${s.height})의 ${s.frames.length}번 프레임 뒤에 붙어요. Ctrl+Z로 되돌릴 수 있어요.` : '',
      layer: s ? `지금 레이어 위에 새 레이어로 들어가요. 프레임이 모자라면 늘어나요. Ctrl+Z로 되돌릴 수 있어요.` : '',
    }[this.mode];
    document.querySelector('#sheet-mode-note').classList.toggle('warn', this.mode === 'new');
  },

  preview() {
    this.renderMode();
    const preview = document.querySelector('#sheet-preview'), g = preview.getContext('2d');
    const result = document.querySelector('#sheet-result'), go = document.querySelector('#sheet-go');
    go.disabled = true;
    result.classList.remove('warn');
    preview.width = preview.height = 0;
    const json = this.json;
    document.querySelector('#sheet-json-info').textContent = json
      ? `${json.fileName} · 프레임 ${json.frames.length}장${json.tags.length ? ` · 태그 ${json.tags.length}개` : ''} · 아래 칸 설정 대신 JSON을 써요`
      : '내보내기에서 시트와 같이 저장한 JSON이 있으면 넣어 주세요. 칸 위치 · 속도 · 태그를 그대로 가져와요.';
    document.querySelector('#sheet-json-clear').hidden = !json;
    document.querySelector('#sheet-grid-fields').classList.toggle('dim', !!json);
    if (!this.source) {
      result.textContent = '이미지를 선택하면 분할 결과를 보여드려요.';
      return;
    }
    // 큰 시트는 줄이고, 작은 픽셀 시트는 정수배로 키워서 자르는 선이 보이게 한다
    const source = this.source.canvas, fit = Math.min(600 / source.width, 280 / source.height);
    const scale = fit >= 1 ? Math.min(8, Math.floor(fit)) : fit;
    preview.width = Math.max(1, Math.round(source.width * scale));
    preview.height = Math.max(1, Math.round(source.height * scale));
    g.imageSmoothingEnabled = false;
    g.drawImage(source, 0, 0, preview.width, preview.height);
    try {
      const o = this.options();
      const sx = preview.width / source.width, sy = preview.height / source.height;
      let rects, text;
      if (json) {
        this.extractCheck(source, json);
        rects = json.frames.map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h }));
        text = `JSON대로 ${json.w}×${json.h} 프레임 ${rects.length}장`;
      } else {
        const grid = this.layout(source.width, source.height, o);
        rects = grid.cells.map(c => ({ x: c.x, y: c.y, w: o.w, h: o.h }));
        text = `${grid.cols}열 × ${grid.rows}행 · ${o.w}×${o.h} 프레임 ${grid.cells.length}장 · ${o.duration}ms`;
        if (grid.remainderX || grid.remainderY) text += ` · 오른쪽 ${grid.remainderX}px / 아래 ${grid.remainderY}px는 제외돼요.`;
        if (grid.cells.length < grid.total) text += ` · 순서대로 앞 ${grid.cells.length}칸만 가져와요.`;
      }
      g.lineWidth = 1;
      g.font = 'bold 11px sans-serif';
      rects.forEach((r, i) => {
        const x = r.x * sx, y = r.y * sy, w = r.w * sx, h = r.h * sy;
        g.strokeStyle = '#75baff';
        g.strokeRect(x + .5, y + .5, Math.max(0, w - 1), Math.max(0, h - 1));
        if (w >= 24 && h >= 18) {
          g.fillStyle = 'rgba(0,0,0,.75)';
          g.fillRect(x + 1, y + 1, g.measureText(String(i + 1)).width + 6, 15);
          g.fillStyle = '#fff';
          g.fillText(String(i + 1), x + 4, y + 12);
        }
      });
      const fw = json ? json.w : o.w, fh = json ? json.h : o.h, s = App.sprite;
      if (this.mode !== 'new' && s && (fw !== s.width || fh !== s.height)) {
        text += ` · 프레임 크기가 그림(${s.width}×${s.height})과 달라서 가운데에 맞춰 넣어요.`;
      }
      result.textContent = text;
      go.disabled = false;
    } catch (e) {
      result.textContent = e.message;
      result.classList.add('warn');
    }
  },

  extractCheck(source, json) {
    for (const f of json.frames) {
      if (f.x < 0 || f.y < 0 || f.x + f.w > source.width || f.y + f.h > source.height) {
        throw new Error('JSON의 칸 위치가 이미지 밖으로 나가요. 같은 시트의 JSON인지 확인하세요.');
      }
    }
  },

  import() {
    if (!this.source) return;
    try {
      const { canvas, name } = this.source;
      if (this.mode === 'new' || !App.sprite) {
        const sprite = this.split(canvas, this.options(), this.json);
        App.fileName = name;
        App.loadSprite(sprite, '스프라이트 시트 가져오기');
        UI.closeModals();
        UI.toast(`가져왔어요: ${sprite.width}×${sprite.height} · 프레임 ${sprite.frames.length}장${sprite.tags.length ? ` · 태그 ${sprite.tags.length}개` : ''}. 타임라인에서 편집하거나 재생해 보세요.`);
        return;
      }
      const r = this.extract(canvas, this.options(), this.json);
      this.addToSprite(r, this.mode, name);
      UI.closeModals();
      UI.toast(`${this.mode === 'frames' ? '프레임으로' : '새 레이어로'} ${r.images.length}장을 추가했어요. 되돌리려면 Ctrl+Z.`);
    } catch (e) {
      UI.toast('시트를 가져오지 못했어요: ' + e.message);
    }
  },
};
