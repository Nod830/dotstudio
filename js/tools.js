// 그리기 툴. 각 툴은 down / move / up(p, button, e)을 가진다. p는 스프라이트 좌표 {x, y}.
// edits: false인 툴은 레이어 잠금/숨김과 상관없이 쓸 수 있다.

const ICONS = {
  pencil: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
  eraser: '<path d="M9 20h11"/><path d="M4.5 15.5l9-9a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2L11 19H8z"/><path d="M9 11l5 5"/>',
  fill: '<path d="M5 12l6.5-6.5L18 12l-6.5 6.5z"/><path d="M5 12h13"/><path d="M20 15.5c0 1.6 1 2.4 1 3.3a1 1 0 0 1-2 0c0-.9 1-1.7 1-3.3z"/>',
  eyedropper: '<path d="M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L17 12l-5-5z"/><path d="M13 8l-8 8v3h3l8-8"/>',
  line: '<path d="M5 19L19 5"/><rect x="3" y="17" width="4" height="4" rx=".5"/><rect x="17" y="3" width="4" height="4" rx=".5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  select: '<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.6"/>',
  lasso: '<path d="M7.5 16.5C4.5 15.5 3 13 4 10.5 5.5 6.5 10 4.5 14.5 5S21 8.5 20 11.5 15.5 16 11.5 16" stroke-dasharray="3 2.6"/><path d="M8 15.5c-1.5 1-1.5 3 0 4.5"/>',
  wand: '<path d="M4 20L14 10"/><path d="M16 3v3M19.5 4.5l-2 2M21 9h-3M19.5 13.5l-2-2M12.5 4.5l2 2"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  gradient: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M8 5v14M12 5v2M12 9v2M12 13v2M12 17v2M16 5v1M16 9v1M16 13v1M16 17v1"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.5 6-6 6-2.5 0-4-1.2-5.5-3.5L4 14a1.5 1.5 0 0 1 2.5-1.6L8 14"/>',
};

const TRANSPARENT = [0, 0, 0, 0];

// ---------- 칠하기 도우미 ----------

// 대칭 모드에 따라 함께 칠할 점들
function symPoints(x, y) {
  const s = App.sprite, m = App.opt.symmetry, pts = [[x, y]];
  const mx = s.width - 1 - x, my = s.height - 1 - y;
  if (m === 'h' || m === 'both') pts.push([mx, y]);
  if (m === 'v' || m === 'both') pts.push([x, my]);
  if (m === 'both') pts.push([mx, my]);
  return pts;
}

