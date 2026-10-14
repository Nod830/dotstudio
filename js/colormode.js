// 색 모드
//   rgb      자유 색: 어떤 색이든 칠할 수 있다
//   indexed  팔레트 전용: 팔레트에 있는 색만 쓴다. 팔레트 색을 바꾸면 그 색을 쓴 모든 칸이 함께 바뀐다.
// 픽셀은 두 모드 모두 RGBA로 저장하고, 인덱스 모드는 "팔레트 색만 쓰도록" 지키는 방식으로 동작한다.

const ColorMode = {
  isIndexed() { return App.sprite && App.sprite.colorMode === 'indexed'; },

  nearest(c, palette = App.palette) {
    let best = palette[0], bestD = Infinity;
    for (const p of palette) {
      const d = (p[0] - c[0]) ** 2 * 2 + (p[1] - c[1]) ** 2 * 4 + (p[2] - c[2]) ** 2 * 3;
      if (d < bestD) { bestD = d; best = p; if (!d) break; }
    }
    return [best[0], best[1], best[2], 255];
  },

  // 그림의 모든 픽셀 (모든 레이어 · 프레임 · 타일셋 타일)
  allImages() {
    const s = App.sprite, out = [];
    for (const l of s.layers) for (const cel of l.cels) out.push(cel.image);
    for (const ts of s.tilesets()) out.push(...ts.tiles);
    return [...new Set(out)]; // 링크된 셀은 같은 그림이라 한 번만
  },

  // 그림 전체를 바꾸는 작업. 전/후를 통째로 기록해서 실행 취소한다.
  bulk(label, fn) {
    const capture = () => ({
      data: this.allImages().map(img => [img, img.data.slice()]),
      palette: App.palette.map(c => c.slice()),
      paletteName: App.paletteName,
      mode: App.sprite.colorMode,
      fg: App.fg.slice(), bg: App.bg.slice(),
    });
    const apply = st => {
      for (const [img, d] of st.data) img.data.set(d);
      App.palette = st.palette.map(c => c.slice());
      App.paletteName = st.paletteName;
      App.sprite.colorMode = st.mode;
      App.fg = st.fg.slice(); App.bg = st.bg.slice();
      for (const l of App.sprite.layers) for (const cel of l.cels) cel.invalidate();
      App.emit('palette');
      App.emit('color');
      App.emit('colormode');
    };
    const before = capture();
    fn();
    const after = capture();
    App.history.push({ label, undo: () => apply(before), redo: () => apply(after) });
    apply(after);
    App.afterHistoryMove();
  },

  // 각 픽셀을 fn(색) 결과로 바꾼다. 같은 색은 한 번만 계산한다.
  remapAll(fn) {
    const cache = new Map();
    for (const img of this.allImages()) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const key = (d[i] << 24 | d[i + 1] << 16 | d[i + 2] << 8 | d[i + 3]) >>> 0;
        let c = cache.get(key);
        if (c === undefined) { c = fn([d[i], d[i + 1], d[i + 2], d[i + 3]]); cache.set(key, c); }
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
      }
    }
  },

  toIndexed() {
    if (this.isIndexed()) return;
    let changed = 0;
    this.bulk('팔레트 전용 모드로', () => {
      this.remapAll(c => {
        if (c[3] < 128) return TRANSPARENT;
        const n = this.nearest(c);
        if (n[0] !== c[0] || n[1] !== c[1] || n[2] !== c[2] || c[3] !== 255) changed++;
        return n;
      });
      App.sprite.colorMode = 'indexed';
      App.fg = this.nearest(App.fg);
      App.bg = this.nearest(App.bg);
    });
    UI.toast(changed
      ? `팔레트 전용 모드로 바꿨어요. 팔레트에 없던 색 ${changed}가지를 가장 가까운 팔레트 색으로 맞췄어요.`
      : '팔레트 전용 모드로 바꿨어요. 이제 팔레트 색을 바꾸면 그림도 함께 바뀌어요.');
  },

  toRGB() {
    if (!this.isIndexed()) return;
    this.bulk('자유 색 모드로', () => { App.sprite.colorMode = 'rgb'; });
  },

  // 팔레트 i번 색을 바꾼다. 인덱스 모드면 그 색을 쓴 모든 칸도 바뀐다.
  editPaletteColor(i, color) {
    const old = App.palette[i];
    if (!old || colorsEqual(old, color)) return;
    if (!this.isIndexed()) {
      App.palette[i] = color.slice();
      App.emit('palette');
      return;
    }
    this.bulk('팔레트 색 바꾸기', () => {
      const same = c => c[0] === old[0] && c[1] === old[1] && c[2] === old[2];
      this.remapAll(c => same(c) ? [color[0], color[1], color[2], c[3]] : c);
      App.palette[i] = color.slice();
      if (same(App.fg)) App.fg = color.slice();
      if (same(App.bg)) App.bg = color.slice();
    });
  },

  // 인덱스 모드에서 팔레트를 통째로 바꾸면, 같은 번호의 색으로 바꿔 끼운다 (팔레트 스왑)
  swapPalette(name, colors) {
    const oldPal = App.palette.map(c => c.slice());
    this.bulk('팔레트 교체', () => {
      const indexOf = c => oldPal.findIndex(p => p[0] === c[0] && p[1] === c[1] && p[2] === c[2]);
      const map = c => {
        const i = indexOf(c);
        const n = i >= 0 && i < colors.length ? colors[i] : this.nearest(c, colors);
        return [n[0], n[1], n[2], c[3]];
      };
      this.remapAll(map);
      App.fg = map(App.fg); App.bg = map(App.bg);
      App.palette = colors.map(c => c.slice());
      App.paletteName = name;
    });
    UI.toast('같은 번호의 색으로 바꿔 끼웠어요 (팔레트 스왑). 되돌리려면 Ctrl+Z.');
  },
};
