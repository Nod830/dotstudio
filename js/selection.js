// 선택 영역: App.selection = { mask: Uint8Array(w*h), bounds: {x,y,w,h}, edges } 또는 null
// mask 배열은 한 번 만들면 고치지 않는다 (실행 취소 기록이 참조를 그대로 들고 있기 때문).

const Selection = {
  clipboard: null,

  newMask() {
    const s = App.sprite;
    return new Uint8Array(s.width * s.height);
  },

  rectMask(a, b) {
    const s = App.sprite, m = this.newMask();
    const x0 = Math.max(0, Math.min(a.x, b.x)), x1 = Math.min(s.width - 1, Math.max(a.x, b.x));
    const y0 = Math.max(0, Math.min(a.y, b.y)), y1 = Math.min(s.height - 1, Math.max(a.y, b.y));
    for (let y = y0; y <= y1; y++) m.fill(1, y * s.width + x0, y * s.width + x1 + 1);
    return m;
  },

  // 올가미: 다각형 안쪽 칸 + 그린 선 위의 칸
  polygonMask(pts) {
    const s = App.sprite, m = this.newMask(), W = s.width, H = s.height;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(W - 1, Math.max(...xs));
    const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(H - 1, Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const pi = pts[i], pj = pts[j];
          const yi = pi.y + 0.5, yj = pj.y + 0.5;
          if ((yi > cy) !== (yj > cy) && cx < (pj.x - pi.x) * (cy - yi) / (yj - yi) + pi.x + 0.5) inside = !inside;
        }
        if (inside) m[y * W + x] = 1;
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      Raster.line(a.x, a.y, b.x, b.y, (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1; });
    }
    return m;
  },

  wandMask(img, p, contiguous) {
    const m = this.newMask();
    for (const i of Raster.colorRegion(img, p.x, p.y, contiguous, null)) m[i] = 1;
    return m;
  },

  apply(mask, mode) {
    const cur = App.selection && App.selection.mask;
    let out;
    if (mode === 'replace' || !cur) {
      out = mode === 'subtract' ? null : mask;
    } else {
      out = cur.slice();
      for (let i = 0; i < out.length; i++) {
        if (mode === 'add') out[i] |= mask[i];
        else if (mask[i]) out[i] = 0;
      }
    }
    this.set(out);
  },

  set(mask) {
    let sel = null;
    if (mask) {
      const b = this.bounds(mask);
      if (b) sel = { mask, bounds: b, edges: this.edges(mask, b) };
    }
    App.selection = sel;
    App.emit('selection');
  },

  clear() { if (App.selection) this.set(null); },
  all() { this.set(this.newMask().fill(1)); },
  invert() {
    if (!App.selection) return this.all();
    this.set(App.selection.mask.map(v => v ? 0 : 1));
  },

  bounds(mask) {
    const W = App.sprite.width, H = App.sprite.height;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  },

  // 점선 테두리용 선분 목록 [x1, y1, x2, y2] (스프라이트 좌표, 칸 경계). 같은 줄의 선분은 이어 붙인다.
  edges(mask, b) {
    const W = App.sprite.width, H = App.sprite.height;
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
    const segs = [];
    for (let y = b.y; y <= b.y + b.h; y++) {
      let topRun = -1, botRun = -1;
      for (let x = b.x; x <= b.x + b.w; x++) {
        const top = on(x, y) && !on(x, y - 1); // 이 칸의 윗변
        if (top && topRun < 0) topRun = x;
        if (!top && topRun >= 0) { segs.push([topRun, y, x, y]); topRun = -1; }
        const bot = on(x, y - 1) && !on(x, y); // 윗칸의 아랫변
        if (bot && botRun < 0) botRun = x;
        if (!bot && botRun >= 0) { segs.push([botRun, y, x, y]); botRun = -1; }
      }
    }
    for (let x = b.x; x <= b.x + b.w; x++) {
      let lRun = -1, rRun = -1;
      for (let y = b.y; y <= b.y + b.h; y++) {
        const l = on(x, y) && !on(x - 1, y);
        if (l && lRun < 0) lRun = y;
        if (!l && lRun >= 0) { segs.push([x, lRun, x, y]); lRun = -1; }
        const r = on(x - 1, y) && !on(x, y);
        if (r && rRun < 0) rRun = y;
        if (!r && rRun >= 0) { segs.push([x, rRun, x, y]); rRun = -1; }
      }
    }
    return segs;
  },

  // ---------- 편집 명령 ----------
  // 지금 칸에 그릴 수 있는지 확인하고, 안 되면 이유를 알려 준다
  canEdit() {
    const layer = App.currentLayer();
    if (layer.locked) { UI.toast(`🔒 "${layer.name}" 레이어는 잠겨 있어요.`); return false; }
    if (!layer.visible) { UI.toast(`👁 "${layer.name}" 레이어가 숨겨져 있어요.`); return false; }
    return true;
  },

  // 선택 영역(없으면 그림 전체)의 칸 번호와 범위
  region() {
    const s = App.sprite;
    if (App.selection) return { mask: App.selection.mask, b: App.selection.bounds };
    return { mask: null, b: { x: 0, y: 0, w: s.width, h: s.height } };
  },

  transform(kind) {
    if (!this.canEdit()) return;
    const labels = { flipH: '좌우 뒤집기', flipV: '상하 뒤집기', rotCW: '오른쪽으로 회전', rotCCW: '왼쪽으로 회전' };
    const img = App.activeImage(), W = img.w;
    const { mask, b } = this.region();
    Editor.beginStroke(labels[kind]);
    const lifted = [];
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (mask && !mask[y * W + x]) continue;
      lifted.push([x, y, img.get(x, y)]);
      img.set(x, y, TRANSPARENT);
    }
    // 회전하면 가로세로가 바뀐 상자를 같은 중심에 놓는다
    // 그림 밖으로 나가면 안쪽으로 밀어 넣는다
    const clamp = (v, max) => Math.max(0, Math.min(Math.max(0, max), v));
    const nbx = clamp(b.x + Math.floor((b.w - b.h) / 2), img.w - b.h);
    const nby = clamp(b.y + Math.floor((b.h - b.w) / 2), img.h - b.w);
    const newMask = mask ? this.newMask() : null;
    for (const [x, y, c] of lifted) {
      const rx = x - b.x, ry = y - b.y;
      let nx, ny;
      if (kind === 'flipH') { nx = b.x + b.w - 1 - rx; ny = y; }
      else if (kind === 'flipV') { nx = x; ny = b.y + b.h - 1 - ry; }
      else if (kind === 'rotCW') { nx = nbx + (b.h - 1 - ry); ny = nby + rx; }
      else { nx = nbx + ry; ny = nby + (b.w - 1 - rx); }
      if (!img.inBounds(nx, ny)) continue;
      img.set(nx, ny, c);
      if (newMask) newMask[ny * W + nx] = 1;
    }
    if (newMask) this.set(newMask);
    Editor.endStroke();
    Editor.refresh();
  },

  copy(silent) {
    const img = App.activeImage(), W = img.w;
    const { mask, b } = this.region();
    const data = new Uint8ClampedArray(b.w * b.h * 4);
    let any = false;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const sx = b.x + x, sy = b.y + y;
      if (mask && !mask[sy * W + sx]) continue;
      const c = img.get(sx, sy);
      data.set(c, (y * b.w + x) * 4);
      if (c[3]) any = true;
    }
    this.clipboard = { x: b.x, y: b.y, w: b.w, h: b.h, data };
    if (!silent) UI.toast(any ? '📋 복사했어요. Ctrl+V로 붙여 넣을 수 있어요. 다른 프레임에서도 돼요.' : '선택한 곳이 비어 있어요.');
  },

  cut() {
    if (!this.canEdit()) return;
    this.copy(true);
    this.deleteSelected('잘라내기');
  },

  deleteSelected(label = '선택 영역 지우기') {
    if (!App.selection) return App.clearCel();
    if (!this.canEdit()) return;
    const img = App.activeImage(), mask = App.selection.mask, W = img.w;
    Editor.beginStroke(label);
    const b = App.selection.bounds;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++)
      if (mask[y * W + x]) img.set(x, y, TRANSPARENT);
    Editor.endStroke();
    Editor.refresh();
  },

  paste() {
    const clip = this.clipboard;
    if (!clip) return UI.toast('먼저 Ctrl+C로 복사해 주세요.');
    if (!this.canEdit()) return;
    const img = App.activeImage(), W = img.w;
    // 원래 자리에 붙이되, 그림 밖이면 안쪽으로 당긴다
    const ox = Math.max(0, Math.min(img.w - clip.w, clip.x));
    const oy = Math.max(0, Math.min(img.h - clip.h, clip.y));
    Editor.beginStroke('붙여넣기');
    const mask = this.newMask();
    for (let y = 0; y < clip.h; y++) for (let x = 0; x < clip.w; x++) {
      const i = (y * clip.w + x) * 4;
      if (!clip.data[i + 3]) continue;
      const nx = ox + x, ny = oy + y;
      if (!img.inBounds(nx, ny)) continue;
      img.set(nx, ny, clip.data.subarray(i, i + 4));
      mask[ny * W + nx] = 1;
    }
    this.set(mask);
    Editor.endStroke();
    Editor.refresh();
    App.setTool('move');
    UI.toast('붙여 넣었어요. 드래그해서 원하는 곳으로 옮기세요.');
  },
};
