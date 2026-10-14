// 타일맵 레이어
//
// 칸(cell)마다 타일 번호를 저장하고, cel.image는 그 번호대로 타일을 그려 낸 결과다.
// 그리기 툴은 평소처럼 cel.image에 그리고, 획이 끝나면 syncFromPixels가 바뀐 칸을 타일에 되돌려 쓴다.
//   - 빈칸에 그리면 새 타일이 생긴다 (똑같은 타일이 이미 있으면 그걸 쓴다)
//   - 타일이 깔린 칸을 고치면 같은 타일이 깔린 모든 곳이 함께 바뀐다
//   - 칸을 전부 지우면 그 자리만 빈칸이 된다

const Tilemap = {
  isTilemap(layer) { return !!(layer && layer.tileset); },

  // ---------- 그려 내기 ----------
  renderCel(layer, cel, s = App.sprite) {
    const ts = layer.tileset, img = cel.image;
    const { cols, rows } = s.tileGrid(ts);
    img.data.fill(0);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const idx = cel.map[r * cols + c];
      const tile = idx && ts.tiles[idx];
      if (!tile) continue;
      for (let y = 0; y < ts.tileH; y++) {
        const py = r * ts.tileH + y;
        if (py >= img.h) break;
        const x0 = c * ts.tileW, w = Math.min(ts.tileW, img.w - x0);
        img.data.set(tile.data.subarray(y * ts.tileW * 4, (y * ts.tileW + w) * 4), (py * img.w + x0) * 4);
      }
    }
    cel.invalidate();
  },

  // 이 타일셋을 쓰는 모든 레이어 · 모든 프레임을 다시 그린다
  renderTileset(ts) {
    for (const l of App.sprite.layers) if (l.tileset === ts) for (const cel of l.cels) this.renderCel(l, cel);
  },

  // ---------- 픽셀 → 타일 ----------
  // 칸 하나의 픽셀을 타일 크기로 잘라 낸다. 그림 밖으로 나간 부분은 base(기존 타일)를 그대로 둔다.
  extractCell(img, ts, c, r, base) {
    const out = base ? base.clone() : new PixelImage(ts.tileW, ts.tileH);
    for (let y = 0; y < ts.tileH; y++) {
      const py = r * ts.tileH + y;
      if (py >= img.h) break;
      const x0 = c * ts.tileW, w = Math.min(ts.tileW, img.w - x0);
      out.data.set(img.data.subarray((py * img.w + x0) * 4, (py * img.w + x0 + w) * 4), y * ts.tileW * 4);
    }
    return out;
  },

  isEmpty(tile) {
    for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i]) return false;
    return true;
  },

  findTile(ts, tile) {
    for (let i = 1; i < ts.tiles.length; i++) {
      const d = ts.tiles[i].data;
      let same = true;
      for (let k = 0; k < d.length; k++) if (d[k] !== tile.data[k]) { same = false; break; }
      if (same) return i;
    }
    return 0;
  },

  syncFromPixels(layer, cel, before) {
    const ts = layer.tileset, img = cel.image, s = App.sprite;
    const { cols } = s.tileGrid(ts);
    const changed = new Set();
    const a = img.data;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] === before[i] && a[i + 1] === before[i + 1] && a[i + 2] === before[i + 2] && a[i + 3] === before[i + 3]) continue;
      const p = i / 4, x = p % img.w, y = (p / img.w) | 0;
      changed.add(Math.floor(y / ts.tileH) * cols + Math.floor(x / ts.tileW));
    }
    for (const cell of changed) {
      const c = cell % cols, r = (cell / cols) | 0;
      const idx = cel.map[cell];
      const tile = this.extractCell(img, ts, c, r, idx ? ts.tiles[idx] : null);
      if (this.isEmpty(tile)) { cel.map[cell] = 0; continue; }
      if (idx) { ts.tiles[idx].data.set(tile.data); continue; }
      let found = this.findTile(ts, tile);
      if (!found) { ts.tiles.push(tile); found = ts.tiles.length - 1; }
      cel.map[cell] = found;
    }
    this.renderTileset(ts);
  },

  // ---------- 실행 취소용 스냅샷 ----------
  snapshot(ts) {
    const maps = [];
    for (const l of App.sprite.layers) if (l.tileset === ts) for (const cel of l.cels) maps.push([cel, cel.map.slice()]);
    return { tiles: ts.tiles.map(t => t.data.slice()), maps };
  },
  restore(ts, snap) {
    ts.tiles = snap.tiles.map(d => new PixelImage(ts.tileW, ts.tileH, d.slice()));
    for (const [cel, map] of snap.maps) cel.map.set(map);
    this.renderTileset(ts);
  },

  // ---------- 레이어 만들기 ----------
  addLayer(tileW, tileH) {
    App.exec('타일맵 레이어 추가', s => {
      let n = 1;
      while (s.layers.some(l => l.name === '타일맵 ' + n)) n++;
      s.layers.splice(App.layer + 1, 0, s.newLayer('타일맵 ' + n, new Tileset(tileW, tileH)));
      App.layer++;
    });
    App.tileIndex = 1;
  },

  // 지금 레이어를 타일맵으로: 칸으로 잘라서 똑같은 모양은 타일 하나로 묶는다
  convertLayer(tileW, tileH) {
    const src = App.currentLayer();
    let count = 0;
    App.exec('타일맵으로 바꾸기', s => {
      const ts = new Tileset(tileW, tileH);
      const l = new Layer(src.name, ts);
      Object.assign(l, { visible: src.visible, locked: src.locked, opacity: src.opacity });
      const { cols, rows } = s.tileGrid(ts);
      l.cels = cloneCels(src.cels, old => {
        const cel = new Cel(old.image.clone(), new Uint32Array(cols * rows));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const tile = this.extractCell(cel.image, ts, c, r, null);
          if (this.isEmpty(tile)) continue;
          let idx = this.findTile(ts, tile);
          if (!idx) { ts.tiles.push(tile); idx = ts.tiles.length - 1; }
          cel.map[r * cols + c] = idx;
        }
        return cel;
      });
      s.layers[App.layer] = l;
      count = ts.tiles.length - 1;
    });
    UI.toast(`타일맵으로 바꿨어요. 서로 다른 모양 ${count}개를 타일로 만들었어요.`);
  },
};

