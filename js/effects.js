// 효과: 외곽선 · 색 바꾸기 · 색조/채도/밝기
// 창을 연 동안에는 원본을 들고 있다가 값이 바뀔 때마다 원본에서 다시 계산해 미리 보여 준다.
// 적용하면 실행 취소 기록 하나로 남기고, 취소하면 원본으로 되돌린다.

const Effects = {
  // ---------- 순수 계산 (테스트 가능) ----------
  // 투명한 칸 중에서 그림과 맞닿은 칸을 color로 칠한다
  outlineImage(img, color, diagonal, clip) {
    const { w, h } = img, src = img.data.slice(), d = img.data;
    const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i * 4 + 3] || (clip && !clip[i])) continue;
      let touch = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1);
      if (!touch && diagonal) touch = solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1);
      if (touch) d.set([color[0], color[1], color[2], 255], i * 4);
    }
  },

  // from과 비슷한 색(tolerance 0~100)을 to로 바꾼다. 투명도는 그대로 둔다.
  replaceImage(img, from, to, tolerance, clip) {
    const max = (tolerance / 100) * 441.7, d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3] || (clip && !clip[i / 4])) continue;
      const dist = Math.hypot(d[i] - from[0], d[i + 1] - from[1], d[i + 2] - from[2]);
      if (dist > max) continue;
      d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2];
    }
  },

  // 색조(-180~180도), 채도(-100~100), 밝기(-100~100)
  adjustImage(img, hue, sat, light, clip, snap) {
    const d = img.data, cache = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3] || (clip && !clip[i / 4])) continue;
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let c = cache.get(key);
      if (!c) {
        let [hh, ss, ll] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        hh = (hh + hue / 360 + 1) % 1;
        ss = Math.max(0, Math.min(1, sat >= 0 ? ss + (1 - ss) * sat / 100 : ss * (1 + sat / 100)));
        ll = Math.max(0, Math.min(1, light >= 0 ? ll + (1 - ll) * light / 100 : ll * (1 + light / 100)));
        c = hslToRgb(hh, ss, ll);
        if (snap) c = snap(c);
        cache.set(key, c);
      }
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
  },

  // ---------- 대상 고르기 ----------
  // scope: cel(지금 칸) · layer(지금 레이어의 모든 프레임) · all(모든 레이어 · 프레임)
  // 잠긴 레이어와 타일맵 레이어는 건너뛴다.
  targets(scope) {
    const s = App.sprite, skipped = new Set(), out = [];
    const layers = scope === 'all' ? s.layers : [App.currentLayer()];
    for (const l of layers) {
      if (l.reference) { if (scope !== 'all') skipped.add(`"${l.name}"(밑그림)`); continue; }
      if (l.locked) { skipped.add(`"${l.name}"(잠김)`); continue; }
      if (l.tileset) { skipped.add(`"${l.name}"(타일맵)`); continue; }
      const cels = scope === 'cel' ? [l.cels[App.frame]] : l.cels;
      for (const cel of cels) if (!out.includes(cel)) out.push(cel); // 링크된 셀은 한 번만
    }
    return { cels: out, skipped: [...skipped] };
  },

  // ---------- 미리보기 ----------
  preview: null, // { scope, cels, originals }

  beginPreview(scope) {
    this.cancelPreview();
    const { cels, skipped } = this.targets(scope);
    this.preview = { scope, cels, skipped, originals: cels.map(c => c.image.data.slice()) };
    return this.preview;
  },

  // 원본에서 다시 계산한다
  render(fn) {
    const p = this.preview;
    if (!p) return;
    const clip = App.selection ? App.selection.mask : null;
    p.cels.forEach((cel, i) => {
      cel.image.data.set(p.originals[i]);
      fn(cel.image, clip);
      cel.invalidate();
    });
    Editor.refresh();
  },

  cancelPreview() {
    const p = this.preview;
    if (!p) return;
    this.preview = null;
    p.cels.forEach((cel, i) => { cel.image.data.set(p.originals[i]); cel.invalidate(); });
    if (App.sprite) Editor.refresh();
  },

  commit(label) {
    const p = this.preview;
    if (!p) return false;
    this.preview = null;
    const before = p.originals, after = p.cels.map(c => c.image.data.slice());
    const changed = before.some((b, i) => b.some((v, k) => v !== after[i][k]));
    if (!changed) return false;
    const cels = p.cels;
    const apply = datas => { cels.forEach((cel, i) => { cel.image.data.set(datas[i]); cel.invalidate(); }); };
    App.history.push({ label, undo: () => apply(before), redo: () => apply(after) });
    App.afterHistoryMove();
    return true;
  },

  // ---------- 대화상자 ----------
  tab: 'outline',
  scope: 'cel',
  opts: { diagonal: false, tolerance: 0, hue: 0, sat: 0, light: 0, from: null, to: null },

  init() {
    document.querySelectorAll('#fx-tabs button').forEach(b => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.refreshDialog(); }));
    document.querySelectorAll('#fx-scope button').forEach(b => b.addEventListener('click', () => {
      this.scope = b.dataset.scope;
      this.beginPreview(this.scope);
      this.refreshDialog();
    }));
    const num = (id, key) => $(id).addEventListener('input', () => { this.opts[key] = +$(id).value; this.update(); });
    num('#fx-tolerance', 'tolerance');
    num('#fx-hue', 'hue');
    num('#fx-sat', 'sat');
    num('#fx-light', 'light');
    $('#fx-diagonal').addEventListener('change', () => { this.opts.diagonal = $('#fx-diagonal').checked; this.update(); });
    $('#fx-from').addEventListener('input', () => { this.opts.from = hexToColor($('#fx-from').value); this.update(); });
    $('#fx-to').addEventListener('input', () => { this.opts.to = hexToColor($('#fx-to').value); this.update(); });
    $('#fx-outline-color').addEventListener('input', () => { this.opts.outline = hexToColor($('#fx-outline-color').value); this.update(); });
    $('#fx-reset').addEventListener('click', () => {
      Object.assign(this.opts, { hue: 0, sat: 0, light: 0 });
      this.refreshDialog();
    });
    $('#fx-go').addEventListener('click', () => {
      const label = { outline: '외곽선', replace: '색 바꾸기', adjust: '색조 · 밝기' }[this.tab];
      const done = { outline: '외곽선을 넣었어요', replace: '색을 바꿨어요', adjust: '색조 · 밝기를 바꿨어요' }[this.tab];
      const ok = this.commit(label);
      UI.closeModals();
      UI.toast(ok ? `${done}. 되돌리려면 Ctrl+Z.` : '바뀐 칸이 없어요.');
    });
  },

  show(tab) {
    if (!App.sprite) return;
    if (tab) this.tab = tab;
    // 처음 열 때 색은 지금 주 색 / 보조 색으로
    this.opts.outline = App.fg.slice();
    this.opts.from = App.fg.slice();
    this.opts.to = App.bg.slice();
    UI.openModal('#dlg-fx');
    this.beginPreview(this.scope);
    this.refreshDialog();
  },

  refreshDialog() {
    const o = this.opts;
    document.querySelectorAll('#fx-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
    document.querySelectorAll('#fx-scope button').forEach(b => b.classList.toggle('on', b.dataset.scope === this.scope));
    for (const t of ['outline', 'replace', 'adjust']) $('#fx-' + t).hidden = t !== this.tab;
    $('#fx-outline-color').value = colorToHex(o.outline);
    $('#fx-diagonal').checked = o.diagonal;
    $('#fx-from').value = colorToHex(o.from);
    $('#fx-to').value = colorToHex(o.to);
    $('#fx-tolerance').value = o.tolerance;
    $('#fx-hue').value = o.hue;
    $('#fx-sat').value = o.sat;
    $('#fx-light').value = o.light;
    this.update();
  },

  update() {
    const o = this.opts, p = this.preview;
    $('#fx-tolerance-val').textContent = o.tolerance === 0 ? '똑같은 색만' : `비슷한 색까지 (${o.tolerance})`;
    $('#fx-hue-val').textContent = `${o.hue > 0 ? '+' : ''}${o.hue}°`;
    $('#fx-sat-val').textContent = `${o.sat > 0 ? '+' : ''}${o.sat}`;
    $('#fx-light-val').textContent = `${o.light > 0 ? '+' : ''}${o.light}`;
    const snap = ColorMode.isIndexed() ? c => ColorMode.nearest(c) : null;
    if (this.tab === 'outline') this.render((img, clip) => this.outlineImage(img, o.outline, o.diagonal, clip));
    else if (this.tab === 'replace') this.render((img, clip) => this.replaceImage(img, o.from, snap ? snap(o.to) : o.to, o.tolerance, clip));
    else this.render((img, clip) => this.adjustImage(img, o.hue, o.sat, o.light, clip, snap));

    const notes = [];
    if (p) notes.push(`대상: ${{ cel: '지금 칸', layer: '지금 레이어의 모든 프레임', all: '모든 레이어 · 프레임' }[p.scope]} (${p.cels.length}칸)`);
    if (App.selection) notes.push('선택한 영역 안에서만 바뀌어요');
    if (p && p.skipped.length) notes.push(`건너뜀: ${p.skipped.join(', ')}`);
    if (p && !p.cels.length) notes.push('바꿀 수 있는 칸이 없어요');
    if (snap && this.tab !== 'outline') notes.push('팔레트 전용 모드라 결과를 팔레트 색으로 맞춰요');
    $('#fx-note').textContent = notes.join(' · ');
    $('#fx-go').disabled = !p || !p.cels.length;
  },
};

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
