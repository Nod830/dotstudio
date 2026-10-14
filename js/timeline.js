// 타임라인: 레이어(행) × 프레임(열) 격자, 태그, 재생, 미리보기 애니메이션

const EYE_ICON = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.3 6.3C3.6 8.1 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.7-1.7"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const UNLOCK_ICON = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';

const DIRECTION_LABEL = { forward: '정방향 →', reverse: '역방향 ←', pingpong: '왕복 ↔' };
const TAG_NAME_SUGGESTIONS = ['Idle', 'Walk', 'Run', 'Jump', 'Attack', 'Hit', 'Die'];

// 재생 범위(from~to)와 방향에 따라 다음 프레임을 계산한다
function makeStepper(from, to, direction) {
  let dir = direction === 'reverse' ? -1 : 1;
  return f => {
    if (from === to) return from;
    if (f < from || f > to) return direction === 'reverse' ? to : from;
    if (direction === 'pingpong') {
      if (f + dir > to || f + dir < from) dir = -dir;
      return f + dir;
    }
    const n = f + dir;
    return n > to ? from : n < from ? to : n;
  };
}

function playRange() {
  const s = App.sprite;
  const tag = App.opt.loopTag ? s.tagAt(App.frame) : null;
  return tag
    ? { from: tag.from, to: tag.to, direction: tag.direction, tag }
    : { from: 0, to: s.frames.length - 1, direction: 'forward' };
}