ICONS.tile = '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><path d="M15 17h4M17 15v4"/>';

// ---------- 타일 도장 툴 ----------
Tools.tile = {
  id: 'tile', label: '타일 도장', key: 'T',
  desc: '오른쪽 타일셋에서 고른 타일을 칸에 찍어요. 오른쪽 클릭은 그 칸을 비워요.',
  hint: '타일맵 레이어에서만 써요 · 타일 모양을 고치려면 연필로 칸 안을 그리세요. 같은 타일이 모두 바뀌어요',
  options: [],

  down(p, button) {
    const layer = App.currentLayer();
    if (!Tilemap.isTilemap(layer)) {
      UI.toast('타일 도장은 타일맵 레이어에서 써요. 타임라인의 ▦ 버튼으로 타일맵 레이어를 만들어 보세요.');
      this.inactive = true;
      return;
    }
    this.inactive = false;
    this.value = button === 'right' ? 0 : App.tileIndex;
    Editor.beginStroke(button === 'right' ? '타일 지우기' : '타일 놓기', { tileOnly: true });
    this.put(p);
  },
  move(p) { if (!this.inactive) this.put(p); },
  up() { if (!this.inactive) Editor.endStroke(); },

  put(p) {
    const layer = App.currentLayer(), cel = App.currentCel(), ts = layer.tileset, s = App.sprite;
    const { cols, rows } = s.tileGrid(ts);
    const c = Math.floor(p.x / ts.tileW), r = Math.floor(p.y / ts.tileH);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    if (cel.map[r * cols + c] === this.value) return;
    cel.map[r * cols + c] = this.value;
    Tilemap.renderCel(layer, cel);
    Editor.refresh();
  },
};
TOOL_ORDER.splice(TOOL_ORDER.indexOf('hand'), 0, 'tile', '|');