function luminance(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

// 명암 잉크: 팔레트에서 비슷한 색 계열 중 한 단계 밝은(dir=1) / 어두운(dir=-1) 색을 고른다
function shadeColor(c, dir, palette) {
  const l = luminance(c);
  let best = null, bestScore = Infinity;
  for (const p of palette) {
    const lp = luminance(p), d = (lp - l) * dir;
    if (d < 6) continue;
    const chroma = Math.hypot((p[0] - lp) - (c[0] - l), (p[1] - lp) - (c[1] - l), (p[2] - lp) - (c[2] - l));
    const score = d + chroma * 1.4;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best ? [best[0], best[1], best[2], c[3]] : null;
}

// 한 획 동안 쓰는 붓. 잉크 · 대칭 · 선택 영역을 한곳에서 처리한다.
function makePainter(img, color, ink = 'simple', button = 'left') {
  const clip = App.selection ? App.selection.mask : null;
  const shaded = new Set();
  return {
    // 바뀐 칸의 [x, y, 이전 색] 목록을 돌려준다 (픽셀 퍼펙트가 되돌릴 때 씀)
    put(x, y) {
      const changed = [];
      for (const [px, py] of symPoints(x, y)) {
        if (!img.inBounds(px, py)) continue;
        const i = py * img.w + px;
        if (clip && !clip[i]) continue;
        const prev = img.get(px, py);
        let c = color;
        if (ink === 'shade') {
          if (shaded.has(i) || !prev[3]) continue;
          c = shadeColor(prev, button === 'right' ? -1 : 1, App.palette);
          if (!c) continue;
          shaded.add(i);
        } else if (ink === 'lockAlpha') {
          if (!prev[3]) continue;
          c = [color[0], color[1], color[2], prev[3]];
        }
        if (colorsEqual(prev, c)) continue;
        img.set(px, py, c);
        changed.push([px, py, prev]);
      }
      return changed;
    },
  };
}

// 브러시 크기만큼 사각형으로 찍는다. 짝수 크기는 오른쪽·아래로 한 칸 더 커진다.
function brushOrigin(x, y, size) {
  const o = Math.floor((size - 1) / 2);
  return [x - o, y - o];
}
// 브러시가 칠하는 칸들 (가운데 기준 [dx, dy]). 원형은 모서리를 깎는다.
const brushCache = {};
function brushOffsets(size, shape = App.opt.brushShape) {
  const key = shape + size;
  if (brushCache[key]) return brushCache[key];
  const o = Math.floor((size - 1) / 2), c = (size - 1) / 2, r2 = (size / 2 - 0.25) ** 2;
  const list = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
    if (shape === 'circle' && size > 2 && (dx - c) ** 2 + (dy - c) ** 2 > r2) continue;
    list.push([dx - o, dy - o]);
  }
  return (brushCache[key] = list);
}
function stamp(painter, x, y, size) {
  if (size === 1) return painter.put(x, y);
  for (const [dx, dy] of brushOffsets(size)) painter.put(x + dx, y + dy);
}

function selModeFor(e) {
  if (e.shiftKey) return 'add';
  if (e.ctrlKey || e.metaKey) return 'subtract';
  return App.opt.selMode;
}

// ---------- 툴 만들기 ----------

// 연필 · 지우개 같은 자유 그리기 툴
function freehandTool(def, getColor, isPencil) {
  return Object.assign({
    brush: true,
    options: isPencil ? ['size', 'brushShape', 'ink', 'pixelPerfect', 'symmetry'] : ['size', 'brushShape', 'symmetry'],

    down(p, button, e) {
      this.img = App.activeImage();
      this.size = App.opt.size;
      const ink = isPencil ? App.opt.ink : 'simple';
      this.painter = makePainter(this.img, getColor(button), ink, button);
      this.pp = isPencil && ink === 'simple' && App.opt.pixelPerfect && this.size === 1;
      this.pts = [];
      Editor.beginStroke(ink === 'shade' ? '명암' : def.label);
      if (e.shiftKey && Editor.lastPoint) {
        const from = Editor.lastPoint;
        Raster.line(from.x, from.y, p.x, p.y, (x, y) => this.plot(x, y));
      } else {
        this.plot(p.x, p.y);
      }
      this.last = p;
      Editor.refresh();
    },

    move(p) {
      if (p.x === this.last.x && p.y === this.last.y) return;
      Raster.line(this.last.x, this.last.y, p.x, p.y, (x, y) => this.plot(x, y));
      this.last = p;
      Editor.refresh();
    },

    up() {
      Editor.lastPoint = this.last;
      Editor.endStroke();
    },

    plot(x, y) {
      if (!this.pp) { stamp(this.painter, x, y, this.size); return; }
      // 픽셀 퍼펙트: ㄱ자로 꺾이는 군더더기 점을 되돌린다.
      const pts = this.pts, n = pts.length;
      if (n && pts[n - 1].x === x && pts[n - 1].y === y) return;
      pts.push({ x, y, changed: this.painter.put(x, y) });
      if (pts.length >= 3) {
        const a = pts[pts.length - 3], b = pts[pts.length - 2], c = pts[pts.length - 1];
        const diagonal = Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1;
        const corner = (b.x === a.x || b.y === a.y) && (b.x === c.x || b.y === c.y);
        if (diagonal && corner) {
          for (const [px, py, prev] of b.changed) this.img.set(px, py, prev);
          pts.splice(pts.length - 2, 1);
        }
      }
    },
  }, def);
}

// 직선 · 사각형 · 원: 드래그하는 동안 시작 시점 이미지로 되돌리고 다시 그린다.
function shapeTool(def, draw, constrain) {
  return Object.assign({
    brush: true,
    down(p, button, e) {
      this.img = App.activeImage();
      this.color = App.colorFor(button);
      this.start = p;
      this.base = new Uint8ClampedArray(this.img.data);
      Editor.beginStroke(def.label);
      this.move(p, e);
    },
    move(p, e) {
      this.img.data.set(this.base);
      const end = e.shiftKey ? constrain(this.start, p) : p;
      const painter = makePainter(this.img, this.color), size = App.opt.size;
      draw(this.start, end, (x, y) => stamp(painter, x, y, size), (x, y) => painter.put(x, y));
      Editor.refresh();
    },
    up() { Editor.endStroke(); },
  }, def);
}

function snapAngle(s, p) {
  let dx = p.x - s.x, dy = p.y - s.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > ay * 2) dy = 0;
  else if (ay > ax * 2) dx = 0;
  else { const d = Math.max(ax, ay); dx = Math.sign(dx) * d; dy = Math.sign(dy) * d; }
  return { x: s.x + dx, y: s.y + dy };
}

