// 패널 · 대화상자 · 단축키 · 자동 저장
const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, html = '') => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (html) n.innerHTML = html;
  return n;
};

const AUTOSAVE_KEY = 'dotstudio.autosave.v3';
const PRESETS = [
  { w: 16, h: 16, desc: '아이콘 · 아이템' },
  { w: 32, h: 32, desc: '캐릭터', recommend: true },
  { w: 64, h: 64, desc: '큰 캐릭터 · 보스' },
  { w: 128, h: 128, desc: '배경 · 일러스트' },
];

// 툴 옵션 바의 버튼 묶음 옵션
const CTX_CHOICES = {
  gradShape: {
    title: '모양',
    desc: '직선: 드래그한 방향으로 바뀌어요 · 원형: 누른 곳에서 바깥으로 퍼져요',
    items: [['linear', '직선'], ['radial', '원형']],
  },
  gradDither: {
    title: '섞는 방식',
    desc: '부드럽게: 중간색을 만들어요 · 디더링: 두 색만 점 무늬로 섞어서 픽셀 아트 느낌이 나요',
    items: [['none', '부드럽게'], ['bayer2', '디더링 2×2'], ['bayer4', '디더링 4×4']],
  },
  gradArea: {
    title: '칠할 곳',
    desc: '같은 색 영역: 누른 곳과 이어진 같은 색 부분만 (채우기처럼) · 전체: 칸 전체. 선택 영역이 있으면 항상 그 안만 칠해요.',
    items: [['region', '같은 색 영역'], ['all', '전체']],
  },
  brushShape: {
    title: '모양',
    desc: '브러시가 칠하는 모양이에요. 크기가 3 이상일 때 차이가 나요.',
    items: [['circle', '●', '원'], ['square', '■', '네모']],
  },
  ink: {
    title: '잉크',
    desc: '일반: 그대로 칠해요 · 명암: 칠해진 색을 팔레트에서 한 단계 밝게(왼쪽 클릭) / 어둡게(오른쪽 클릭) · 칠한 곳만: 이미 그린 칸에만 색이 들어가요',
    items: [['simple', '일반'], ['shade', '명암', '왼쪽 클릭 밝게, 오른쪽 클릭 어둡게'], ['lockAlpha', '칠한 곳만', '빈 칸에는 칠해지지 않아요']],
  },
  symmetry: {
    title: '대칭',
    desc: '한쪽을 그리면 반대쪽에도 똑같이 그려져요. 캐릭터 정면이나 아이콘을 그릴 때 좋아요.',
    items: [['none', '끔'], ['h', '좌우'], ['v', '상하'], ['both', '양쪽']],
  },
  selMode: {
    title: '방식',
    desc: '새로: 새로 골라요 · 더하기: 지금 선택에 보태요 (Shift) · 빼기: 지금 선택에서 덜어내요 (Ctrl)',
    items: [['replace', '새로'], ['add', '더하기'], ['subtract', '빼기']],
  },
};

// [표시, 이름, 단축키, 동작, 선택이 있어야 하는지]
const SEL_ACTIONS = [
  ['전체', '전체 선택', 'Ctrl+A', () => Selection.all()],
  ['해제', '선택 해제', 'Esc', () => Selection.clear(), true],
  ['반전', '선택 반전', 'Ctrl+Shift+I', () => Selection.invert()],
  ['|'],
  ['⇋ 좌우', '좌우 뒤집기', 'Shift+H', () => Selection.transform('flipH')],
  ['⇵ 상하', '상하 뒤집기', 'Shift+V', () => Selection.transform('flipV')],
  ['↻ 90°', '오른쪽으로 90° 회전', 'Shift+R', () => Selection.transform('rotCW')],
  ['↺ 90°', '왼쪽으로 90° 회전', '', () => Selection.transform('rotCCW')],
  ['⤢ 크기', '크기 조절 (늘리기 · 줄이기)', 'Shift+S', () => Resize.showScaleDialog()],
  ['|'],
  ['복사', '복사', 'Ctrl+C', () => Selection.copy()],
  ['잘라내기', '잘라내기', 'Ctrl+X', () => Selection.cut()],
  ['붙여넣기', '붙여넣기', 'Ctrl+V', () => Selection.paste()],
  ['지우기', '선택한 곳 지우기', 'Delete', () => Selection.deleteSelected(), true],
];

