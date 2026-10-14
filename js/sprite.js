// 데이터 모델: Sprite → Layer × Frame → Cel(이미지)
// layers[0]이 맨 아래 레이어. 모든 레이어는 모든 프레임에 셀을 하나씩 가진다 (비어 있으면 투명).

class PixelImage {
  constructor(w, h, data) {
    this.w = w;
    this.h = h;
    this.data = data || new Uint8ClampedArray(w * h * 4);
  }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) {
    const i = (y * this.w + x) * 4, d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }
  set(x, y, c) {
    if (!this.inBounds(x, y)) return;
    const i = (y * this.w + x) * 4, d = this.data;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
  }
  fill(c) {
    for (let i = 0; i < this.data.length; i += 4) this.data.set(c, i);
  }
  clone() { return new PixelImage(this.w, this.h, new Uint8ClampedArray(this.data)); }
}

class Cel {
  constructor(image, map = null) {
    this.image = image;
    this.map = map; // 타일맵 레이어일 때: 칸마다 타일 번호 (0 = 빈칸). image는 타일로 그려 낸 결과

    this._empty = undefined; // 캐시. 픽셀이 바뀌면 invalidate()
  }
  invalidate() { this._empty = undefined; }
  get empty() {
    if (this._empty === undefined) {
      const d = this.image.data;
      this._empty = true;
      for (let i = 3; i < d.length; i += 4) if (d[i]) { this._empty = false; break; }
    }
    return this._empty;
  }
  clone() { return new Cel(this.image.clone(), this.map ? this.map.slice() : null); }
}


// 셀 목록을 복사한다. 링크된 셀(여러 프레임이 같은 셀을 공유)은 복사본에서도 서로 링크된 채로 둔다.
function cloneCels(cels, make = c => c.clone()) {
  const map = new Map();
  return cels.map(c => {
    if (!map.has(c)) map.set(c, make(c));
    return map.get(c);
  });
}

// 타일셋: 같은 크기 타일 모음. tiles[0]은 항상 빈 타일.
class Tileset {
  constructor(tileW, tileH) {
    this.tileW = tileW;
    this.tileH = tileH;
    this.name = '타일셋';
    this.tiles = [new PixelImage(tileW, tileH)];
  }
}

class Layer {
  constructor(name, tileset = null) {
    this.name = name;
    this.reference = false; // 밑그림 레이어: 화면에만 보이고 내보내기 · 미리보기에서는 빠진다
    this.tileset = tileset; // 있으면 타일맵 레이어
    this.visible = true;
    this.locked = false;
    this.opacity = 255;
    this.cels = []; // 프레임 번호 → Cel
  }
}

const TAG_COLORS = ['#e05561', '#e8a33d', '#d9c84a', '#57b85c', '#3fa7c4', '#5b6ee1', '#9b59d0', '#d971b4'];

class Sprite {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.frames = [{ duration: 100 }];
    this.layers = [];
    this.tags = []; // { name, from, to, color, direction: 'forward'|'reverse'|'pingpong' }
    this.colorMode = 'rgb'; // rgb | indexed (colormode.js 참고)
  }

  newCel(layer) {
    const cel = new Cel(new PixelImage(this.width, this.height));
    if (layer && layer.tileset) {
      const g = this.tileGrid(layer.tileset);
      cel.map = new Uint32Array(g.cols * g.rows);
    }
    return cel;
  }

  newLayer(name, tileset = null) {
    const l = new Layer(name, tileset);
    for (let f = 0; f < this.frames.length; f++) l.cels[f] = this.newCel(l);
    return l;
  }

  tileGrid(ts) {
    return { cols: Math.ceil(this.width / ts.tileW), rows: Math.ceil(this.height / ts.tileH) };
  }

  tilesets() {
    return [...new Set(this.layers.map(l => l.tileset).filter(Boolean))];
  }

  nextLayerName() {
    let n = this.layers.length + 1;
    while (this.layers.some(l => l.name === '레이어 ' + n)) n++;
    return '레이어 ' + n;
  }

  static create(width, height, bgColor) {
    const s = new Sprite(width, height);
    const layer = s.newLayer(bgColor ? '배경' : '레이어 1');
    if (bgColor) layer.cels[0].image.fill(bgColor);
    s.layers.push(layer);
    if (bgColor) s.layers.push(s.newLayer('레이어 1'));
    return s;
  }

  static fromImageData(imageData) {
    const s = Sprite.create(imageData.width, imageData.height);
    s.layers[0].cels[0].image.data.set(imageData.data);
    return s;
  }

  // 구조(레이어 순서 · 프레임 · 태그) 스냅샷. 이미지는 참조만 저장한다.
  snapshot() {
    return {
      width: this.width,
      height: this.height,
      layers: this.layers.map(l => ({ layer: l, name: l.name, opacity: l.opacity, cels: l.cels.slice() })),
      frames: this.frames.map(f => ({ ...f })),
      tags: this.tags.map(t => ({ ...t })),
    };
  }
  restore(snap) {
    this.width = snap.width;
    this.height = snap.height;
    this.layers = snap.layers.map(s => {
      s.layer.name = s.name;
      s.layer.opacity = s.opacity;
      s.layer.cels = s.cels.slice();
      return s.layer;
    });
    this.frames = snap.frames.map(f => ({ ...f }));
    this.tags = snap.tags.map(t => ({ ...t }));
  }

  // f번 프레임의 셀을 다른 프레임도 같이 쓰고 있는지
  isLinked(layer, f) {
    const cel = layer.cels[f];
    return layer.cels.some((c, i) => i !== f && c === cel);
  }

  tagAt(frame) {
    return this.tags.find(t => frame >= t.from && frame <= t.to);
  }
}

// 실행 취소 기록. 각 항목은 { label, undo(), redo() }.
class History {
  constructor() {
    this.entries = [];
    this.index = -1;
    this.limit = 300;
  }
  reset(label) {
    this.entries = [{ label }];
    this.index = 0;
  }
  push(entry) {
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      this.entries.splice(1, 1);
      this.entries[0].label = '(이전 기록)';
    }
    this.index = this.entries.length - 1;
  }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  undo() {
    if (!this.canUndo) return false;
    this.entries[this.index--].undo();
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this.entries[++this.index].redo();
    return true;
  }
  goto(i) {
    let changed = false;
    while (this.index > i) changed = this.undo() || changed;
    while (this.index < i) changed = this.redo() || changed;
    return changed;
  }
}
