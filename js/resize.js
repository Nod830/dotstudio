// 크기 바꾸기
//   선택 영역 크기 조절: 선택한 부분(없으면 지금 칸 전체)을 늘리거나 줄인다
//   그림 크기: 모든 레이어 · 프레임을 같이 늘리거나 줄인다
//   캔버스 크기: 그림은 그대로 두고 바깥을 자르거나 여백을 붙인다
// 픽셀 아트라서 모두 "가장 가까운 칸" 방식으로 키워서 흐려지지 않는다.

const MAX_SIZE = 1024;

function scaleImage(src, dw, dh) {
  const out = new PixelImage(dw, dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.floor(y * src.h / dh);
    for (let x = 0; x < dw; x++) {
      const sx = Math.floor(x * src.w / dw);
      const i = (sy * src.w + sx) * 4;
      out.data.set(src.data.subarray(i, i + 4), (y * dw + x) * 4);
    }
  }
  return out;
}

const Resize = {
  // ---------- 선택 영역 ----------
  scaleSelection(dw, dh) {
    if (!Selection.canEdit()) return;
    const img = App.activeImage(), W = img.w;
    const { mask, b } = Selection.region();
    if (dw === b.w && dh === b.h) return;
    Editor.beginStroke('크기 조절');
    const src = new PixelImage(b.w, b.h), srcMask = new Uint8Array(b.w * b.h);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (mask && !mask[y * W + x]) continue;
      src.set(x - b.x, y - b.y, img.get(x, y));
      srcMask[(y - b.y) * b.w + (x - b.x)] = 1;
      img.set(x, y, TRANSPARENT);
    }
    // 원래 가운데를 기준으로 놓는다
    const x0 = Math.round(b.x + b.w / 2 - dw / 2), y0 = Math.round(b.y + b.h / 2 - dh / 2);
    const newMask = mask ? Selection.newMask() : null;
    for (let y = 0; y < dh; y++) {
      const sy = Math.floor(y * b.h / dh);
      for (let x = 0; x < dw; x++) {
        const sx = Math.floor(x * b.w / dw);
        if (!srcMask[sy * b.w + sx]) continue;
        const px = x0 + x, py = y0 + y;
        if (!img.inBounds(px, py)) continue;
        const c = src.get(sx, sy);
        if (c[3]) img.set(px, py, c);
        if (newMask) newMask[py * W + px] = 1;
      }
    }
    if (newMask) Selection.set(newMask);
    Editor.endStroke();
    Editor.refresh();
  },

  // ---------- 그림 전체 ----------
  // 레이어를 새로 만들어 바꿔 끼우므로 실행 취소하면 원래 레이어가 그대로 돌아온다.
  rebuild(label, nw, nh, makeImage) {
    const s = App.sprite;
    const hadTilemap = s.layers.some(l => l.tileset);
    Selection.clear();
    App.exec(label, sp => {
      sp.width = nw;
      sp.height = nh;
      sp.layers = sp.layers.map(l => {
        const nl = new Layer(l.name);
        Object.assign(nl, { visible: l.visible, locked: l.locked, opacity: l.opacity, reference: l.reference });
        nl.cels = cloneCels(l.cels, c => new Cel(makeImage(c.image)));
        return nl;
      });
    });
    if (hadTilemap) UI.toast('크기를 바꾸면서 타일맵 레이어는 일반 레이어로 바뀌었어요. 되돌리려면 Ctrl+Z.');
  },

  resizeSprite(nw, nh) {
    const s = App.sprite;
    if (nw === s.width && nh === s.height) return;
    this.rebuild('그림 크기 바꾸기', nw, nh, img => scaleImage(img, nw, nh));
  },

  // ax, ay: 0 = 왼쪽/위, 0.5 = 가운데, 1 = 오른쪽/아래 기준
  canvasSize(nw, nh, ax, ay) {
    const s = App.sprite;
    if (nw === s.width && nh === s.height) return;
    const dx = Math.round((nw - s.width) * ax), dy = Math.round((nh - s.height) * ay);
    this.rebuild('캔버스 크기 바꾸기', nw, nh, img => {
      const out = new PixelImage(nw, nh);
      for (let y = 0; y < img.h; y++) {
        const ny = y + dy;
        if (ny < 0 || ny >= nh) continue;
        for (let x = 0; x < img.w; x++) {
          const nx = x + dx;
          if (nx < 0 || nx >= nw) continue;
          const i = (y * img.w + x) * 4;
          out.data.set(img.data.subarray(i, i + 4), (ny * nw + nx) * 4);
        }
      }
      return out;
    });
  },

  // ---------- 대화상자 ----------
  // 가로 · 세로 입력과 비율 고정을 묶는다
  bindSizeInputs(wSel, hSel, lockSel, base) {
    const w = $(wSel), h = $(hSel), lock = $(lockSel);
    w.oninput = () => { if (lock.checked) h.value = Math.max(1, Math.round(+w.value * base().h / base().w)); this.renderInfo(); };
    h.oninput = () => { if (lock.checked) w.value = Math.max(1, Math.round(+h.value * base().w / base().h)); this.renderInfo(); };
  },

  readSize(wSel, hSel) {
    const clamp = v => Math.max(1, Math.min(MAX_SIZE, Math.round(+v) || 1));
    return [clamp($(wSel).value), clamp($(hSel).value)];
  },

  init() {
    // 선택 영역 크기
    const selBase = () => Selection.region().b;
    this.bindSizeInputs('#scale-w', '#scale-h', '#scale-lock', selBase);
    document.querySelectorAll('#scale-presets button').forEach(b => b.addEventListener('click', () => {
      const k = +b.dataset.k, r = selBase();
      $('#scale-w').value = Math.max(1, Math.round(r.w * k));
      $('#scale-h').value = Math.max(1, Math.round(r.h * k));
    }));
    $('#scale-go').addEventListener('click', () => {
      UI.closeModals();
      this.scaleSelection(...this.readSize('#scale-w', '#scale-h'));
    });

    // 그림 / 캔버스 크기
    const spriteBase = () => ({ w: App.sprite.width, h: App.sprite.height });
    this.bindSizeInputs('#size-w', '#size-h', '#size-lock', spriteBase);
    document.querySelectorAll('#size-kind button').forEach(b => b.addEventListener('click', () => { this.kind = b.dataset.kind; this.renderSizeDialog(); }));
    document.querySelectorAll('#size-presets button').forEach(b => b.addEventListener('click', () => {
      const k = +b.dataset.k;
      $('#size-w').value = Math.max(1, Math.min(MAX_SIZE, Math.round(App.sprite.width * k)));
      $('#size-h').value = Math.max(1, Math.min(MAX_SIZE, Math.round(App.sprite.height * k)));
      this.renderInfo();
    }));
    const anchors = $('#size-anchor');
    for (let i = 0; i < 9; i++) {
      const b = el('button', { 'data-i': i });
      b.addEventListener('click', () => { this.anchor = i; this.renderSizeDialog(); });
      anchors.append(b);
    }
    $('#size-go').addEventListener('click', () => {
      const [w, h] = this.readSize('#size-w', '#size-h');
      UI.closeModals();
      if (this.kind === 'canvas') this.canvasSize(w, h, (this.anchor % 3) / 2, Math.floor(this.anchor / 3) / 2);
      else this.resizeSprite(w, h);
    });
  },

  kind: 'scale',
  anchor: 4,

  showScaleDialog() {
    if (!App.sprite || !Selection.canEdit()) return;
    const b = Selection.region().b;
    $('#scale-w').value = b.w;
    $('#scale-h').value = b.h;
    $('#scale-target').textContent = App.selection ? `선택한 부분 (${b.w}×${b.h})` : `지금 칸 전체 (${b.w}×${b.h})`;
    UI.openModal('#dlg-scale');
  },

  showSizeDialog() {
    if (!App.sprite) return;
    $('#size-w').value = App.sprite.width;
    $('#size-h').value = App.sprite.height;
    this.renderSizeDialog();
    UI.openModal('#dlg-size');
  },

  renderSizeDialog() {
    document.querySelectorAll('#size-kind button').forEach(b => b.classList.toggle('on', b.dataset.kind === this.kind));
    document.querySelectorAll('#size-anchor button').forEach(b => b.classList.toggle('on', +b.dataset.i === this.anchor));
    $('#size-anchor-field').hidden = this.kind !== 'canvas';
    $('#size-presets').hidden = this.kind === 'canvas';
    $('#size-lock-row').hidden = this.kind === 'canvas';
    if (this.kind === 'canvas') $('#size-lock').checked = false;
    this.renderInfo();
  },

  renderInfo() {
    const info = $('#size-info');
    if (!info || !App.sprite) return;
    const [w, h] = this.readSize('#size-w', '#size-h');
    const s = App.sprite;
    if (w === s.width && h === s.height) { info.textContent = '지금 크기와 같아요. 숫자를 바꿔 보세요.'; return; }
    info.textContent = this.kind === 'canvas'
      ? `${s.width}×${s.height} → ${w}×${h}. 그림 크기는 그대로고, ${w < s.width || h < s.height ? '바깥이 잘려요' : '빈 여백이 생겨요'}.`
      : `${s.width}×${s.height} → ${w}×${h}. 모든 레이어와 프레임이 같이 ${w * h >= s.width * s.height ? '커져요' : '작아져요'}.`;
  },
};