const Timeline = {
  playing: false,
  CELL: 30,

  init() {
    this.grid = $('#tl-grid');
    $('#ref-file').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !App.sprite) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        App.addReferenceLayer(img, file.name.replace(/\.[^.]+$/, ''));
        URL.revokeObjectURL(url);
        UI.toast('밑그림을 깔았어요. 새 레이어를 만들어 그 위에 따라 그려 보세요. 내보낼 때는 빠져요.');
      };
      img.onerror = () => { URL.revokeObjectURL(url); UI.toast('그림을 읽지 못했어요.'); };
      img.src = url;
    });
    this.bindBar();
    App.on('doc', () => this.render());
    App.on('cursor', () => this.render());
    App.on('sprite', () => { this.stop(); this.render(); });
    App.on('opt', key => { if (key === 'onion' || key === 'loopTag') this.renderBar(); });
  },

  // ---------- 위쪽 버튼 줄 ----------
  bindBar() {
    document.querySelectorAll('[data-tl]').forEach(b => b.addEventListener('click', () => {
      const s = App.sprite;
      if (!s) return;
      ({
        first: () => App.setFrame(0),
        prev: () => App.setFrame(App.frame === 0 ? s.frames.length - 1 : App.frame - 1),
        play: () => this.toggle(),
        next: () => App.setFrame((App.frame + 1) % s.frames.length),
        last: () => App.setFrame(s.frames.length - 1),
        'frame-new': () => App.addFrame(false),
        'frame-dup': () => App.addFrame(true),
        'frame-link': () => App.addFrame(true, true),
        unlink: () => { if (!App.unlinkCel()) UI.toast('지금 칸은 다른 프레임과 연결돼 있지 않아요.'); },
        'frame-del': () => { if (!App.removeFrame()) UI.toast('프레임이 하나뿐이라 지울 수 없어요.'); },
        'frame-left': () => App.moveFrame(-1),
        'frame-right': () => App.moveFrame(1),
        'dur-all': () => App.setFrameDuration(+$('#tl-duration').value, true),
        'tag-new': () => UI.showTagDialog(null),
        collapse: () => { document.body.classList.toggle('tl-collapsed'); Editor.resize(); },
      })[b.dataset.tl]?.();
    }));

    const dur = $('#tl-duration');
    dur.addEventListener('change', () => App.setFrameDuration(+dur.value, false));
    dur.addEventListener('keydown', e => { if (e.key === 'Enter') dur.blur(); });
    dur.addEventListener('input', () => this.renderFps());

    const onion = $('#tl-onion');
    onion.addEventListener('change', () => App.setOpt('onion', onion.checked));
    for (const which of ['Prev', 'Next']) {
      const sel = $(`#tl-onion-${which.toLowerCase()}`);
      for (let i = 0; i <= 3; i++) sel.append(el('option', { value: i }, i));
      sel.value = App.opt['onion' + which];
      sel.addEventListener('change', () => App.setOpt('onion' + which, +sel.value));
    }
    const loop = $('#tl-looptag');
    loop.addEventListener('change', () => App.setOpt('loopTag', loop.checked));

    const op = $('#tl-opacity');
    op.addEventListener('input', () => {
      App.setLayerOpacity(App.layer, Math.round(op.value * 2.55), false);
      $('#tl-opacity-val').textContent = op.value + '%';
    });
    op.addEventListener('change', () => App.setLayerOpacity(App.layer, Math.round(op.value * 2.55), true));
  },

  renderBar() {
    const s = App.sprite;
    if (!s) return;
    $('#tl-frame-info').textContent = `${App.frame + 1} / ${s.frames.length}`;
    $('[data-tl=unlink]').disabled = !s.isLinked(App.currentLayer(), App.frame);
    const dur = $('#tl-duration');
    if (document.activeElement !== dur) dur.value = s.frames[App.frame].duration;
    this.renderFps();
    $('#tl-onion').checked = App.opt.onion;
    $('#tl-looptag').checked = App.opt.loopTag;
    const playBtn = $('[data-tl=play]');
    playBtn.innerHTML = this.playing ? '■ 정지' : '▶ 재생';
    playBtn.classList.toggle('on', this.playing);
    const op = Math.round(App.currentLayer().opacity / 2.55);
    $('#tl-opacity').value = op;
    $('#tl-opacity-val').textContent = op + '%';
  },

  renderFps() {
    const ms = +$('#tl-duration').value || 100;
    $('#tl-fps').textContent = `(초당 ${Math.round(10000 / ms) / 10}장)`;
  },

  // ---------- 격자 ----------
  render() {
    const s = App.sprite;
    if (!s) return;
    this.renderBar();
    const C = this.CELL, nF = s.frames.length;
    const g = this.grid;
    const scrollLeft = $('#tl-body').scrollLeft, scrollTop = $('#tl-body').scrollTop;
    g.innerHTML = '';
    g.style.setProperty('--cell', C + 'px');

    // 1) 태그 줄
    const tagRow = el('div', { class: 'tl-row tl-tags' });
    const tagHead = el('div', { class: 'tl-head' },
      `<span class="tl-label">태그</span>`);
    const addTag = el('button', {
      class: 'tl-mini', 'data-tip-title': '태그 추가', 'data-tip-desc': '프레임 구간에 이름을 붙여요. 예: Idle 1~4, Run 5~10. 게임 엔진에서 애니메이션 이름으로 쓰여요.',
    }, '＋ 태그');
    addTag.addEventListener('click', () => UI.showTagDialog(null));
    tagHead.append(addTag);
    const tagTrack = el('div', { class: 'tl-track' });
    tagTrack.style.width = (nF + 1) * C + 'px';
    s.tags.forEach((t, i) => {
      const bar = el('button', {
        class: 'tl-tag',
        'data-tip-title': `${t.name}  (${t.from + 1}~${t.to + 1})`,
        'data-tip-desc': `${DIRECTION_LABEL[t.direction]} · 눌러서 고치기`,
      }, `<span>${escapeHtml(t.name)}</span>`);
      bar.style.left = t.from * C + 'px';
      bar.style.width = (t.to - t.from + 1) * C - 2 + 'px';
      bar.style.setProperty('--tag', t.color);
      bar.addEventListener('click', () => UI.showTagDialog(i));
      tagTrack.append(bar);
    });
    if (!s.tags.length) tagTrack.append(el('span', { class: 'tl-empty-hint' }, '태그로 Idle · Run 같은 동작 구간을 나눌 수 있어요'));
    tagRow.append(tagHead, tagTrack);

    // 2) 프레임 번호 줄 + 레이어 버튼
    const frameRow = el('div', { class: 'tl-row tl-frames' });
    const layerBtns = el('div', { class: 'tl-head tl-layer-btns' });
    const btn = (label, title, desc, fn) => {
      const b = el('button', { class: 'tl-mini', 'data-tip-title': title, 'data-tip-desc': desc }, label);
      b.addEventListener('click', fn);
      layerBtns.append(b);
    };
    btn('＋', '레이어 추가', '지금 레이어 위에 새 투명 레이어를 만들어요. 선 따기 · 색칠 · 그림자를 나눠 그리면 고치기 쉬워요.  (Shift+N)', () => App.addLayer());
    btn('▦', '타일맵 레이어', '칸마다 타일을 까는 레이어를 만들거나, 지금 레이어를 타일맵으로 바꿔요. 배경 · 맵 만들 때 좋아요.', () => UI.showTilemapDialog());
    btn('🖼', '밑그림 넣기', '참고할 그림을 반투명하게 깔아요. 따라 그리기 좋고, 내보내기 · 미리보기에서는 빠져요. 잠겨 있어서 실수로 그려지지 않아요.', () => $('#ref-file').click());
    btn('⧉', '레이어 복제', '지금 레이어를 통째로 복사해요.', () => App.duplicateLayer());
    btn('⤓', '아래와 합치기', '지금 레이어를 바로 아래 레이어와 하나로 합쳐요.', () => { if (!App.mergeDown()) UI.toast('맨 아래 레이어는 합칠 대상이 없어요.'); });
    btn('↑', '레이어 위로', '지금 레이어를 한 칸 위로 올려요. 위에 있을수록 앞에 보여요.', () => App.moveLayer(1));
    btn('↓', '레이어 아래로', '지금 레이어를 한 칸 아래로 내려요.', () => App.moveLayer(-1));
    btn('🗑', '레이어 삭제', '지금 레이어를 지워요. 실수했다면 Ctrl+Z로 되돌릴 수 있어요.', () => { if (!App.removeLayer()) UI.toast('레이어가 하나뿐이라 지울 수 없어요.'); });
    const frameTrack = el('div', { class: 'tl-track' });
    s.frames.forEach((f, i) => {
      const tag = s.tagAt(i);
      const n = el('button', {
        class: 'tl-fnum' + (i === App.frame ? ' current' : ''),
        'data-tip-title': `${i + 1}번 프레임`, 'data-tip-desc': `${f.duration}ms 동안 보여요`,
      }, String(i + 1));
      if (tag) n.style.setProperty('--tag', tag.color);
      n.addEventListener('click', () => App.setFrame(i));
      n.addEventListener('dblclick', () => { $('#tl-duration').focus(); $('#tl-duration').select(); });
      this.makeDraggable(n, 'frame', i);
      frameTrack.append(n);
    });
    const ghost = el('button', {
      class: 'tl-fnum ghost', 'data-tip-title': '다음 프레임 만들기',
      'data-tip-desc': '지금 프레임을 복사해서 바로 뒤에 붙여요. 조금씩 고쳐 가며 움직임을 만들어 보세요.',
    }, '＋');
    ghost.addEventListener('click', () => App.addFrame(true));
    frameTrack.append(ghost);
    frameRow.append(layerBtns, frameTrack);
    g.append(tagRow, frameRow);

    // 3) 레이어 줄 (위 레이어가 위에 보이도록 거꾸로)
    for (let li = s.layers.length - 1; li >= 0; li--) {
      const layer = s.layers[li];
      const row = el('div', { class: 'tl-row tl-layer' + (li === App.layer ? ' current' : '') + (layer.visible ? '' : ' hidden-layer') });
      const head = el('div', { class: 'tl-head' });
      const eye = el('button', { class: 'tl-icon' + (layer.visible ? '' : ' off'), 'data-tip-title': layer.visible ? '숨기기' : '보이기', 'data-tip-desc': '레이어를 잠깐 안 보이게 해요. 지워지는 건 아니에요.' }, layer.visible ? EYE_ICON : EYE_OFF_ICON);
      eye.addEventListener('click', e => { e.stopPropagation(); App.toggleLayerVisible(li); });
      const lock = el('button', { class: 'tl-icon' + (layer.locked ? ' on' : ' off'), 'data-tip-title': layer.locked ? '잠금 풀기' : '잠그기', 'data-tip-desc': '잠그면 실수로 그려지지 않아요. 다 그린 레이어를 보호할 때 써요.' }, layer.locked ? LOCK_ICON : UNLOCK_ICON);
      lock.addEventListener('click', e => { e.stopPropagation(); App.toggleLayerLock(li); });
      const name = el('span', { class: 'tl-name', title: '두 번 눌러 이름 바꾸기' }, (layer.tileset ? '<span class="tl-badge" title="타일맵 레이어">▦</span> ' : '') + (layer.reference ? '<span class="tl-badge" title="밑그림 레이어: 내보내기에서 빠져요">🖼</span> ' : '') + escapeHtml(layer.name) + (layer.opacity < 255 ? ` <span class="muted">${Math.round(layer.opacity / 2.55)}%</span>` : ''));
      name.addEventListener('dblclick', () => this.startRename(name, li));
      head.append(eye, lock, name);
      head.addEventListener('click', () => App.setLayer(li));
      this.makeDraggable(head, 'layer', li);

      const track = el('div', { class: 'tl-track' });
      layer.cels.forEach((cel, fi) => {
        // 링크된 칸: 이웃 프레임과 같은 셀이면 막대로 잇는다
        const linkL = fi > 0 && layer.cels[fi - 1] === cel, linkR = layer.cels[fi + 1] === cel;
        const linked = linkL || linkR || s.isLinked(layer, fi);
        const c = el('button', { class: 'tl-cel' + (fi === App.frame ? ' col' : '') + (fi === App.frame && li === App.layer ? ' current' : '') + (linkL ? ' link-l' : '') + (linkR ? ' link-r' : '') });
        if (linked) c.title = '다른 프레임과 같은 그림을 쓰는 칸 (링크). 고치면 함께 바뀌어요.';
        c.innerHTML = cel.empty ? `<i class="dot empty${linked ? ' linked' : ''}"></i>` : `<i class="dot${linked ? ' linked' : ''}"></i>`;
        c.addEventListener('click', () => App.setCursor(li, fi));
        track.append(c);
      });
      row.append(head, track);
      g.append(row);
    }

    const body = $('#tl-body');
    body.scrollLeft = scrollLeft;
    body.scrollTop = scrollTop;
    // 현재 프레임이 보이도록
    const x = App.frame * C, viewW = body.clientWidth - 250;
    if (x < body.scrollLeft) body.scrollLeft = x;
    else if (x + C > body.scrollLeft + viewW) body.scrollLeft = x + C - viewW;
  },

  // 레이어는 위/아래, 프레임은 앞/뒤에 놓는다. 놓일 자리를 선으로 보여 준다.
  makeDraggable(node, type, index) {
    node.draggable = true;
    node.addEventListener('dragstart', e => {
      this.drag = { type, index };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', type);
    });
    node.addEventListener('dragend', () => { this.drag = null; this.clearDrop(); });
    node.addEventListener('dragover', e => {
      if (!this.drag || this.drag.type !== type) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const first = type === 'layer' ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
      this.clearDrop();
      node.classList.add(type === 'layer' ? (first ? 'drop-above' : 'drop-below') : (first ? 'drop-before' : 'drop-after'));
      this.dropFirst = first;
    });
    node.addEventListener('drop', e => {
      if (!this.drag || this.drag.type !== type) return;
      e.preventDefault();
      const from = this.drag.index;
      this.drag = null;
      this.clearDrop();
      // 화면에서 위쪽 절반 = 그 레이어 위, 앞쪽 절반 = 그 프레임 앞
      if (type === 'layer') App.moveLayerTo(from, index, this.dropFirst);
      else App.moveFrameTo(from, index, !this.dropFirst);
    });
  },

  clearDrop() {
    document.querySelectorAll('.drop-above, .drop-below, .drop-before, .drop-after')
      .forEach(n => n.classList.remove('drop-above', 'drop-below', 'drop-before', 'drop-after'));
  },

  startRename(span, li) {
    const input = el('input', { class: 'tl-rename', value: App.sprite.layers[li].name, maxlength: 40 });
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      if (ok) App.renameLayer(li, input.value);
      this.render();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  },

  // ---------- 재생 ----------
  toggle() { this.playing ? this.stop() : this.play(); },

  play() {
    const s = App.sprite;
    if (!s || this.playing) return;
    if (s.frames.length < 2) {
      UI.toast('프레임이 하나뿐이에요. 타임라인의 ＋ 버튼으로 프레임을 늘려 보세요.');
      return;
    }
    const r = playRange();
    this.step = makeStepper(r.from, r.to, r.direction);
    this.playing = true;
    if (App.frame < r.from || App.frame > r.to) App.setFrame(r.from);
    Editor.refresh();
    this.renderBar();
    const tick = () => {
      if (!this.playing) return;
      this.timer = setTimeout(() => {
        if (!this.playing) return;
        App.setFrame(this.step(App.frame));
        tick();
      }, s.frames[App.frame].duration);
    };
    tick();
  },

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this.timer);
    Editor.refresh();
    this.renderBar();
  },
};

