// 캔버스 화면: 확대/이동, 그리기 입력, 렌더링
const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

const Editor = {
  zoom: 8,
  offX: 0,
  offY: 0,
  hover: null,
  lastPoint: null,
  spaceDown: false,
  altDown: false,
  activeTool: null,
  panning: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.comp = document.createElement('canvas');
    this.compCtx = this.comp.getContext('2d', { willReadFrequently: true });
    this.layerCanvas = document.createElement('canvas');
    this.layerCtx = this.layerCanvas.getContext('2d');
    this.checker = this.makeChecker();

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);

    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.render(); App.emit('hover'); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });

    App.on('sprite', () => { this.lastPoint = null; this.resizeComp(); this.fit(); this.refresh(); });
    App.on('selection', () => this.render());
    // 선택 영역 점선이 움직이도록 (선택이 있을 때만 다시 그림)
    setInterval(() => {
      if (App.selection || this.selPreview) { this.antOffset = ((this.antOffset || 0) + 1) % 8; this.render(); }
    }, 120);
    App.on('pixels', () => this.refresh());
    App.on('tool', () => { this.updateCursor(); this.render(); });
    App.on('opt', () => this.refresh());
  },

  makeChecker() {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    return this.ctx.createPattern(c, 'repeat');
  },

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.viewW = r.width;
    this.viewH = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (App.sprite && !this.userMoved) this.fit();
    this.render();
  },

  resizeComp() {
    const s = App.sprite;
    this.comp.width = this.layerCanvas.width = s.width;
    this.comp.height = this.layerCanvas.height = s.height;
  },

  // ---------- 확대 / 이동 ----------
  fit() {
    const s = App.sprite;
    if (!s || !this.viewW) return;
    let z = 1;
    for (const l of ZOOM_LEVELS) if (s.width * l <= this.viewW * 0.85 && s.height * l <= this.viewH * 0.85) z = l;
    this.zoom = z;
    this.offX = Math.round((this.viewW - s.width * z) / 2);
    this.offY = Math.round((this.viewH - s.height * z) / 2);
    this.userMoved = false;
    this.render();
    App.emit('zoom');
  },

  zoomAt(sx, sy, newZoom) {
    newZoom = Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], newZoom));
    if (newZoom === this.zoom) return;
    const px = (sx - this.offX) / this.zoom, py = (sy - this.offY) / this.zoom;
    this.offX = Math.round(sx - px * newZoom);
    this.offY = Math.round(sy - py * newZoom);
    this.zoom = newZoom;
    this.userMoved = true; // 직접 확대했으면 창 크기가 바뀌어도 자동 맞춤을 하지 않는다
    this.render();
    App.emit('zoom');
  },

  zoomStep(dir, sx = this.viewW / 2, sy = this.viewH / 2) {
    const i = ZOOM_LEVELS.indexOf(this.zoom);
    const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + dir))];
    this.zoomAt(sx, sy, next);
  },

  // ---------- 획(stroke) 기록 ----------
  beginStroke(label, opts = {}) {
    this.strokeLabel = label;
    const layer = App.currentLayer();
    this.strokeTile = Tilemap.isTilemap(layer)
      ? { ts: layer.tileset, snap: Tilemap.snapshot(layer.tileset), tileOnly: !!opts.tileOnly }
      : null;
    this.strokeCel = App.currentCel();
    this.strokeLayer = App.currentLayer();
    this.strokeFrame = App.frame;
    this.strokeBefore = new Uint8ClampedArray(this.strokeCel.image.data);
    this.selBefore = App.selection ? App.selection.mask : null;
  },

  endStroke() {
    const cel = this.strokeCel;
    if (!cel) return;
    this.strokeCel = null;
    const img = cel.image, before = this.strokeBefore, after = new Uint8ClampedArray(img.data);
    let changed = false;
    for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) { changed = true; break; }
    if (!changed) return;
    cel.invalidate();
    const layer = this.strokeLayer, frame = this.strokeFrame;
    const selBefore = this.selBefore, selAfter = App.selection ? App.selection.mask : null;
    const setSel = sel => { if ((App.selection ? App.selection.mask : null) !== sel) Selection.set(sel); };

    // 타일맵: 바뀐 칸을 타일에 되돌려 쓰고, 타일셋 전체를 기록한다
    const st = this.strokeTile;
    if (st) {
      if (!st.tileOnly) Tilemap.syncFromPixels(layer, cel, before);
      const snapBefore = st.snap, snapAfter = Tilemap.snapshot(st.ts);
      const applyTiles = (snap, sel) => { Tilemap.restore(st.ts, snap); App.focusCel(layer, frame); setSel(sel); };
      App.history.push({ label: this.strokeLabel, undo: () => applyTiles(snapBefore, selBefore), redo: () => applyTiles(snapAfter, selAfter) });
      App.emit('doc');
      App.emit('pixels');
      App.emit('history');
      return;
    }

    // 되돌릴 때 그 칸으로 이동해서 무엇이 바뀌었는지 보이게 한다. 선택 영역도 그때 모양으로 돌린다.
    const apply = (data, sel) => {
      img.data.set(data);
      cel.invalidate();
      App.focusCel(layer, frame);
      if ((App.selection ? App.selection.mask : null) !== sel) Selection.set(sel);
    };
    App.history.push({ label: this.strokeLabel, undo: () => apply(before, selBefore), redo: () => apply(after, selAfter) });
    App.emit('doc');
    App.emit('history');
  },

  // ---------- 입력 ----------
  toSprite(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return {
      x: Math.floor((sx - this.offX) / this.zoom),
      y: Math.floor((sy - this.offY) / this.zoom),
      sx, sy,
    };
  },

  currentTool() {
    return this.altDown ? Tools.eyedropper : Tools[App.tool];
  },

  // 화면 좌표 → 스프라이트 좌표 (소수점 그대로)
  toSpriteF(p) {
    return { x: (p.sx - this.offX) / this.zoom, y: (p.sy - this.offY) / this.zoom };
  },

  // 이동 툴에서 선택 영역의 손잡이 위치 (화면 좌표)
  handles() {
    if (App.tool !== 'move' || !App.selection || this.altDown) return [];
    const b = App.selection.bounds, z = this.zoom;
    const X = this.offX + b.x * z, Y = this.offY + b.y * z, W = b.w * z, H = b.h * z;
    const list = [];
    for (const hy of [0, 0.5, 1]) for (const hx of [0, 0.5, 1]) {
      if (hx === 0.5 && hy === 0.5) continue;
      list.push({ kind: 'scale', hx, hy, x: X + hx * W, y: Y + hy * H });
    }
    list.push({ kind: 'rotate', x: X + W / 2, y: Y - 22, from: { x: X + W / 2, y: Y } });
    return list;
  },

  handleAt(sx, sy) {
    // 모서리 → 회전 → 가장자리 순으로 우선한다 (작은 선택 영역에서 겹칠 때)
    const hs = this.handles().sort((a, b) => (a.kind === 'scale' && a.hx !== 0.5 && a.hy !== 0.5 ? -1 : 0) - (b.kind === 'scale' && b.hx !== 0.5 && b.hy !== 0.5 ? -1 : 0));
    return hs.find(h => Math.abs(h.x - sx) <= 7 && Math.abs(h.y - sy) <= 7) || null;
  },

  handleCursor(h) {
    if (!h) return '';
    if (h.kind === 'rotate') return 'alias';
    if (h.hx === 0.5) return 'ns-resize';
    if (h.hy === 0.5) return 'ew-resize';
    return (h.hx === h.hy) ? 'nwse-resize' : 'nesw-resize';
  },

  onDown(e) {
    if (!App.sprite || this.activeTool || this.panning) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toSprite(e);
    if (e.button === 1 || this.spaceDown || (App.tool === 'hand' && !this.altDown)) {
      this.panning = { sx: p.sx, sy: p.sy, offX: this.offX, offY: this.offY };
      this.updateCursor();
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    Timeline.stop();
    const tool = this.currentTool();
    if (tool.edits !== false) {
      const layer = App.currentLayer();
      if (layer.locked) { UI.toast(`🔒 "${layer.name}" 레이어는 잠겨 있어요. 타임라인에서 자물쇠를 눌러 풀어 주세요.`); return; }
      if (!layer.visible) { UI.toast(`👁 "${layer.name}" 레이어가 숨겨져 있어요. 눈 아이콘을 눌러 보이게 해 주세요.`); return; }
    }
    this.activeTool = tool;
    this.activeTool.down(p, e.button === 2 ? 'right' : 'left', e);
  },

  onMove(e) {
    if (!App.sprite) return;
    const p = this.toSprite(e);
    if (this.panning) {
      this.offX = this.panning.offX + (p.sx - this.panning.sx);
      this.offY = this.panning.offY + (p.sy - this.panning.sy);
      this.userMoved = true;
    } else if (this.activeTool) {
      this.activeTool.move(p, e);
    }
    this.hover = p;
    if (!this.activeTool && !this.panning) this.canvas.style.cursor = this.handleCursor(this.handleAt(p.sx, p.sy));
    this.render();
    App.emit('hover');
  },

  onUp(e) {
    if (this.panning) {
      this.panning = null;
      this.updateCursor();
    }
    if (this.activeTool) {
      this.activeTool.up(this.toSprite(e), e);
      this.activeTool = null;
    }
  },

  onWheel(e) {
    e.preventDefault();
    if (!App.sprite) return;
    const p = this.toSprite(e);
    this.zoomStep(e.deltaY < 0 ? 1 : -1, p.sx, p.sy);
  },

  updateCursor() {
    const c = this.canvas.classList;
    c.toggle('panning', !!this.panning);
    c.toggle('pan', !this.panning && (this.spaceDown || (App.tool === 'hand' && !this.altDown)));
    c.toggle('pick', !this.spaceDown && (this.altDown || App.tool === 'eyedropper'));
  },

  // ---------- 렌더링 ----------
  // 한 프레임의 보이는 레이어를 아래부터 합쳐서 g(스프라이트 크기 캔버스)에 그린다
  // final이면 밑그림 레이어를 뺀 "완성 그림"을 그린다 (내보내기 · 미리보기 · 어니언 스킨)
  drawFrame(g, frame, final = false) {
    const s = App.sprite;
    g.clearRect(0, 0, s.width, s.height);
    for (const layer of s.layers) {
      const cel = layer.cels[frame];
      if (!layer.visible || !cel || (final && layer.reference)) continue;
      const img = cel.image;
      this.layerCtx.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
      g.globalAlpha = layer.opacity / 255;
      g.drawImage(this.layerCanvas, 0, 0);
    }
    g.globalAlpha = 1;
  },

  composite() {
    // 그림 크기가 바뀌었으면 (크기 바꾸기 · 실행 취소) 화면용 캔버스도 맞춘다
    if (this.comp.width !== App.sprite.width || this.comp.height !== App.sprite.height) {
      this.resizeComp();
      this.fit();
    }
    this.drawFrame(this.compCtx, App.frame);
    this.buildOnion();
  },

  // 어니언 스킨: 앞 프레임은 빨강, 뒤 프레임은 파랑으로 물들여 반투명하게 겹친다
  buildOnion() {
    const s = App.sprite, o = App.opt;
    this.onionLayers = [];
    if (!o.onion || Timeline.playing) return;
    const add = (f, color, alpha) => {
      if (f < 0 || f >= s.frames.length || f === App.frame) return;
      const c = document.createElement('canvas');
      c.width = s.width; c.height = s.height;
      const g = c.getContext('2d');
      this.drawFrame(g, f, true);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = color;
      g.globalAlpha = 0.55;
      g.fillRect(0, 0, s.width, s.height);
      this.onionLayers.push({ canvas: c, alpha });
    };
    for (let i = o.onionPrev; i >= 1; i--) add(App.frame - i, '#ff3355', 0.5 / i);
    for (let i = o.onionNext; i >= 1; i--) add(App.frame + i, '#3388ff', 0.5 / i);
  },

  refresh() {
    if (!App.sprite) return;
    this.composite();
    this.render();
    App.emit('render');
  },

  pixelAt(x, y) {
    const s = App.sprite;
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) return null;
    return Array.from(this.compCtx.getImageData(x, y, 1, 1).data);
  },

  render() {
    const g = this.ctx, s = App.sprite;
    if (!this.viewW) return;
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--workspace');
    g.fillRect(0, 0, this.viewW, this.viewH);
    if (!s) return;

    const z = this.zoom, x = this.offX, y = this.offY, w = s.width * z, h = s.height * z;

    g.save();
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = 20;
    g.fillStyle = '#000';
    g.fillRect(x, y, w, h);
    g.restore();

    g.save();
    g.translate(x, y);
    g.fillStyle = this.checker;
    g.fillRect(0, 0, w, h);
    g.restore();

    g.imageSmoothingEnabled = false;
    for (const o of this.onionLayers || []) {
      g.globalAlpha = o.alpha;
      g.drawImage(o.canvas, x, y, w, h);
    }
    g.globalAlpha = 1;
    g.drawImage(this.comp, x, y, w, h);

    if (App.opt.grid && z >= 6) {
      g.beginPath();
      for (let i = 1; i < s.width; i++) { g.moveTo(x + i * z + 0.5, y); g.lineTo(x + i * z + 0.5, y + h); }
      for (let i = 1; i < s.height; i++) { g.moveTo(x, y + i * z + 0.5); g.lineTo(x + w, y + i * z + 0.5); }
      g.strokeStyle = 'rgba(90, 100, 120, .35)';
      g.lineWidth = 1;
      g.stroke();
    }

    // 타일맵 레이어의 타일 칸 경계
    const curLayer = App.currentLayer();
    if (curLayer && curLayer.tileset) {
      const ts = curLayer.tileset, tw = ts.tileW * z, th = ts.tileH * z;
      g.beginPath();
      for (let gx = tw; gx < w; gx += tw) { g.moveTo(Math.round(x + gx) + 0.5, y); g.lineTo(Math.round(x + gx) + 0.5, y + h); }
      for (let gy = th; gy < h; gy += th) { g.moveTo(x, Math.round(y + gy) + 0.5); g.lineTo(x + w, Math.round(y + gy) + 0.5); }
      g.strokeStyle = 'rgba(91, 140, 255, .55)';
      g.lineWidth = 1;
      g.stroke();
      if (this.hover && App.tool === 'tile' && !this.altDown) {
        const c = Math.floor(this.hover.x / ts.tileW), r = Math.floor(this.hover.y / ts.tileH);
        if (c >= 0 && r >= 0 && c * ts.tileW < App.sprite.width && r * ts.tileH < App.sprite.height) {
          const tile = ts.tiles[App.tileIndex];
          if (tile && App.tileIndex) {
            const tc = document.createElement('canvas');
            tc.width = ts.tileW; tc.height = ts.tileH;
            tc.getContext('2d').putImageData(new ImageData(tile.data.slice(), ts.tileW, ts.tileH), 0, 0);
            g.globalAlpha = 0.6;
            g.drawImage(tc, x + c * tw, y + r * th, tw, th);
            g.globalAlpha = 1;
          }
          g.strokeStyle = '#fff';
          g.strokeRect(x + c * tw + 0.5, y + r * th + 0.5, tw - 1, th - 1);
        }
      }
    }

    // 대칭 축
    const tool = this.currentTool();
    const sym = App.opt.symmetry;
    if (sym !== 'none' && tool.options.includes('symmetry')) {
      g.save();
      g.strokeStyle = 'rgba(91, 140, 255, .9)';
      g.setLineDash([6, 4]);
      g.lineWidth = 1;
      g.beginPath();
      if (sym === 'h' || sym === 'both') { const ax = Math.round(x + w / 2) + 0.5; g.moveTo(ax, y - 8); g.lineTo(ax, y + h + 8); }
      if (sym === 'v' || sym === 'both') { const ay = Math.round(y + h / 2) + 0.5; g.moveTo(x - 8, ay); g.lineTo(x + w + 8, ay); }
      g.stroke();
      g.restore();
    }

    // 선택 영역 (흰 선 위에 움직이는 검은 점선)
    const ants = path => {
      g.save();
      g.lineWidth = 1;
      g.strokeStyle = '#fff';
      g.stroke(path);
      g.strokeStyle = '#000';
      g.setLineDash([4, 4]);
      g.lineDashOffset = -(this.antOffset || 0);
      g.stroke(path);
      g.restore();
    };
    if (App.selection && !this.transforming) {
      const off = this.selOffset || { dx: 0, dy: 0 };
      const path = new Path2D();
      for (const [x1, y1, x2, y2] of App.selection.edges) {
        path.moveTo(x + (x1 + off.dx) * z + 0.5, y + (y1 + off.dy) * z + 0.5);
        path.lineTo(x + (x2 + off.dx) * z + 0.5, y + (y2 + off.dy) * z + 0.5);
      }
      ants(path);
    }
    const pv = this.selPreview;
    if (pv) {
      const path = new Path2D();
      if (pv.type === 'rect') {
        const x0 = Math.min(pv.a.x, pv.b.x), y0 = Math.min(pv.a.y, pv.b.y);
        const x1 = Math.max(pv.a.x, pv.b.x) + 1, y1 = Math.max(pv.a.y, pv.b.y) + 1;
        path.rect(x + x0 * z + 0.5, y + y0 * z + 0.5, (x1 - x0) * z, (y1 - y0) * z);
      } else {
        pv.pts.forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](x + (p.x + 0.5) * z, y + (p.y + 0.5) * z));
      }
      ants(path);
    }

    // 이동 툴: 크기 조절 · 회전 손잡이
    if (!this.activeTool && !this.selOffset) {
      for (const h of this.handles()) {
        if (h.kind === 'rotate') {
          g.strokeStyle = 'rgba(255,255,255,.8)';
          g.beginPath(); g.moveTo(h.from.x + 0.5, h.from.y); g.lineTo(h.x + 0.5, h.y + 5); g.stroke();
          g.beginPath(); g.arc(h.x, h.y, 5, 0, Math.PI * 2);
          g.fillStyle = '#5b8cff'; g.fill(); g.strokeStyle = '#fff'; g.stroke();
        } else {
          g.fillStyle = '#fff'; g.fillRect(h.x - 4, h.y - 4, 8, 8);
          g.strokeStyle = '#1e2027'; g.strokeRect(h.x - 3.5, h.y - 3.5, 7, 7);
        }
      }
    }

    // 그라데이션 방향 안내선
    if (this.gradLine) {
      const { a, b } = this.gradLine;
      const ax = x + (a.x + 0.5) * z, ay = y + (a.y + 0.5) * z, bx = x + (b.x + 0.5) * z, by = y + (b.y + 0.5) * z;
      g.save();
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.6)';
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.lineWidth = 1; g.strokeStyle = '#fff';
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      for (const [px, py] of [[ax, ay], [bx, by]]) { g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); }
      g.restore();
    }

    // 브러시 위치 미리보기
    const hv = this.hover;
    if (hv && !this.panning && !this.spaceDown && tool.id !== 'hand') {
      const size = tool.brush ? App.opt.size : 1;
      const cells = size === 1 ? [[0, 0]] : brushOffsets(size);
      const on = new Set(cells.map(([dx, dy]) => dx + ',' + dy));
      if (tool.brush && tool.id !== 'eraser' && !this.activeTool) {
        const c = App.fg;
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},.5)`;
        for (const [dx, dy] of cells) g.fillRect(x + (hv.x + dx) * z, y + (hv.y + dy) * z, z, z);
      }
      // 브러시 모양의 바깥 테두리
      const edge = new Path2D();
      for (const [dx, dy] of cells) {
        const px = x + (hv.x + dx) * z, py = y + (hv.y + dy) * z;
        if (!on.has(dx + ',' + (dy - 1))) { edge.moveTo(px, py + 0.5); edge.lineTo(px + z, py + 0.5); }
        if (!on.has(dx + ',' + (dy + 1))) { edge.moveTo(px, py + z - 0.5); edge.lineTo(px + z, py + z - 0.5); }
        if (!on.has((dx - 1) + ',' + dy)) { edge.moveTo(px + 0.5, py); edge.lineTo(px + 0.5, py + z); }
        if (!on.has((dx + 1) + ',' + dy)) { edge.moveTo(px + z - 0.5, py); edge.lineTo(px + z - 0.5, py + z); }
      }
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,.8)';
      g.stroke(edge);
      g.lineWidth = 1;
      g.strokeStyle = '#fff';
      g.stroke(edge);
    }
  },
};