const UI = {
  init() {
    Editor.init($('#view'));
    Timeline.init();
    this.bindStage4();
    Resize.init();
    Preview.init();
    this.buildToolbar();
    this.buildTagDialog();
    this.buildPaletteSelect();
    this.buildHelpKeys();
    this.bindTopbar();
    this.bindColors();
    this.bindDialogs();
    this.bindKeys();
    this.bindTooltips();

    App.on('tool', () => { this.renderToolbar(); this.renderContext(); this.renderHint(); });
    App.on('opt', () => this.renderContext());
    App.on('selection', () => this.renderContext());
    App.on('color', () => { this.renderColors(); this.renderPalette(); });
    App.on('palette', () => { this.renderPalette(); this.syncPaletteSelect(); });
    App.on('sprite', () => this.renderColorMode());
    App.on('colormode', () => this.renderColorMode());
    App.on('doc', () => this.renderTileset());
    App.on('cursor', () => this.renderTileset());
    App.on('sprite', () => this.renderTileset());
    App.on('history', () => { this.renderHistory(); this.scheduleAutosave(); });
    App.on('doc', () => this.scheduleAutosave());
    App.on('hover', () => this.renderStatus());
    App.on('cursor', () => this.renderStatus());
    App.on('zoom', () => this.renderStatus());
    App.on('sprite', () => this.renderStatus());

    App.setPalette(App.paletteName);
    App.fg = App.palette[1].slice();
    App.bg = App.palette[21] ? App.palette[21].slice() : [255, 255, 255, 255];
    this.renderColors();
    this.renderToolbar();
    this.renderContext();
    this.renderHint();
    this.showNewDialog();
  },

  // ---------- 툴바 ----------
  buildToolbar() {
    const bar = $('#toolbar');
    for (const id of TOOL_ORDER) {
      if (id === '|') { bar.append(el('div', { class: 'tool-sep' })); continue; }
      const t = Tools[id];
      const b = el('button', {
        class: 'tool-btn', 'data-tool': id,
        'data-tip-title': t.label, 'data-tip-desc': t.desc + '\n' + t.hint, 'data-tip-key': t.key,
      }, `<span class="tool-key">${t.key}</span><svg viewBox="0 0 24 24">${ICONS[id]}</svg><span class="tool-name">${t.label}</span>`);
      b.addEventListener('click', () => App.setTool(id));
      bar.append(b);
    }
  },

  renderToolbar() {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === App.tool));
  },

  // ---------- 툴 옵션 바 ----------
  renderContext() {
    const t = Tools[App.tool], bar = $('#contextbar');
    bar.innerHTML = '';
    bar.append(el('span', { class: 'ctx-tool' }, t.label));
    for (const opt of t.options) {
      if (opt === 'size') {
        const wrap = el('div', {
          class: 'ctx-opt', 'data-tip-title': '브러시 크기', 'data-tip-desc': '한 번에 칠하는 칸의 크기예요.', 'data-tip-key': '[ ]',
        }, '<span>크기</span>');
        const range = el('input', { type: 'range', min: 1, max: 16, value: App.opt.size });
        const val = el('span', { class: 'ctx-val' }, App.opt.size + 'px');
        // 드래그 중에는 바를 다시 그리지 않고 값만 바꾼다 (다시 그리면 드래그가 끊김)
        range.addEventListener('input', () => {
          App.opt.size = +range.value;
          val.textContent = App.opt.size + 'px';
          Editor.render();
        });
        range.addEventListener('change', () => App.setOpt('size', +range.value));
        wrap.append(range, val);
        bar.append(wrap);
      } else if (CTX_CHOICES[opt]) {
        const c = CTX_CHOICES[opt];
        const wrap = el('div', { class: 'ctx-opt', 'data-tip-title': c.title, 'data-tip-desc': c.desc }, `<span>${c.title}</span>`);
        const seg = el('div', { class: 'ctx-seg' });
        for (const [value, label, tip] of c.items) {
          const b = el('button', { title: tip || '' }, label);
          b.classList.toggle('on', App.opt[opt] === value);
          b.addEventListener('click', () => App.setOpt(opt, value));
          seg.append(b);
        }
        wrap.append(seg);
        bar.append(wrap);
      } else if (opt === 'selActions') {
        const wrap = el('div', { class: 'ctx-actions' });
        for (const [label, title, key, fn, needSel] of SEL_ACTIONS) {
          if (label === '|') { wrap.append(el('span', { class: 'ctx-sep' })); continue; }
          const b = el('button', { class: 'ctx-act', 'data-tip-title': title, 'data-tip-key': key || '' }, label);
          if (needSel && !App.selection) b.disabled = true;
          b.addEventListener('click', fn);
          wrap.append(b);
        }
        bar.append(wrap);
      } else {
        const info = {
          pixelPerfect: ['픽셀 퍼펙트', '곡선을 그릴 때 생기는 계단 모양 군더더기 점을 자동으로 정리해요. 크기 1 · 일반 잉크에서만 동작해요.'],
          fillShape: ['속 채우기', '도형 안쪽까지 칠해요.'],
          contiguous: ['이어진 곳만', '끄면 그림 전체에서 같은 색을 모두 고르거나 바꿔요.'],
        }[opt];
        const label = el('label', { 'data-tip-title': info[0], 'data-tip-desc': info[1] });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = App.opt[opt];
        if (opt === 'pixelPerfect' && (App.opt.size !== 1 || App.opt.ink !== 'simple')) label.style.opacity = .45;
        cb.addEventListener('change', () => App.setOpt(opt, cb.checked));
        label.append(cb, info[0]);
        bar.append(label);
      }
    }
    if (!t.options.includes('selActions')) bar.append(el('span', { class: 'ctx-desc' }, t.desc));
  },

  renderHint() {
    const t = Editor.altDown ? Tools.eyedropper : Tools[App.tool];
    $('#st-hint').textContent = Editor.altDown ? '스포이트 (Alt를 떼면 원래 툴로 돌아가요)' : t.hint;
  },

  // ---------- 색 ----------
  bindColors() {
    const fgPicker = $('#fg-picker'), bgPicker = $('#bg-picker');
    $('#fg-swatch').addEventListener('click', () => { fgPicker.value = colorToHex(App.fg); fgPicker.click(); });
    $('#bg-swatch').addEventListener('click', () => { bgPicker.value = colorToHex(App.bg); bgPicker.click(); });
    fgPicker.addEventListener('input', () => this.pickColor('fg', hexToColor(fgPicker.value)));
    bgPicker.addEventListener('input', () => this.pickColor('bg', hexToColor(bgPicker.value)));
    $('#swap-colors').addEventListener('click', () => App.swapColors());
    for (const which of ['fg', 'bg']) {
      const input = $(`#${which}-hex`);
      input.addEventListener('change', () => {
        const c = hexToColor(input.value);
        if (c) this.pickColor(which, c); else this.renderColors();
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    }
    $('#add-color').addEventListener('click', () => {
      if (!App.palette.some(c => colorsEqual(c, App.fg))) {
        App.palette.push(App.fg.slice());
        App.emit('palette');
      }
    });
  },

  renderColors() {
    $('#fg-swatch').style.background = colorToHex(App.fg);
    $('#bg-swatch').style.background = colorToHex(App.bg);
    $('#fg-hex').value = colorToHex(App.fg).toUpperCase();
    $('#bg-hex').value = colorToHex(App.bg).toUpperCase();
  },

  buildPaletteSelect() {
    const sel = $('#palette-select');
    for (const name of Object.keys(PALETTES)) sel.append(el('option', { value: name }, name));
    sel.value = App.paletteName;
    sel.addEventListener('change', () => {
      if (!PALETTES[sel.value]) return;
      if (ColorMode.isIndexed()) ColorMode.swapPalette(sel.value, paletteColors(sel.value));
      else App.setPalette(sel.value);
    });
  },

  renderPalette() {
    const box = $('#palette');
    box.innerHTML = '';
    App.palette.forEach((c, i) => {
      const hex = colorToHex(c).toUpperCase();
      const b = el('button', { class: 'pal', title: hex });
      b.style.background = hex;
      if (colorsEqual(c, App.fg)) b.classList.add('is-fg');
      else if (colorsEqual(c, App.bg)) b.classList.add('is-bg');
      b.addEventListener('click', () => App.setColor('fg', c));
      b.addEventListener('dblclick', () => this.editPaletteEntry(i));
      b.addEventListener('contextmenu', e => { e.preventDefault(); App.setColor('bg', c); });
      box.append(b);
    });
  },

  // ---------- 4단계: 저장 · 타일맵 · 색 모드 ----------
  bindStage4() {
    $('#save-go').addEventListener('click', () => this.doSave());
    $('#save-name').addEventListener('keydown', e => { if (e.key === 'Enter') this.doSave(); });

    document.querySelectorAll('#color-mode button').forEach(b => b.addEventListener('click', () => {
      if (!App.sprite) return;
      if (b.dataset.mode === 'indexed') ColorMode.toIndexed(); else ColorMode.toRGB();
    }));

    const pal = $('#pal-picker');
    pal.addEventListener('change', () => {
      if (this.editingPalette == null) return;
      ColorMode.editPaletteColor(this.editingPalette, hexToColor(pal.value));
      this.editingPalette = null;
    });

    document.querySelectorAll('#tile-size button').forEach(b => b.addEventListener('click', () => {
      $('#tile-w').value = $('#tile-h').value = b.dataset.size;
      this.renderTileSize();
    }));
    ['#tile-w', '#tile-h'].forEach(id => $(id).addEventListener('input', () => this.renderTileSize()));
    const tileSize = () => [
      Math.max(2, Math.min(256, +$('#tile-w').value | 0)),
      Math.max(2, Math.min(256, +$('#tile-h').value | 0)),
    ];
    $('#tilemap-new').addEventListener('click', () => { Tilemap.addLayer(...tileSize()); App.setTool('pencil'); this.closeModals(); });
    $('#tilemap-convert').addEventListener('click', () => {
      if (Tilemap.isTilemap(App.currentLayer())) return this.toast('이미 타일맵 레이어예요.');
      Tilemap.convertLayer(...tileSize());
      this.closeModals();
    });
  },

  showSaveDialog() {
    if (!App.sprite) return;
    $('#save-name').value = App.fileName;
    this.openModal('#dlg-save');
    setTimeout(() => $('#save-name').select(), 0);
  },

  async doSave() {
    const name = ($('#save-name').value.trim() || 'dot-art').replace(/\.(aseprite|ase)$/i, '');
    App.fileName = name;
    this.closeModals();
    const bytes = await AseFile.write(App.sprite, App.palette);
    Exporter.download(new Blob([bytes], { type: 'application/octet-stream' }), name + '.aseprite');
    this.toast(ColorMode.isIndexed()
      ? '저장했어요. (팔레트 전용 모드 표시는 파일에 담기지 않아서, 다시 열면 자유 색 모드로 열려요)'
      : '저장했어요. 열기로 불러오면 이어서 그릴 수 있어요.');
  },

  showTilemapDialog() {
    if (!App.sprite) return;
    this.renderTileSize();
    $('#tilemap-convert').hidden = Tilemap.isTilemap(App.currentLayer());
    this.openModal('#dlg-tilemap');
  },

  renderTileSize() {
    const w = $('#tile-w').value, h = $('#tile-h').value;
    document.querySelectorAll('#tile-size button').forEach(b => b.classList.toggle('on', w === b.dataset.size && h === b.dataset.size));
  },

  pickColor(which, c) {
    if (ColorMode.isIndexed()) {
      const n = ColorMode.nearest(c);
      if (!colorsEqual(n, c) && !this._snapToastShown) {
        this.toast('팔레트 전용 모드라서 가장 가까운 팔레트 색으로 맞췄어요. 새 색이 필요하면 팔레트 색을 두 번 눌러 고치세요.');
        this._snapToastShown = true;
      }
      c = n;
    }
    App.setColor(which, c);
  },

  editPaletteEntry(i) {
    this.editingPalette = i;
    const pal = $('#pal-picker');
    pal.value = colorToHex(App.palette[i]);
    pal.click();
  },

  renderColorMode() {
    const mode = App.sprite ? App.sprite.colorMode : 'rgb';
    document.querySelectorAll('#color-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  },

  syncPaletteSelect() {
    const sel = $('#palette-select');
    let custom = sel.querySelector('option[data-custom]');
    if (PALETTES[App.paletteName]) {
      if (custom) custom.remove();
      sel.value = App.paletteName;
      return;
    }
    if (!custom) { custom = el('option', { 'data-custom': '1' }); sel.prepend(custom); }
    custom.value = App.paletteName;
    custom.textContent = App.paletteName;
    sel.value = App.paletteName;
  },

  renderTileset() {
    const panel = $('#tileset-panel');
    const layer = App.sprite && App.currentLayer();
    panel.hidden = !Tilemap.isTilemap(layer);
    if (panel.hidden) return;
    const ts = layer.tileset, grid = $('#tileset-grid');
    if (App.tileIndex >= ts.tiles.length) App.tileIndex = ts.tiles.length - 1;
    $('#tileset-info').textContent = `(${ts.tileW}×${ts.tileH} · ${ts.tiles.length - 1}개)`;
    grid.innerHTML = '';
    ts.tiles.forEach((tile, i) => {
      const b = el('button', { class: 'tile-cell' + (i === App.tileIndex ? ' on' : ''), title: i ? `${i}번 타일` : '빈칸 (지우기)' });
      if (i) {
        const c = el('canvas');
        c.width = ts.tileW; c.height = ts.tileH;
        c.getContext('2d').putImageData(new ImageData(tile.data.slice(), ts.tileW, ts.tileH), 0, 0);
        b.append(c);
      } else {
        b.textContent = '×';
      }
      b.addEventListener('click', () => { App.tileIndex = i; App.setTool('tile'); this.renderTileset(); });
      grid.append(b);
    });
    if (ts.tiles.length === 1) grid.append(el('div', { class: 'hint-sm' }, '아직 타일이 없어요. 연필로 칸 안에 그리면 타일이 생겨요.'));
  },

  // ---------- 알림 ----------
  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  },

  // ---------- 태그 대화상자 ----------
  buildTagDialog() {
    const chips = $('#tag-chips');
    for (const name of TAG_NAME_SUGGESTIONS) {
      const b = el('button', {}, name);
      b.addEventListener('click', () => { $('#tag-name').value = name; });
      chips.append(b);
    }
    const dir = $('#tag-dir');
    for (const [key, label] of Object.entries(DIRECTION_LABEL)) {
      const b = el('button', { 'data-dir': key }, label);
      b.addEventListener('click', () => { this.tagDraft.direction = key; this.renderTagDialog(); });
      dir.append(b);
    }
    const colors = $('#tag-colors');
    for (const c of TAG_COLORS) {
      const b = el('button', { 'data-color': c });
      b.style.background = c;
      b.addEventListener('click', () => { this.tagDraft.color = c; this.renderTagDialog(); });
      colors.append(b);
    }
    $('#tag-save').addEventListener('click', () => {
      const name = $('#tag-name').value.trim();
      if (!name) { $('#tag-name').focus(); this.toast('태그 이름을 적어 주세요. 예: Idle, Run'); return; }
      const from = (+$('#tag-from').value || 1) - 1, to = (+$('#tag-to').value || 1) - 1;
      App.saveTag(this.tagIndex, { ...this.tagDraft, name, from: Math.min(from, to), to: Math.max(from, to) });
      this.closeModals();
    });
    $('#tag-delete').addEventListener('click', () => {
      App.removeTag(this.tagIndex);
      this.closeModals();
    });
    $('#tag-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#tag-save').click(); });
  },

  showTagDialog(index) {
    const s = App.sprite;
    if (!s) return;
    this.tagIndex = index;
    if (index == null) {
      // 기본 구간: 지금 프레임부터 태그 없는 프레임이 이어지는 데까지
      let to = App.frame;
      if (s.tagAt(App.frame)) to = App.frame;
      else while (to + 1 < s.frames.length && !s.tagAt(to + 1)) to++;
      this.tagDraft = { from: App.frame, to, direction: 'forward', color: TAG_COLORS[s.tags.length % TAG_COLORS.length] };
      $('#tag-name').value = '';
    } else {
      this.tagDraft = { ...s.tags[index] };
      $('#tag-name').value = this.tagDraft.name;
    }
    $('#tag-title').textContent = index == null ? '태그 추가' : '태그 고치기';
    $('#tag-delete').hidden = index == null;
    for (const id of ['#tag-from', '#tag-to']) $(id).max = s.frames.length;
    $('#tag-from').value = this.tagDraft.from + 1;
    $('#tag-to').value = this.tagDraft.to + 1;
    this.renderTagDialog();
    this.openModal('#dlg-tag');
    setTimeout(() => $('#tag-name').focus(), 0);
  },

  renderTagDialog() {
    document.querySelectorAll('#tag-dir button').forEach(b => b.classList.toggle('on', b.dataset.dir === this.tagDraft.direction));
    document.querySelectorAll('#tag-colors button').forEach(b => b.classList.toggle('on', b.dataset.color === this.tagDraft.color));
  },

  // ---------- 기록 / 상태바 ----------
  renderHistory() {
    const list = $('#history'), h = App.history;
    list.innerHTML = '';
    h.entries.forEach((e, i) => {
      const li = el('li', {}, `<span class="n">${i + 1}</span><span>${e.label}</span>`);
      if (i === h.index) li.classList.add('current');
      if (i > h.index) li.classList.add('future');
      li.addEventListener('click', () => App.gotoHistory(i));
      list.append(li);
    });
    const cur = list.children[h.index];
    // scrollIntoView는 오른쪽 패널까지 스크롤시키므로 목록만 직접 스크롤한다
    if (cur) {
      const top = cur.offsetTop - list.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + cur.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + cur.offsetHeight - list.clientHeight;
    }
    $('[data-action=undo]').disabled = !h.canUndo;
    $('[data-action=redo]').disabled = !h.canRedo;
  },

  renderStatus() {
    const s = App.sprite, hv = Editor.hover;
    const inside = s && hv && hv.x >= 0 && hv.y >= 0 && hv.x < s.width && hv.y < s.height;
    $('#st-pos').textContent = inside ? `위치 ${hv.x}, ${hv.y}` : '위치 -';
    $('#st-size').textContent = s ? `크기 ${s.width}×${s.height} · ${App.currentLayer().name} · ${App.frame + 1}번 프레임` : '크기 -';
    $('#st-zoom').textContent = Editor.zoom * 100 + '%';
    if (Editor.tfInfo) $('#st-hint').textContent = Editor.tfInfo;
    else if (this._tfShown) this.renderHint();
    this._tfShown = !!Editor.tfInfo;
  },

  // ---------- 상단 버튼 ----------
  bindTopbar() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      ({
        new: () => this.showNewDialog(),
        save: () => this.showSaveDialog(),
        size: () => Resize.showSizeDialog(),
        open: () => $('#file-open').click(),
        'import-sheet': () => SheetImporter.show(),
        effects: () => Effects.show(),
        export: () => this.showExportDialog(),
        undo: () => App.undo(),
        redo: () => App.redo(),
        help: () => this.openModal('#dlg-help'),
        'zoom-in': () => Editor.zoomStep(1),
        'zoom-out': () => Editor.zoomStep(-1),
        'zoom-fit': () => Editor.fit(),
      })[b.dataset.action]?.();
    });
    const grid = $('#opt-grid');
    grid.addEventListener('change', () => App.setOpt('grid', grid.checked));
    App.on('opt', key => { if (key === 'grid') grid.checked = App.opt.grid; });

    $('#file-open').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) this.openImageFile(file);
    });
  },

  // ---------- 대화상자 ----------
  openModal(sel) {
    if (sel !== '#dlg-sheet') SheetImporter.reset();
    if (sel !== '#dlg-fx') Effects.cancelPreview();
    document.querySelectorAll('.modal').forEach(m => m.hidden = true);
    $(sel).hidden = false;
  },
  closeModals() {
    SheetImporter.reset();
    Effects.cancelPreview(); // 적용하지 않은 효과 미리보기는 되돌린다
    document.querySelectorAll('.modal').forEach(m => m.hidden = true);
    if (!App.sprite) $('#dlg-new').hidden = false; // 첫 화면으로 돌아간다
  },
  get modalOpen() { return [...document.querySelectorAll('.modal')].some(m => !m.hidden); },

  bindDialogs() {
    SheetImporter.init();
    Tutorial.init();
    $('#tut-start').addEventListener('click', () => Tutorial.start());
    $('#help-tut').addEventListener('click', () => Tutorial.start());
    Effects.init();
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.closeModals()));
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('pointerdown', e => {
      if (e.target === m) this.closeModals();
    }));
    $('#new-cancel').addEventListener('click', () => this.closeModals());

    const grid = $('#preset-grid');
    for (const p of PRESETS) {
      const box = Math.round(10 + Math.log2(p.w) * 6);
      const b = el('button', { class: 'preset' + (p.recommend ? ' recommend' : '') }, `
        <div class="p-icon"><div class="p-box" style="width:${box}px;height:${box}px"></div></div>
        <div class="p-size">${p.w}×${p.h}</div>
        <div class="p-desc">${p.desc}</div>
        ${p.recommend ? '<span class="badge">추천</span>' : ''}`);
      b.addEventListener('click', () => this.createNew(p.w, p.h));
      grid.append(b);
    }
    for (const tpl of TEMPLATES) {
      const b = el('button', { class: 'tpl' }, `<b>${tpl.name}</b><span>${tpl.desc}</span>`);
      b.addEventListener('click', () => {
        const n = +$('#tpl-size').value;
        App.loadSprite(Templates.build(tpl.id, n, n), tpl.name);
        this.closeModals();
      });
      $('#tpl-grid').append(b);
    }
    $('#custom-go').addEventListener('click', () => {
      const w = Math.max(1, Math.min(1024, +$('#custom-w').value | 0));
      const h = Math.max(1, Math.min(1024, +$('#custom-h').value | 0));
      this.createNew(w, h);
    });

    $('#export-go').addEventListener('click', () => this.doExport());
  },

  showNewDialog() {
    $('#new-warn').hidden = !(App.sprite && App.history.entries.length > 1);
    $('#new-cancel').hidden = !App.sprite;
    const resume = $('#resume-box');
    resume.innerHTML = '';
    const saved = this.readAutosave();
    if (saved && !App.sprite) {
      const time = new Date(saved.time).toLocaleString('ko-KR');
      const b = el('button', { class: 'resume' }, `
        <img src="${saved.png}" alt="">
        <div><b>이어서 그리기</b><br><span class="muted">${saved.w}×${saved.h} · ${time} 자동 저장</span></div>`);
      b.addEventListener('click', () => this.restoreAutosave(saved));
      resume.append(b);
    }
    $('#tut-start').classList.toggle('first', !Tutorial.done);
    this.openModal('#dlg-new');
  },

  createNew(w, h) {
    const bg = document.querySelector('input[name=bg]:checked').value === 'white' ? [255, 255, 255, 255] : null;
    App.loadSprite(Sprite.create(w, h, bg), '새 그림');
    this.closeModals();
  },

  // ---------- 내보내기 대화상자 ----------
  exp: { kind: 'png', scale: 1, range: 'all', bg: '', layout: 'horizontal', pad: 0, pivot: 'bottom' },

  showExportDialog() {
    if (!App.sprite) return;
    const s = App.sprite, ex = this.exp;
    if (s.frames.length < 2 && ex.kind !== 'png') ex.kind = 'png';
    // 처음 열 때는 PNG, 프레임이 여러 장이면 GIF를 기본으로
    if (!this._exportOpened) { ex.kind = s.frames.length > 1 ? 'gif' : 'png'; this._exportOpened = true; }
    if (ex.kind === 'sheet' && ex.scale > 4) ex.scale = 1;

    const seg = (sel, attr, value, onPick) => document.querySelectorAll(`${sel} button`).forEach(b => {
      b.classList.toggle('on', b.dataset[attr] === String(value));
      b.onclick = () => { onPick(b.dataset[attr]); this.showExportDialog(); };
    });
    seg('#export-kind', 'kind', ex.kind, v => { ex.kind = v; });
    document.querySelectorAll('#export-kind button').forEach(b => {
      b.disabled = b.dataset.kind !== 'png' && s.frames.length < 2;
      b.title = b.disabled ? '프레임이 2장 이상일 때 쓸 수 있어요' : '';
    });

    const scales = $('#export-scale');
    scales.innerHTML = '';
    for (const v of [1, 2, 4, 8, 16]) {
      const b = el('button', { 'data-scale': v }, v + '배');
      scales.append(b);
    }
    seg('#export-scale', 'scale', ex.scale, v => { ex.scale = +v; });

    const frameSel = $('#export-frames');
    frameSel.innerHTML = '';
    frameSel.append(el('option', { value: 'all' }, `모든 프레임 (${s.frames.length}장)`));
    s.tags.forEach((t, i) => frameSel.append(el('option', { value: 'tag:' + i }, `태그 "${escapeHtml(t.name)}" (${t.from + 1}~${t.to + 1}번)`)));
    if (![...frameSel.options].some(o => o.value === ex.range)) ex.range = 'all';
    frameSel.value = ex.range;
    frameSel.onchange = () => { ex.range = frameSel.value; this.showExportDialog(); };

    seg('#export-gif-bg', 'bg', ex.bg, v => { ex.bg = v; });
    seg('#export-layout', 'layout', ex.layout, v => { ex.layout = v; });
    seg('#export-pad', 'pad', ex.pad, v => { ex.pad = +v; });
    seg('#export-pivot', 'pivot', ex.pivot, v => { ex.pivot = v; });

    $('#export-frames-field').hidden = ex.kind === 'png';
    $('#export-gif-opts').hidden = ex.kind !== 'gif';
    $('#export-sheet-opts').hidden = ex.kind !== 'sheet';

    const frames = Exporter.frameList(ex.range), sc = ex.scale;
    let size, hint;
    if (ex.kind === 'png') {
      size = `결과: ${s.width * sc} × ${s.height * sc} 픽셀 · ${App.frame + 1}번 프레임`;
      hint = '게임 엔진에 넣을 땐 <b>1배</b>, SNS에 올릴 땐 <b>8배 이상</b>이 좋아요. 키워도 흐려지지 않아요.';
    } else if (ex.kind === 'gif') {
      size = `결과: ${s.width * sc} × ${s.height * sc} 픽셀 · ${frames.length}장 · 무한 반복`;
      hint = 'GIF는 반투명을 못 담아서, 반쯤 투명한 칸은 진하게 또는 투명하게 바뀌어요. 작은 그림은 <b>4~8배</b>로 키우면 보기 좋아요.';
    } else {
      const L = Exporter.sheetSize(frames.length, sc, ex.layout, ex.pad);
      size = `결과: ${L.w} × ${L.h} 픽셀 · ${frames.length}칸 (${L.cols}×${L.rows})`;
      hint = '';
      $('#unity-guide').innerHTML = `
        <b>Unity에서 쓰는 법</b>
        <ol>
          <li>PNG 파일을 Assets 폴더로 끌어다 놓기</li>
          <li>Inspector에서 <b>Texture Type</b>: Sprite (2D and UI) · <b>Sprite Mode</b>: Multiple</li>
          <li><b>Pixels Per Unit</b>: ${s.height * sc} · <b>Filter Mode</b>: Point (no filter) · <b>Compression</b>: None → Apply</li>
          <li><b>Sprite Editor</b> → Slice → Type: <b>Grid By Cell Size</b> · Pixel Size <b>${L.cw} × ${L.ch}</b> · Padding <b>${ex.pad} × ${ex.pad}</b> · Pivot <b>${PIVOTS[ex.pivot].unity}</b> → Slice → Apply</li>
          <li>잘린 스프라이트들을 한꺼번에 골라 씬에 끌어다 놓으면 애니메이션이 만들어져요</li>
        </ol>
        ${sc > 1 ? '<span class="warn">게임용은 보통 1배로 내보내요. 키우면 Pixels Per Unit도 같이 바꿔야 해요.</span>' : ''}`;
    }
    $('#export-size').textContent = size;
    $('#export-hint').innerHTML = hint;
    $('#export-hint').hidden = !hint;
    $('#export-go').textContent = ex.kind === 'sheet' && $('#export-json').checked ? '내려받기 (PNG + JSON)' : '내려받기';
    $('#export-json').onchange = () => this.showExportDialog();
    this.openModal('#dlg-export');
  },

  doExport() {
    const ex = this.exp;
    const name = ($('#export-name').value.trim() || 'dot-art').replace(/\.(png|gif|json)$/i, '');
    const frames = Exporter.frameList(ex.range);
    if (ex.kind === 'png') Exporter.png(name, ex.scale);
    else if (ex.kind === 'gif') Exporter.gif(name, ex.scale, frames, ex.bg || null);
    else Exporter.sheet(name, ex.scale, frames, ex.layout, ex.pad, $('#export-json').checked, ex.pivot);
    this.closeModals();
  },

  openImageFile(file) {
    const reader = new FileReader();
    const base = file.name.replace(/\.[^.]+$/, '');
    if (/\.(aseprite|ase)$/i.test(file.name)) {
      reader.onload = () => this.openAse(reader.result, '파일 열기').then(ok => { if (ok) App.fileName = base; });
      reader.readAsArrayBuffer(file);
      return;
    }
    reader.onload = () => this.loadImageUrl(reader.result, '이미지 열기', () => { App.fileName = base; });
    reader.readAsDataURL(file);
  },

  async openAse(buffer, label) {
    try {
      const { sprite, palette } = await AseFile.read(buffer);
      App.loadSprite(sprite, label);
      if (palette.length) App.setPalette('파일 팔레트', palette);
      App.emit('colormode');
      document.querySelectorAll('.modal').forEach(m => m.hidden = true);
      const s = App.sprite;
      this.toast(`불러왔어요: ${s.width}×${s.height} · 레이어 ${s.layers.length}개 · 프레임 ${s.frames.length}장` + (s.tags.length ? ` · 태그 ${s.tags.length}개` : ''));
      return true;
    } catch (e) {
      this.toast('파일을 열지 못했어요: ' + e.message);
      return false;
    }
  },

  loadImageUrl(url, label, after) {
    const img = new Image();
    img.onload = () => {
      if (img.width > 1024 || img.height > 1024) {
        alert('1024×1024보다 큰 이미지는 열 수 없어요.');
        return;
      }
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      App.loadSprite(Sprite.fromImageData(g.getImageData(0, 0, img.width, img.height)), label);
      document.querySelectorAll('.modal').forEach(m => m.hidden = true);
      after?.();
    };
    img.src = url;
  },

  // ---------- 자동 저장 (이 브라우저에만 저장) ----------
  scheduleAutosave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.autosave(), 800);
  },

  async autosave() {
    const s = App.sprite;
    if (!s) return;
    try {
      const c = document.createElement('canvas');
      c.width = s.width; c.height = s.height;
      Editor.drawFrame(c.getContext('2d'), 0, true);
      const bytes = await AseFile.write(s, App.palette);
      const data = {
        version: 3,
        w: s.width, h: s.height,
        png: c.toDataURL('image/png'),
        ase: bytesToBase64(bytes),
        colorMode: s.colorMode,
        fg: App.fg, bg: App.bg,
        paletteName: App.paletteName, palette: App.palette.map(colorToHex),
        fileName: App.fileName,
        time: Date.now(),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
      $('#autosave-state').textContent = '✓ 자동 저장됨';
    } catch {
      $('#autosave-state').textContent = '⚠ 자동 저장 안 됨 (그림이 너무 커요)';
    }
  },

  readAutosave() {
    try {
      return JSON.parse(localStorage.getItem(AUTOSAVE_KEY))
        || JSON.parse(localStorage.getItem('dotstudio.autosave.v2'))
        || JSON.parse(localStorage.getItem('dotstudio.autosave.v1'));
    } catch { return null; }
  },

  async restoreAutosave(saved) {
    if (saved.version === 3) {
      if (!(await this.openAse(base64ToBytes(saved.ase).buffer, '이어서 그리기'))) return;
      App.sprite.colorMode = saved.colorMode || 'rgb';
      App.fileName = saved.fileName || 'dot-art';
      App.setPalette(saved.paletteName, saved.palette.map(hexToColor));
      App.fg = saved.fg; App.bg = saved.bg;
      App.emit('color');
      App.emit('colormode');
      return;
    }
    const decode = url => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        resolve(g.getImageData(0, 0, img.width, img.height).data);
      };
      img.onerror = reject;
      img.src = url;
    });
    try {
      const s = new Sprite(saved.w, saved.h);
      // v1(1단계) 저장본은 레이어 하나짜리 그림으로 불러온다
      const layers = saved.layers || [{ name: '레이어 1', visible: true, locked: false, opacity: 255, cels: [saved.png] }];
      s.frames = (saved.frames || [{ duration: 100 }]).map(f => ({ ...f }));
      s.tags = (saved.tags || []).map(t => ({ ...t }));
      for (const ld of layers) {
        const l = new Layer(ld.name);
        Object.assign(l, { visible: ld.visible, locked: ld.locked, opacity: ld.opacity });
        l.cels = await Promise.all(s.frames.map(async (_, f) => {
          const cel = s.newCel();
          if (ld.cels[f]) cel.image.data.set(await decode(ld.cels[f]));
          return cel;
        }));
        s.layers.push(l);
      }
      App.loadSprite(s, '이어서 그리기');
      document.querySelectorAll('.modal').forEach(m => m.hidden = true);
      if (PALETTES[saved.paletteName]) $('#palette-select').value = saved.paletteName;
      App.setPalette(saved.paletteName, saved.palette.map(hexToColor));
      App.fg = saved.fg; App.bg = saved.bg;
      App.emit('color');
    } catch {
      this.toast('저장된 그림을 불러오지 못했어요.');
    }
  },

  // ---------- 단축키 ----------
  bindKeys() {
    window.addEventListener('keydown', e => {
      const typing = !!e.target.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea');
      if (e.key === 'Escape') {
        if (this.modalOpen) this.closeModals();
        else if (App.selection) Selection.clear();
        return;
      }
      if (typing || this.modalOpen || !App.sprite) return;
      const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();

      if (ctrl) {
        const map = {
          z: () => e.shiftKey ? App.redo() : App.undo(),
          y: () => App.redo(),
          s: () => this.showSaveDialog(),
          e: () => this.showExportDialog(),
          n: () => this.showNewDialog(),
          o: () => $('#file-open').click(),
          "'": () => App.setOpt('grid', !App.opt.grid),
          a: () => Selection.all(),
          d: () => Selection.clear(),
          c: () => Selection.copy(),
          x: () => Selection.cut(),
          v: () => Selection.paste(),
          i: () => { if (e.shiftKey) Selection.invert(); },
        };
        if (map[k]) { e.preventDefault(); map[k](); }
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        if (!Editor.spaceDown) { Editor.spaceDown = true; Editor.updateCursor(); Editor.render(); }
        return;
      }
      if (e.key === 'Alt') {
        e.preventDefault();
        if (!Editor.altDown) { Editor.altDown = true; Editor.updateCursor(); this.renderHint(); Editor.render(); }
        return;
      }
      if (e.altKey && e.shiftKey && k === 'n') { e.preventDefault(); App.addFrame(true, true); return; }
      if (e.altKey && k === 'n') { e.preventDefault(); App.addFrame(true); return; }
      if (e.shiftKey && k === 'n') { App.addLayer(); return; }
      if (e.shiftKey && k === 'u') { App.setTool('ellipse'); return; }
      if (e.shiftKey && k === 'h') { Selection.transform('flipH'); return; }
      if (e.shiftKey && k === 'v') { Selection.transform('flipV'); return; }
      if (e.shiftKey && k === 'r') { Selection.transform('rotCW'); return; }
      if (e.shiftKey && k === 's') { Resize.showScaleDialog(); return; }
      if (e.shiftKey && k === 'f') { Effects.show(); return; }

      // 이동 툴에서는 방향키가 한 칸씩 옮기기
      const nudge = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (nudge && App.tool === 'move') { e.preventDefault(); Tools.move.nudge(...nudge); return; }

      const timeline = {
        enter: () => Timeline.toggle(),
        ',': () => App.setFrame(App.frame - 1),
        '.': () => App.setFrame(App.frame + 1),
        arrowleft: () => App.setFrame(App.frame - 1),
        arrowright: () => App.setFrame(App.frame + 1),
        arrowup: () => App.setLayer(App.layer + 1),
        arrowdown: () => App.setLayer(App.layer - 1),
        delete: () => Selection.deleteSelected(),
        backspace: () => Selection.deleteSelected(),
        f1: () => this.openModal('#dlg-help'),
        f3: () => App.setOpt('onion', !App.opt.onion),
      }[k];
      if (timeline) {
        e.preventDefault();
        if (k !== 'enter') Timeline.stop();
        timeline();
        return;
      }

      const tool = Object.values(Tools).find(t => t.key.toLowerCase() === k);
      if (tool) { App.setTool(tool.id); return; }
      const other = {
        x: () => App.swapColors(),
        '[': () => App.setOpt('size', Math.max(1, App.opt.size - 1)),
        ']': () => App.setOpt('size', Math.min(16, App.opt.size + 1)),
        '+': () => Editor.zoomStep(1),
        '=': () => Editor.zoomStep(1),
        '-': () => Editor.zoomStep(-1),
        '0': () => Editor.fit(),
      }[k];
      if (other) { e.preventDefault(); other(); }
    });

    const release = e => {
      if (e.key === ' ' || e.type === 'blur') { Editor.spaceDown = false; }
      if (e.key === 'Alt' || e.type === 'blur') { Editor.altDown = false; this.renderHint(); }
      Editor.updateCursor();
      Editor.render();
    };
    window.addEventListener('keyup', release);
    window.addEventListener('blur', release);
  },

  buildHelpKeys() {
    const rows = TOOL_ORDER.filter(id => id !== '|').map(id => [Tools[id].key, Tools[id].label]).concat([
      ['X', '주 색 ↔ 보조 색'],
      ['[ / ]', '브러시 작게 / 크게'],
      ['+ / − / 0', '확대 / 축소 / 맞춤'],
      ['Ctrl+Z / Ctrl+Y', '실행 취소 / 다시 실행'],
      ["Ctrl+'", '격자 켜기/끄기'],
      ['Ctrl+S', '저장 (.aseprite)'],
      ['Ctrl+E', '내보내기 (PNG · GIF · 시트)'],
      ['Ctrl+A / Ctrl+D', '전체 선택 / 선택 해제'],
      ['Ctrl+C / X / V', '복사 / 잘라내기 / 붙여넣기'],
      ['Shift+H / V', '좌우 / 상하 뒤집기'],
      ['Shift+R', '오른쪽으로 90° 회전'],
      ['Shift+S', '선택한 부분 크기 조절'],
      ['Shift+F', '효과 (외곽선 · 색 바꾸기 · 색조)'],
      ['D', '그라데이션'],
      ['이동 툴 + 손잡이', '선택 영역 크기 조절 · 회전 (Shift: 비율 유지 / 15°씩)'],
      ['Alt+Shift+N', '프레임 링크 복제'],
      ['방향키 (이동 툴)', '한 칸씩 옮기기'],
      ['Enter', '애니메이션 재생 / 정지'],
      ['← → (또는 , .)', '이전 / 다음 프레임'],
      ['↑ ↓', '위 / 아래 레이어'],
      ['Alt+N', '프레임 복제'],
      ['Shift+N', '새 레이어'],
      ['Delete', '지금 칸 비우기'],
      ['F3', '어니언 스킨 켜기/끄기'],
    ]);
    $('#help-keys').innerHTML = rows.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('');
  },

  // ---------- 툴팁 ----------
  bindTooltips() {
    const tip = $('#tooltip');
    let timer;
    document.addEventListener('mouseover', e => {
      const t = e.target.closest('[data-tip-title]');
      clearTimeout(timer);
      if (!t) { tip.hidden = true; return; }
      timer = setTimeout(() => {
        const key = t.dataset.tipKey ? ` <kbd>${t.dataset.tipKey}</kbd>` : '';
        tip.querySelector('.tt-title').innerHTML = t.dataset.tipTitle + key;
        tip.querySelector('.tt-desc').innerHTML = (t.dataset.tipDesc || '').replace(/\n/g, '<br>');
        tip.hidden = false;
        const r = t.getBoundingClientRect(), tr = tip.getBoundingClientRect();
        let x = r.right + 8, y = r.top;
        if (x + tr.width > innerWidth - 8) { x = Math.max(8, r.left); y = r.bottom + 8; }
        if (y + tr.height > innerHeight - 8) y = Math.max(8, r.top - tr.height - 8);
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
      }, 350);
    });
    document.addEventListener('pointerdown', () => { clearTimeout(timer); tip.hidden = true; });
  },
};

UI.init();

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