// 오른쪽 미리보기 패널: 그리는 동안에도 따로 애니메이션을 돌려 볼 수 있다
const Preview = {
  playing: false,

  init() {
    this.canvas = $('#preview');
    this.frameCanvas = document.createElement('canvas');
    $('#preview-play').addEventListener('click', () => this.toggle());
    App.on('render', () => { if (!this.playing) this.draw(App.frame); });
    App.on('sprite', () => this.stop());
  },

  toggle() {
    if (this.playing) return this.stop();
    if (App.sprite.frames.length < 2) {
      UI.toast('프레임이 2장 이상 있어야 움직임을 볼 수 있어요.');
      return;
    }
    this.playing = true;
    this.f = playRange().from;
    $('#preview-play').textContent = '■';
    const tick = () => {
      if (!this.playing) return;
      const s = App.sprite, r = playRange();
      if (this.f < r.from || this.f > r.to || this.range !== `${r.from}-${r.to}-${r.direction}`) {
        this.range = `${r.from}-${r.to}-${r.direction}`;
        this.stepper = makeStepper(r.from, r.to, r.direction);
        if (this.f < r.from || this.f > r.to) this.f = r.from;
      }
      this.draw(this.f);
      const ms = s.frames[this.f].duration;
      this.f = this.stepper(this.f);
      this.timer = setTimeout(tick, ms);
    };
    tick();
  },

  stop() {
    this.playing = false;
    clearTimeout(this.timer);
    $('#preview-play').textContent = '▶';
    if (App.sprite) this.draw(App.frame);
  },

  draw(frame) {
    const s = App.sprite;
    if (!s) return;
    const cv = this.canvas, box = $('#preview-box');
    const maxW = box.clientWidth - 16, maxH = box.clientHeight - 16;
    const scale = Math.max(1, Math.floor(Math.min(maxW / s.width, maxH / s.height)));
    const w = s.width * scale, h = s.height * scale;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const fc = this.frameCanvas;
    if (fc.width !== s.width || fc.height !== s.height) { fc.width = s.width; fc.height = s.height; }
    Editor.drawFrame(fc.getContext('2d'), frame, true);
    const g = cv.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.fillStyle = Editor.checker;
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = false;
    g.drawImage(fc, 0, 0, w, h);
    $('#preview-scale').textContent = `(${scale}배 · ${frame + 1}번)`;
  },
};

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
