// 앱 전체 상태, 이벤트 버스, 레이어 · 프레임 · 태그 명령
//
// 이벤트
//   sprite   새 그림을 불러옴
//   doc      레이어 · 프레임 · 태그 · 픽셀이 바뀜 (타임라인 다시 그림)
//   pixels   화면을 다시 그려야 함
//   cursor   현재 레이어/프레임이 바뀜
//   history  작업 기록이 바뀜
const App = {
  sprite: null,
  history: new History(),
  layer: 0, // 현재 레이어 번호 (0 = 맨 아래)
  frame: 0, // 현재 프레임 번호
  selection: null, // selection.js 참고
  tileIndex: 1,     // 타일 도장으로 놓을 타일 번호
  fileName: 'dot-art',
  tool: 'pencil',
  fg: [0, 0, 0, 255],
  bg: [255, 255, 255, 255],
  paletteName: 'DawnBringer 32',
  palette: [],
  opt: {
    size: 1,
    pixelPerfect: true,
    fillShape: false,
    contiguous: true,
    grid: true,
    onion: false,
    onionPrev: 1,
    onionNext: 1,
    loopTag: true,
    ink: 'simple',       // simple | shade | lockAlpha
    symmetry: 'none',    // none | h | v | both
    selMode: 'replace',  // replace | add | subtract
    brushShape: 'circle', // circle | square
    gradShape: 'linear',  // linear | radial
    gradDither: 'bayer4', // none | bayer2 | bayer4
    gradArea: 'region',   // region(같은 색 영역) | all
  },

  _listeners: {},
  on(ev, fn) { (this._listeners[ev] ||= []).push(fn); },
  emit(ev, arg) { (this._listeners[ev] || []).forEach(fn => fn(arg)); },

  currentLayer() { return this.sprite.layers[this.layer]; },
  currentCel() { return this.currentLayer().cels[this.frame]; },
  activeImage() { return this.currentCel().image; },

  colorFor(button) { return button === 'right' ? this.bg : this.fg; },

  setColor(which, c) {
    if (which === 'right' || which === 'bg') this.bg = c.slice();
    else this.fg = c.slice();
    this.emit('color');
  },

  swapColors() {
    [this.fg, this.bg] = [this.bg, this.fg];
    this.emit('color');
  },

  setTool(id) {
    if (!Tools[id]) return;
    this.tool = id;
    this.emit('tool');
  },

  setOpt(key, value) {
    this.opt[key] = value;
    this.emit('opt', key);
  },

  setPalette(name, colors) {
    this.paletteName = name;
    this.palette = colors || paletteColors(name);
    this.emit('palette');
  },

  loadSprite(sprite, label) {
    this.sprite = sprite;
    this.layer = sprite.layers.length - 1;
    this.frame = 0;
    this.selection = null;
    this.tileIndex = 1;
    this.history.reset(label);
    this.emit('sprite');
    this.emit('doc');
    this.emit('history');
  },

  // ---------- 현재 위치 ----------
  setCursor(layer, frame) {
    const s = this.sprite;
    layer = Math.max(0, Math.min(s.layers.length - 1, layer));
    frame = Math.max(0, Math.min(s.frames.length - 1, frame));
    if (layer === this.layer && frame === this.frame) return;
    this.layer = layer;
    this.frame = frame;
    this.emit('cursor');
    this.emit('pixels');
  },
  setFrame(f) { this.setCursor(this.layer, f); },
  setLayer(l) { this.setCursor(l, this.frame); },
  focusCel(layerObj, frame) {
    const i = this.sprite.layers.indexOf(layerObj);
    if (i >= 0) this.layer = i;
    if (frame < this.sprite.frames.length) this.frame = frame;
  },

  // ---------- 실행 취소 ----------
  undo() { if (this.history.undo()) this.afterHistoryMove(); },
  redo() { if (this.history.redo()) this.afterHistoryMove(); },
  gotoHistory(i) { if (this.history.goto(i)) this.afterHistoryMove(); },
  afterHistoryMove() {
    // 크기가 바뀌어 선택 영역이 맞지 않으면 버린다
    if (this.selection && this.selection.mask.length !== this.sprite.width * this.sprite.height) this.selection = null;
    this.emit('cursor');
    this.emit('doc');
    this.emit('pixels');
    this.emit('history');
  },

  // 구조를 바꾸는 명령: 전/후 스냅샷으로 실행 취소한다.
  exec(label, fn) {
    const s = this.sprite;
    const before = { snap: s.snapshot(), layer: this.layer, frame: this.frame };
    fn(s);
    this.layer = Math.max(0, Math.min(s.layers.length - 1, this.layer));
    this.frame = Math.max(0, Math.min(s.frames.length - 1, this.frame));
    const after = { snap: s.snapshot(), layer: this.layer, frame: this.frame };
    const apply = st => { s.restore(st.snap); this.layer = st.layer; this.frame = st.frame; };
    this.history.push({ label, undo: () => apply(before), redo: () => apply(after) });
    this.afterHistoryMove();
  },

  // ---------- 레이어 ----------
  addLayer() {
    this.exec('레이어 추가', s => {
      s.layers.splice(this.layer + 1, 0, s.newLayer(s.nextLayerName()));
      this.layer++;
    });
  },
  duplicateLayer() {
    this.exec('레이어 복제', s => {
      const src = this.currentLayer();
      const l = new Layer(src.name + ' 복사본', src.tileset);
      l.opacity = src.opacity;
      l.reference = src.reference;
      l.cels = cloneCels(src.cels);
      s.layers.splice(this.layer + 1, 0, l);
      this.layer++;
    });
  },
  removeLayer() {
    if (this.sprite.layers.length <= 1) return false;
    this.exec('레이어 삭제', s => { s.layers.splice(this.layer, 1); if (this.layer > 0) this.layer--; });
    return true;
  },
  moveLayer(dir) {
    const to = this.layer + dir;
    if (to < 0 || to >= this.sprite.layers.length) return;
    this.exec(dir > 0 ? '레이어 위로' : '레이어 아래로', s => {
      const [l] = s.layers.splice(this.layer, 1);
      s.layers.splice(to, 0, l);
      this.layer = to;
    });
  },
  mergeDown() {
    if (this.layer === 0) return false;
    const s0 = this.sprite;
    if (s0.layers[this.layer].reference || s0.layers[this.layer - 1].reference) {
      UI.toast('밑그림 레이어는 합칠 수 없어요. 밑그림은 따라 그리는 용도라 내보낼 때 빠져요.');
      return true;
    }
    this.exec('아래 레이어와 합치기', s => {
      const top = s.layers[this.layer], below = s.layers[this.layer - 1];
      const merged = new Layer(below.name);
      merged.opacity = 255;
      merged.cels = below.cels.map((c, f) => {
        const out = new Cel(new PixelImage(s.width, s.height));
        if (below.visible) blendInto(out.image, c.image, below.opacity);
        if (top.visible) blendInto(out.image, top.cels[f].image, top.opacity);
        return out;
      });
      s.layers.splice(this.layer - 1, 2, merged);
      this.layer--;
    });
    return true;
  },
  renameLayer(i, name) {
    name = name.trim();
    if (!name || this.sprite.layers[i].name === name) return;
    this.exec('레이어 이름 바꾸기', s => { s.layers[i].name = name; });
  },
  setLayerOpacity(i, opacity, record) {
    const l = this.sprite.layers[i];
    if (record) {
      const prev = this._opacityStart ?? l.opacity;
      this._opacityStart = undefined;
      l.opacity = prev;
      if (prev !== opacity) this.exec('레이어 투명도', () => { l.opacity = opacity; });
    } else {
      if (this._opacityStart === undefined) this._opacityStart = l.opacity;
      l.opacity = opacity;
      this.emit('pixels');
    }
  },
  toggleLayerVisible(i) {
    const l = this.sprite.layers[i];
    l.visible = !l.visible;
    this.emit('doc');
    this.emit('pixels');
  },
  toggleLayerLock(i) {
    const l = this.sprite.layers[i];
    l.locked = !l.locked;
    this.emit('doc');
  },

  // ---------- 프레임 ----------
  // linked: 복사하지 않고 같은 셀을 함께 쓴다 (한 곳을 고치면 둘 다 바뀜)
  addFrame(duplicate, linked = false) {
    this.exec(linked ? '프레임 링크 복제' : duplicate ? '프레임 복제' : '새 프레임', s => {
      const at = this.frame + 1;
      s.frames.splice(at, 0, { duration: s.frames[this.frame].duration });
      for (const l of s.layers) {
        const cur = l.cels[this.frame];
        l.cels.splice(at, 0, linked ? cur : duplicate ? cur.clone() : s.newCel(l));
      }
      // 뒤쪽 태그는 한 칸 밀고, 현재 프레임을 포함한 태그는 새 프레임까지 늘린다
      for (const t of s.tags) {
        if (t.from >= at) { t.from++; t.to++; }
        else if (t.to >= this.frame) t.to++;
      }
      this.frame = at;
    });
  },
  // 지금 칸의 링크를 끊고 따로 고칠 수 있게 복사본으로 바꾼다
  unlinkCel() {
    const s = this.sprite, layer = this.currentLayer();
    if (!s.isLinked(layer, this.frame)) return false;
    this.exec('링크 끊기', () => { layer.cels[this.frame] = layer.cels[this.frame].clone(); });
    return true;
  },

  // 밑그림 레이어: 그림을 캔버스에 맞춰 넣고, 반투명 · 잠금 상태로 지금 레이어 위에 놓는다
  addReferenceLayer(image, name) {
    const s = this.sprite;
    const k = Math.min(s.width / image.width, s.height / image.height);
    const w = Math.max(1, Math.round(image.width * k)), h = Math.max(1, Math.round(image.height * k));
    const c = document.createElement('canvas');
    c.width = s.width; c.height = s.height;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, Math.floor((s.width - w) / 2), Math.floor((s.height - h) / 2), w, h);
    const data = g.getImageData(0, 0, s.width, s.height).data;
    this.exec('밑그림 넣기', sp => {
      const l = new Layer('밑그림 ' + (name || ''));
      l.name = l.name.trim();
      l.reference = true;
      l.locked = true;
      l.opacity = 128;
      const cel = new Cel(new PixelImage(sp.width, sp.height, new Uint8ClampedArray(data)));
      l.cels = sp.frames.map(() => cel); // 모든 프레임이 같은 밑그림을 쓴다
      sp.layers.splice(this.layer + 1, 0, l);
      this.layer++;
    });
  },

  removeFrame() {
    const s = this.sprite;
    if (s.frames.length <= 1) return false;
    this.exec('프레임 삭제', s => {
      const f = this.frame;
      s.frames.splice(f, 1);
      for (const l of s.layers) l.cels.splice(f, 1);
      s.tags = s.tags.filter(t => !(t.from === f && t.to === f));
      for (const t of s.tags) {
        if (t.from > f) t.from--;
        if (t.to >= f) t.to--;
      }
      if (f >= s.frames.length) this.frame = s.frames.length - 1;
    });
    return true;
  },
  moveFrame(dir) {
    const s = this.sprite, to = this.frame + dir;
    if (to < 0 || to >= s.frames.length) return;
    this.exec(dir > 0 ? '프레임 뒤로' : '프레임 앞으로', s => {
      const swap = arr => { [arr[this.frame], arr[to]] = [arr[to], arr[this.frame]]; };
      swap(s.frames);
      for (const l of s.layers) swap(l.cels);
      this.frame = to;
    });
  },
  // 드래그로 옮기기: target 레이어의 위(above=true) 또는 아래에 놓는다
  moveLayerTo(from, target, above) {
    let to = above ? target + 1 : target;
    if (from < to) to--;
    if (to === from) return;
    this.exec('레이어 옮기기', s => {
      const [l] = s.layers.splice(from, 1);
      s.layers.splice(to, 0, l);
      this.layer = to;
    });
  },
  moveFrameTo(from, target, after) {
    let to = after ? target + 1 : target;
    if (from < to) to--;
    if (to === from) return;
    this.exec('프레임 옮기기', s => {
      const move = arr => { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); };
      move(s.frames);
      for (const l of s.layers) move(l.cels);
      this.frame = to;
    });
  },

  setFrameDuration(ms, all) {
    ms = Math.max(10, Math.min(5000, Math.round(ms) || 100));
    const s = this.sprite;
    if (all ? s.frames.every(f => f.duration === ms) : s.frames[this.frame].duration === ms) return;
    this.exec(all ? '모든 프레임 속도' : '프레임 속도', s => {
      if (all) s.frames.forEach(f => f.duration = ms);
      else s.frames[this.frame].duration = ms;
    });
  },
  clearCel() {
    const cel = this.currentCel();
    if (cel.empty || this.currentLayer().locked) return;
    Editor.beginStroke('칸 비우기');
    cel.image.data.fill(0);
    Editor.endStroke();
    this.emit('pixels');
  },

  // ---------- 태그 ----------
  saveTag(index, tag) {
    const s = this.sprite;
    tag.from = Math.max(0, Math.min(s.frames.length - 1, tag.from));
    tag.to = Math.max(tag.from, Math.min(s.frames.length - 1, tag.to));
    this.exec(index == null ? '태그 추가' : '태그 수정', s => {
      if (index == null) s.tags.push(tag);
      else s.tags[index] = tag;
    });
  },
  removeTag(index) {
    this.exec('태그 삭제', s => s.tags.splice(index, 1));
  },
};

// src 이미지를 opacity(0~255)로 dst 위에 덮는다 (일반 알파 합성)
function blendInto(dst, src, opacity) {
  const d = dst.data, s = src.data, k = opacity / 255;
  for (let i = 0; i < d.length; i += 4) {
    const sa = (s[i + 3] / 255) * k;
    if (!sa) continue;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let c = 0; c < 3; c++) d[i + c] = (s[i + c] * sa + d[i + c] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }
}