function snapSquare(s, p) {
  const dx = p.x - s.x, dy = p.y - s.y;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: s.x + (Math.sign(dx) || 1) * d, y: s.y + (Math.sign(dy) || 1) * d };
}

const SELECT_HINT = 'Shift: 더하기 · Ctrl: 빼기 · Ctrl+C/V: 복사/붙여넣기 · Delete: 지우기 · Esc: 선택 해제';

const Tools = {
  pencil: freehandTool({
    id: 'pencil', label: '연필', key: 'B',
    desc: '한 칸씩 점을 찍어요. 왼쪽 클릭은 주 색, 오른쪽 클릭은 보조 색이에요.',
    hint: 'Shift+클릭: 마지막 점에서 직선으로 이어 그리기 · Alt: 스포이트 · 잉크를 "명암"으로 바꾸면 밝게/어둡게 칠해요',
  }, button => App.colorFor(button), true),

  eraser: freehandTool({
    id: 'eraser', label: '지우개', key: 'E',
    desc: '칸을 투명하게 지워요.',
    hint: '[ ] 키로 지우개 크기를 바꿀 수 있어요',
  }, () => TRANSPARENT, false),

  fill: {
    id: 'fill', label: '채우기', key: 'G',
    desc: '같은 색으로 이어진 영역을 한 번에 칠해요.',
    hint: '"이어진 곳만"을 끄면 그림 전체에서 같은 색을 모두 바꿔요 · 선택 영역이 있으면 그 안에서만 칠해요',
    options: ['contiguous'],
    down(p, button) {
      Editor.beginStroke('채우기');
      const clip = App.selection ? App.selection.mask : null;
      Raster.floodFill(App.activeImage(), p.x, p.y, App.colorFor(button), App.opt.contiguous, clip);
      Editor.refresh();
      Editor.endStroke();
    },
    move() {},
    up() {},
  },

  eyedropper: {
    id: 'eyedropper', label: '스포이트', key: 'I',
    desc: '그림에서 색을 뽑아와요. 왼쪽 클릭은 주 색, 오른쪽 클릭은 보조 색으로 가져와요.',
    hint: '다른 툴을 쓰는 중에도 Alt를 누른 채 클릭하면 바로 색을 뽑아요',
    options: [], edits: false,
    down(p, button) { this.button = button; this.pick(p); },
    move(p) { this.pick(p); },
    up() {},
    pick(p) {
      const c = Editor.pixelAt(p.x, p.y);
      if (c && c[3] > 0) App.setColor(this.button, ColorMode.isIndexed() ? ColorMode.nearest(c) : c);
    },
  },

  line: shapeTool({
    id: 'line', label: '직선', key: 'L',
    desc: '드래그해서 직선을 그려요.',
    hint: 'Shift: 가로 · 세로 · 45°로 반듯하게',
    options: ['size', 'brushShape', 'symmetry'],
  }, (s, e, plot) => Raster.line(s.x, s.y, e.x, e.y, plot), snapAngle),

  rect: shapeTool({
    id: 'rect', label: '사각형', key: 'U',
    desc: '드래그해서 사각형을 그려요.',
    hint: 'Shift: 정사각형 · "속 채우기"를 켜면 안을 칠해요',
    options: ['size', 'brushShape', 'fillShape', 'symmetry'],
  }, (s, e, plot, fillPlot) => {
    if (App.opt.fillShape) Raster.rectFill(s.x, s.y, e.x, e.y, fillPlot);
    Raster.rect(s.x, s.y, e.x, e.y, plot);
  }, snapSquare),

  ellipse: shapeTool({
    id: 'ellipse', label: '원', key: 'O',
    desc: '드래그해서 원이나 타원을 그려요.',
    hint: 'Shift: 정원 · "속 채우기"를 켜면 안을 칠해요',
    options: ['size', 'brushShape', 'fillShape', 'symmetry'],
  }, (s, e, plot, fillPlot) => {
    if (App.opt.fillShape) Raster.ellipseFill(s.x, s.y, e.x, e.y, fillPlot);
    Raster.ellipse(s.x, s.y, e.x, e.y, plot);
  }, snapSquare),

  select: {
    id: 'select', label: '사각 선택', key: 'M',
    desc: '드래그해서 네모나게 고르면, 그 안에서만 그려지고 옮기거나 뒤집을 수 있어요.',
    hint: SELECT_HINT,
    options: ['selMode', 'selActions'], edits: false,
    down(p, button, e) {
      this.mode = selModeFor(e);
      this.start = p;
      Editor.selPreview = { type: 'rect', a: p, b: p };
    },
    move(p) { Editor.selPreview.b = p; },
    up(p) {
      Editor.selPreview = null;
      if (p.x === this.start.x && p.y === this.start.y && this.mode === 'replace') Selection.clear();
      else Selection.apply(Selection.rectMask(this.start, p), this.mode);
      Editor.render();
    },
  },

  lasso: {
    id: 'lasso', label: '올가미', key: 'Q',
    desc: '마우스로 테두리를 그려서 자유로운 모양으로 골라요.',
    hint: SELECT_HINT,
    options: ['selMode', 'selActions'], edits: false,
    down(p, button, e) {
      this.mode = selModeFor(e);
      Editor.selPreview = { type: 'lasso', pts: [p] };
    },
    move(p) {
      const pts = Editor.selPreview.pts, last = pts[pts.length - 1];
      if (last.x !== p.x || last.y !== p.y) pts.push(p);
    },
    up() {
      const pts = Editor.selPreview.pts;
      Editor.selPreview = null;
      if (pts.length < 3) { if (this.mode === 'replace') Selection.clear(); }
      else Selection.apply(Selection.polygonMask(pts), this.mode);
      Editor.render();
    },
  },

  wand: {
    id: 'wand', label: '마술봉', key: 'W',
    desc: '누른 곳과 같은 색 영역을 한 번에 골라요.',
    hint: '"이어진 곳만"을 끄면 같은 색을 그림 전체에서 골라요 · ' + SELECT_HINT,
    options: ['selMode', 'contiguous', 'selActions'], edits: false,
    down(p, button, e) {
      const s = App.sprite;
      if (p.x < 0 || p.y < 0 || p.x >= s.width || p.y >= s.height) {
        if (selModeFor(e) === 'replace') Selection.clear();
        return;
      }
      Selection.apply(Selection.wandMask(App.activeImage(), p, App.opt.contiguous), selModeFor(e));
      Editor.render();
    },
    move() {},
    up() {},
  },

  move: {
    id: 'move', label: '이동', key: 'V',
    desc: '선택한 부분을 끌어서 옮겨요. 선택이 없으면 지금 칸의 그림 전체를 옮겨요.',
    hint: '선택 영역의 흰 네모 손잡이: 크기 조절 · 위쪽 동그라미: 회전 (Shift: 비율 유지 / 15°씩) · Ctrl+드래그: 복사해서 옮기기 · 방향키: 한 칸씩',
    options: ['selActions'],

    begin(copy) {
      const img = this.img = App.activeImage();
      const sel = App.selection;
      this.mask = sel ? sel.mask : null;
      this.b = sel ? sel.bounds : { x: 0, y: 0, w: img.w, h: img.h };
      this.base = new Uint8ClampedArray(img.data);
      this.cleared = new Uint8ClampedArray(img.data);
      if (!copy) {
        for (let y = this.b.y; y < this.b.y + this.b.h; y++) for (let x = this.b.x; x < this.b.x + this.b.w; x++) {
          const i = y * img.w + x;
          if (!this.mask || this.mask[i]) this.cleared.fill(0, i * 4, i * 4 + 4);
        }
      }
      Editor.beginStroke(copy ? '복사해서 옮기기' : '옮기기');
    },

    shift(dx, dy) {
      const img = this.img, W = img.w, b = this.b, base = this.base;
      img.data.set(this.cleared);
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = y * W + x;
        if (this.mask && !this.mask[i]) continue;
        if (!base[i * 4 + 3]) continue;
        const nx = x + dx, ny = y + dy;
        if (!img.inBounds(nx, ny)) continue;
        img.data.set(base.subarray(i * 4, i * 4 + 4), (ny * W + nx) * 4);
      }
      Editor.selOffset = this.mask ? { dx, dy } : null;
    },

    finish(dx, dy) {
      Editor.selOffset = null;
      if (this.mask && (dx || dy)) {
        const W = this.img.w, H = this.img.h, m = Selection.newMask();
        const b = this.b;
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
          if (!this.mask[y * W + x]) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) m[ny * W + nx] = 1;
        }
        Selection.set(m);
      }
      Editor.endStroke();
      Editor.refresh();
    },

    down(p, button, e) {
      // 선택 영역 손잡이를 잡았으면 크기 조절 / 회전
      const handle = Editor.handleAt(p.sx, p.sy);
      if (handle) return this.beginTransform(handle, p);
      this.tf = null;
      this.start = p;
      this.d = { dx: 0, dy: 0 };
      this.begin(e.ctrlKey || e.metaKey);
    },
    move(p, e) {
      if (this.tf) return this.moveTransform(p, e);
      let dx = p.x - this.start.x, dy = p.y - this.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (dx === this.d.dx && dy === this.d.dy) return;
      this.d = { dx, dy };
      this.shift(dx, dy);
      Editor.refresh();
    },
    up() {
      if (this.tf) return this.endTransform();
      this.finish(this.d.dx, this.d.dy);
    },

    // ---------- 손잡이로 크기 조절 · 회전 ----------
    beginTransform(handle, p) {
      const img = this.img = App.activeImage(), W = img.w;
      const sel = App.selection, b = sel.bounds;
      const src = new PixelImage(b.w, b.h), srcMask = new Uint8Array(b.w * b.h);
      this.cleared = new Uint8ClampedArray(img.data);
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = y * W + x;
        if (!sel.mask[i]) continue;
        src.set(x - b.x, y - b.y, img.get(x, y));
        srcMask[(y - b.y) * b.w + (x - b.x)] = 1;
        this.cleared.fill(0, i * 4, i * 4 + 4);
      }
      this.tf = { handle, b, src, srcMask, start: Editor.toSpriteF(p), mask: null };
      Editor.beginStroke(handle.kind === 'rotate' ? '회전' : '크기 조절');
      Editor.transforming = true;
    },

    moveTransform(p, e) {
      const tf = this.tf, b = tf.b, img = this.img, W = img.w, H = img.h;
      const f = Editor.toSpriteF(p);
      img.data.set(this.cleared);
      const mask = new Uint8Array(W * H);
      const put = (x, y, sx, sy) => {
        if (x < 0 || y < 0 || x >= W || y >= H || !tf.srcMask[sy * b.w + sx]) return;
        const c = tf.src.get(sx, sy);
        if (c[3]) img.set(x, y, c);
        mask[y * W + x] = 1;
      };
      if (tf.handle.kind === 'scale') {
        const { hx, hy } = tf.handle;
        let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
        if (hx === 0) x0 = Math.min(x1 - 1, Math.round(f.x));
        if (hx === 1) x1 = Math.max(x0 + 1, Math.round(f.x));
        if (hy === 0) y0 = Math.min(y1 - 1, Math.round(f.y));
        if (hy === 1) y1 = Math.max(y0 + 1, Math.round(f.y));
        // Shift + 모서리: 비율 유지 (고정된 반대쪽 모서리 기준)
        if (e.shiftKey && hx !== 0.5 && hy !== 0.5) {
          const k = Math.max((x1 - x0) / b.w, (y1 - y0) / b.h);
          const nw = Math.max(1, Math.round(b.w * k)), nh = Math.max(1, Math.round(b.h * k));
          if (hx === 0) x0 = x1 - nw; else x1 = x0 + nw;
          if (hy === 0) y0 = y1 - nh; else y1 = y0 + nh;
        }
        const nw = x1 - x0, nh = y1 - y0;
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
          put(x0 + x, y0 + y, Math.floor(x * b.w / nw), Math.floor(y * b.h / nh));
        }
        Editor.tfInfo = `${b.w}×${b.h} → ${nw}×${nh}`;
      } else {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        let angle = Math.atan2(f.y - cy, f.x - cx) - Math.atan2(tf.start.y - cy, tf.start.x - cx);
        if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12); // 15°씩
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const r = Math.ceil(Math.hypot(b.w, b.h) / 2) + 1;
        // 결과 칸마다 원래 그림의 어느 칸인지 거꾸로 찾는다 (가장 가까운 칸)
        for (let y = Math.floor(cy - r); y < cy + r; y++) for (let x = Math.floor(cx - r); x < cx + r; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const sx = Math.floor(dx * cos + dy * sin + b.w / 2), sy = Math.floor(-dx * sin + dy * cos + b.h / 2);
          if (sx >= 0 && sy >= 0 && sx < b.w && sy < b.h) put(x, y, sx, sy);
        }
        let deg = Math.round(angle * 180 / Math.PI) % 360;
        if (deg > 180) deg -= 360; else if (deg <= -180) deg += 360;
        Editor.tfInfo = `회전 ${deg}°${e.shiftKey ? '' : ' (Shift: 15°씩)'}`;
      }
      tf.mask = mask;
      Editor.refresh();
      App.emit('hover');
    },

    endTransform() {
      const tf = this.tf;
      this.tf = null;
      Editor.transforming = false;
      Editor.tfInfo = null;
      if (tf.mask) Selection.set(tf.mask);
      Editor.endStroke();
      Editor.refresh();
    },

    // 방향키로 한 칸씩
    nudge(dx, dy) {
      if (!Selection.canEdit()) return;
      this.begin(false);
      this.shift(dx, dy);
      this.finish(dx, dy);
    },
  },

  gradient: {
    id: 'gradient', label: '그라데이션', key: 'D',
    desc: '드래그한 방향으로 주 색에서 보조 색으로 점점 바뀌게 칠해요.',
    hint: '디더링을 고르면 픽셀 아트처럼 점 무늬로 섞여요 · 오른쪽 드래그는 색 순서 반대 · Shift: 45° 단위 · 선택 영역이 있으면 그 안만',
    options: ['gradShape', 'gradDither', 'gradArea'],
    down(p, button) {
      const img = this.img = App.activeImage(), W = img.w;
      this.start = p;
      this.base = new Uint8ClampedArray(img.data);
      [this.c0, this.c1] = button === 'right' ? [App.bg, App.fg] : [App.fg, App.bg];
      // 칠할 곳: 선택 영역 > (같은 색 영역 모드면) 누른 곳과 이어진 같은 색 > 칸 전체
      this.area = null;
      if (App.selection) this.area = App.selection.mask;
      else if (App.opt.gradArea === 'region' && img.inBounds(p.x, p.y)) {
        this.area = new Uint8Array(W * img.h);
        for (const i of Raster.colorRegion(img, p.x, p.y, true, null)) this.area[i] = 1;
      }
      Editor.beginStroke('그라데이션');
      Editor.gradLine = { a: p, b: p };
    },
    move(p, e) {
      const b = e.shiftKey ? snapAngle(this.start, p) : p;
      Editor.gradLine = { a: this.start, b };
      this.img.data.set(this.base);
      this.paint(this.start, b);
      Editor.refresh();
    },
    up() {
      Editor.gradLine = null;
      Editor.endStroke();
      Editor.refresh();
    },
    paint(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      if (!len2) return;
      const img = this.img, area = this.area, radial = App.opt.gradShape === 'radial';
      const matrix = BAYER[App.opt.gradDither], n = matrix ? matrix.length : 0;
      const c0 = this.c0, c1 = this.c1, indexed = ColorMode.isIndexed();
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        if (area && !area[y * img.w + x]) continue;
        let t = radial
          ? Math.sqrt(((x - a.x) ** 2 + (y - a.y) ** 2) / len2)
          : ((x - a.x) * dx + (y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        let c;
        if (matrix) c = t > (matrix[y % n][x % n] + 0.5) / (n * n) ? c1 : c0;
        else {
          c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
          if (indexed && c[3]) c = [...ColorMode.nearest(c).slice(0, 3), c[3]];
        }
        img.set(x, y, c);
      }
    },
  },

  hand: {
    id: 'hand', label: '손', key: 'H',
    desc: '화면을 끌어서 움직여요.',
    hint: '어떤 툴이든 Space를 누른 채 드래그하면 화면이 움직여요 · 휠로 확대/축소',
    options: [], edits: false,
    down() {}, move() {}, up() {},
  },
};

// 디더링 무늬 (Bayer 행렬): 칸마다 다른 기준값으로 두 색 중 하나를 고른다
const BAYER = {
  bayer2: [[0, 2], [3, 1]],
  bayer4: [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
};

const TOOL_ORDER = ['pencil', 'eraser', 'fill', 'gradient', 'eyedropper', '|', 'line', 'rect', 'ellipse', '|', 'select', 'lasso', 'wand', 'move', '|', 'hand'];
