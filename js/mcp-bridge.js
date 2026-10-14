// AI 연결 (MCP 브리지)
// mcp/server.js가 켜져 있으면 명령을 받아서 실행하고 결과를 돌려준다. 서버가 없으면 가끔 다시 시도만 한다.
// AI가 한 작업도 사람이 한 작업과 똑같이 작업 기록에 남아서 Ctrl+Z로 되돌릴 수 있다.

const McpBridge = {
  base: location.port === '5174' ? '' : 'http://localhost:5174',
  connected: false,

  start() { this.loop(); },

  async loop() {
    let delay = 2000;
    for (;;) {
      try {
        const res = await fetch(this.base + '/mcp/poll', { cache: 'no-store' });
        this.setStatus(true);
        delay = 2000;
        if (res.status !== 200) continue;
        const cmd = await res.json();
        const reply = await this.run(cmd);
        // text/plain이면 다른 포트로 보낼 때 사전 확인 요청이 필요 없다
        await fetch(this.base + '/mcp/result', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(reply) });
      } catch {
        this.setStatus(false);
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 1.5, 10000);
      }
    }
  },

  setStatus(connected, activity) {
    this.connected = connected;
    const n = document.querySelector('#mcp-state');
    n.hidden = !connected;
    n.textContent = activity ? `🤖 AI: ${activity}` : '🤖 AI 연결됨';
    n.classList.toggle('busy', !!activity);
  },

  async run(cmd) {
    const h = this.handlers[cmd.name];
    this.setStatus(true, TOOL_LABELS[cmd.name] || cmd.name);
    try {
      if (!h) throw new Error(`모르는 명령이에요: ${cmd.name}`);
      const out = await h.call(this, cmd.args || {});
      return { id: cmd.id, ok: true, ...out };
    } catch (e) {
      return { id: cmd.id, ok: false, error: e.message };
    } finally {
      this.setStatus(true);
    }
  },

  // ---------- 도우미 ----------
  need() {
    if (!App.sprite) throw new Error('열린 그림이 없어요. new_sprite로 먼저 만드세요.');
    return App.sprite;
  },

  color(value, name = 'color') {
    if (value == null || value === 'transparent') return [0, 0, 0, 0];
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value).trim());
    if (!m) throw new Error(`${name} "${value}"는 색이 아니에요. "#rrggbb" 형식으로 주세요.`);
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6), 16) : 255);
    if (c[3] && ColorMode.isIndexed()) return [...ColorMode.nearest(c).slice(0, 3), c[3]];
    return c;
  },

  int(v, name, min, max, def) {
    if (v == null) {
      if (def !== undefined) return def;
      throw new Error(`${name} 값이 필요해요.`);
    }
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${name}은(는) ${min}~${max} 사이의 정수여야 해요.`);
    return v;
  },

  // 대상 칸을 정하고 그 칸을 화면에 보여 준다
  pick(args) {
    const s = this.need();
    const li = this.int(args.layer, 'layer', 0, s.layers.length - 1, App.layer);
    const fi = this.int(args.frame, 'frame', 0, s.frames.length - 1, App.frame);
    const layer = s.layers[li];
    if (layer.locked) throw new Error(`"${layer.name}" 레이어가 잠겨 있어요. layer 도구의 update로 locked=false로 바꾸거나 다른 레이어를 고르세요.`);
    Timeline.stop();
    App.setCursor(li, fi);
    return { li, fi, layer };
  },

  // 한 칸을 고치는 작업을 실행 취소 하나로 묶는다
  edit(args, label, fn) {
    const { li, fi } = this.pick(args);
    Editor.beginStroke('AI: ' + label);
    const img = App.activeImage();
    const before = img.data.slice();
    fn(img);
    let changed = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (before[i] !== img.data[i] || before[i + 1] !== img.data[i + 1] || before[i + 2] !== img.data[i + 2] || before[i + 3] !== img.data[i + 3]) changed++;
    }
    Editor.endStroke();
    Editor.refresh();
    return { text: `${label}: 레이어 ${li}, 프레임 ${fi}에서 ${changed}칸이 바뀌었어요.` };
  },

  stamp(img, x, y, size, c) {
    if (size <= 1) return img.set(x, y, c);
    for (const [dx, dy] of brushOffsets(size, 'circle')) img.set(x + dx, y + dy, c);
  },

  state() {
    const s = App.sprite;
    if (!s) return { open: false, hint: 'new_sprite로 그림을 만드세요.' };
    return {
      open: true,
      width: s.width, height: s.height,
      colorMode: s.colorMode,
      currentLayer: App.layer, currentFrame: App.frame,
      layers: s.layers.map((l, i) => ({
        index: i, name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity,
        tilemap: l.tileset ? `${l.tileset.tileW}x${l.tileset.tileH}` : undefined,
        emptyFrames: l.cels.map((c, f) => c.empty ? f : -1).filter(f => f >= 0),
        reference: l.reference || undefined,
        linkedFrames: l.cels.map((c, f) => s.isLinked(l, f) ? f : -1).filter(f => f >= 0),
      })),
      frames: s.frames.map((f, i) => ({ index: i, duration: f.duration })),
      tags: s.tags.map((t, i) => ({ index: i, ...t })),
      palette: { name: App.paletteName, colors: App.palette.map(colorToHex) },
      primary: colorToHex(App.fg), secondary: colorToHex(App.bg),
      selection: App.selection ? App.selection.bounds : null,
    };
  },

  framesFor(tagName) {
    const s = App.sprite;
    if (!tagName) return s.frames.map((_, i) => i);
    const t = s.tags.find(t => t.name === tagName);
    if (!t) throw new Error(`"${tagName}" 태그가 없어요. 있는 태그: ${s.tags.map(t => t.name).join(', ') || '없음'}`);
    return Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i);
  },

  canvasBase64(c) { return c.toDataURL('image/png').split(',')[1]; },

  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
      img.src = src;
    });
  },

  closeDialogs() { document.querySelectorAll('.modal').forEach(m => m.hidden = true); },

  // ---------- 명령 ----------
  handlers: {
    get_state() {
      return { text: JSON.stringify(this.state()) };
    },

    get_image(a) {
      const s = this.need();
      const frame = this.int(a.frame, 'frame', 0, s.frames.length - 1, App.frame);
      const scale = this.int(a.scale, 'scale', 1, 32, Math.max(1, Math.min(32, Math.floor(512 / Math.max(s.width, s.height)))));
      const W = s.width * scale, H = s.height * scale;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      // 투명한 곳은 체크무늬로
      for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
        g.fillStyle = ((x + y) / 8) % 2 ? '#c8c8c8' : '#ececec';
        g.fillRect(x, y, 8, 8);
      }
      g.imageSmoothingEnabled = false;
      if (a.layer != null) {
        const li = this.int(a.layer, 'layer', 0, s.layers.length - 1);
        const img = s.layers[li].cels[frame].image, lc = document.createElement('canvas');
        lc.width = s.width; lc.height = s.height;
        lc.getContext('2d').putImageData(new ImageData(img.data.slice(), s.width, s.height), 0, 0);
        g.drawImage(lc, 0, 0, W, H);
      } else {
        g.drawImage(Exporter.renderFrame(frame, 1), 0, 0, W, H);
      }
      const grid = a.grid != null ? a.grid : scale >= 8;
      if (grid && scale >= 4) {
        for (let i = 1; i < Math.max(s.width, s.height); i++) {
          g.fillStyle = i % 8 ? 'rgba(0,0,0,.15)' : 'rgba(0,0,0,.45)';
          if (i < s.width) g.fillRect(i * scale, 0, 1, H);
          if (i < s.height) g.fillRect(0, i * scale, W, 1);
        }
      }
      return {
        text: `프레임 ${frame}${a.layer != null ? ` · 레이어 ${a.layer}만` : ''} · ${s.width}×${s.height}px를 ${scale}배로 (한 칸 = ${scale}px${grid && scale >= 4 ? ', 8칸마다 진한 선' : ''})`,
        image: this.canvasBase64(c),
      };
    },

    new_sprite(a) {
      const w = this.int(a.width, 'width', 1, 1024), h = this.int(a.height, 'height', 1, 1024);
      const bg = !a.background || a.background === 'transparent' ? null : this.color(a.background, 'background');
      App.loadSprite(Sprite.create(w, h, bg), 'AI: 새 그림');
      this.closeDialogs();
      return { text: `${w}×${h} 새 그림을 만들었어요. ${bg ? '"배경" 레이어(0)와 그릴 "레이어 1"(1)이 있어요.' : '레이어 1개, 프레임 1개예요.'}` };
    },

    draw_ascii(a) {
      if (!Array.isArray(a.rows) || !a.rows.length) throw new Error('rows가 비어 있어요.');
      const legend = new Map(Object.entries(a.legend || {}).map(([k, v]) => [k, this.color(v, `legend "${k}"`)]));
      if (!legend.size) throw new Error('legend가 비어 있어요.');
      const x0 = a.x || 0, y0 = a.y || 0;
      return this.edit(a, 'ASCII 그리기', img => {
        a.rows.forEach((row, r) => Array.from(String(row)).forEach((ch, c) => {
          const col = legend.get(ch);
          if (col) img.set(x0 + c, y0 + r, col);
        }));
      });
    },

    set_pixels(a) {
      if (!Array.isArray(a.pixels)) throw new Error('pixels가 필요해요.');
      const list = a.pixels.map(p => [p.x, p.y, this.color(p.color)]);
      return this.edit(a, '점 찍기', img => { for (const [x, y, c] of list) img.set(x, y, c); });
    },

    draw_shape(a) {
      const c = this.color(a.color);
      const size = this.int(a.size, 'size', 1, 16, 1);
      const { x1, y1, x2, y2 } = a;
      if (![x1, y1, x2, y2].every(Number.isInteger)) throw new Error('x1, y1, x2, y2는 정수여야 해요.');
      const label = { line: '직선', rect: '사각형', ellipse: '원' }[a.shape];
      if (!label) throw new Error('shape는 line, rect, ellipse 중 하나예요.');
      return this.edit(a, label, img => {
        const plot = (x, y) => this.stamp(img, x, y, size, c), dot = (x, y) => img.set(x, y, c);
        if (a.shape === 'line') Raster.line(x1, y1, x2, y2, plot);
        else if (a.shape === 'rect') { if (a.filled) Raster.rectFill(x1, y1, x2, y2, dot); Raster.rect(x1, y1, x2, y2, plot); }
        else { if (a.filled) Raster.ellipseFill(x1, y1, x2, y2, dot); Raster.ellipse(x1, y1, x2, y2, plot); }
      });
    },

    fill(a) {
      const c = this.color(a.color);
      return this.edit(a, '채우기', img => Raster.floodFill(img, a.x, a.y, c, a.contiguous !== false, null));
    },

    clear(a) {
      const rect = [a.x1, a.y1, a.x2, a.y2];
      const partial = rect.some(v => v != null);
      if (partial && !rect.every(Number.isInteger)) throw new Error('일부만 지우려면 x1, y1, x2, y2를 모두 주세요.');
      return this.edit(a, '지우기', img => {
        if (!partial) return img.data.fill(0);
        Raster.rectFill(a.x1, a.y1, a.x2, a.y2, (x, y) => img.set(x, y, TRANSPARENT));
      });
    },

    transform(a) {
      const labels = { flipH: '좌우 뒤집기', flipV: '상하 뒤집기', rotCW: '오른쪽 90° 회전', rotCCW: '왼쪽 90° 회전', shift: '옮기기' };
      if (!labels[a.kind]) throw new Error('kind는 flipH, flipV, rotCW, rotCCW, shift 중 하나예요.');
      return this.edit(a, labels[a.kind], img => {
        const src = img.clone(), w = img.w, h = img.h;
        img.data.fill(0);
        const ox = Math.floor((w - h) / 2), oy = Math.floor((h - w) / 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const c = src.get(x, y);
          if (!c[3]) continue;
          let nx, ny;
          if (a.kind === 'flipH') { nx = w - 1 - x; ny = y; }
          else if (a.kind === 'flipV') { nx = x; ny = h - 1 - y; }
          else if (a.kind === 'rotCW') { nx = h - 1 - y + ox; ny = x + oy; }
          else if (a.kind === 'rotCCW') { nx = y + ox; ny = w - 1 - x + oy; }
          else { nx = x + (a.dx || 0); ny = y + (a.dy || 0); }
          img.set(nx, ny, c);
        }
      });
    },

    layer(a) {
      const s = this.need();
      const idx = name => this.int(a.index, name, 0, s.layers.length - 1);
      if (a.action === 'add') {
        App.setLayer(this.int(a.index, 'index', 0, s.layers.length - 1, App.layer));
        App.addLayer();
        if (a.name) App.renameLayer(App.layer, a.name);
      } else if (a.action === 'select') {
        App.setLayer(idx('index'));
      } else if (a.action === 'delete') {
        App.setLayer(idx('index'));
        if (!App.removeLayer()) throw new Error('레이어가 하나뿐이라 지울 수 없어요.');
      } else if (a.action === 'update') {
        const i = idx('index'), l = s.layers[i];
        if (a.name) App.renameLayer(i, a.name);
        if (a.opacity != null) {
          const v = this.int(a.opacity, 'opacity', 0, 255);
          App.exec('AI: 레이어 투명도', () => { l.opacity = v; });
        }
        if (a.visible != null && l.visible !== a.visible) App.toggleLayerVisible(i);
        if (a.locked != null && l.locked !== a.locked) App.toggleLayerLock(i);
        if (a.move_to != null) {
          const to = this.int(a.move_to, 'move_to', 0, s.layers.length - 1);
          if (to !== s.layers.indexOf(l)) {
            App.exec('AI: 레이어 옮기기', sp => {
              sp.layers.splice(sp.layers.indexOf(l), 1);
              sp.layers.splice(to, 0, l);
              App.layer = to;
            });
          }
        }
      } else throw new Error('action은 add, update, delete, select 중 하나예요.');
      return { text: '완료. 지금 레이어: ' + JSON.stringify(this.state().layers.map(l => `${l.index}:${l.name}`)) + ` · 현재 ${App.layer}` };
    },

    frame(a) {
      const s = this.need();
      const at = () => this.int(a.index, 'index', 0, s.frames.length - 1, App.frame);
      if (a.action === 'add' || a.action === 'duplicate') {
        App.setFrame(at());
        App.addFrame(a.action === 'duplicate', a.action === 'duplicate' && !!a.linked);
      } else if (a.action === 'delete') {
        App.setFrame(at());
        if (!App.removeFrame()) throw new Error('프레임이 하나뿐이라 지울 수 없어요.');
      } else if (a.action === 'select') {
        App.setFrame(at());
      } else if (a.action === 'move') {
        const from = at(), to = this.int(a.to, 'to', 0, s.frames.length - 1);
        if (from !== to) {
          App.exec('AI: 프레임 옮기기', sp => {
            const move = arr => { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); };
            move(sp.frames);
            for (const l of sp.layers) move(l.cels);
            App.frame = to;
          });
        }
      } else if (a.action === 'unlink') {
        App.setCursor(this.int(a.layer, 'layer', 0, s.layers.length - 1, App.layer), at());
        if (!App.unlinkCel()) throw new Error('이 칸은 다른 프레임과 연결돼 있지 않아요.');
      } else if (a.action === 'duration') {
        const ms = this.int(a.ms, 'ms', 10, 5000);
        if (a.index != null) App.setFrame(at());
        App.setFrameDuration(ms, !!a.all);
      } else throw new Error('action은 add, duplicate, delete, select, move, duration 중 하나예요.');
      return { text: `완료. 프레임 ${App.sprite.frames.length}장 (${App.sprite.frames.map(f => f.duration).join(', ')}ms) · 현재 ${App.frame}` };
    },

    tag(a) {
      const s = this.need();
      if (a.action === 'remove') {
        App.removeTag(this.int(a.index, 'index', 0, s.tags.length - 1));
      } else if (a.action === 'add') {
        if (!a.name) throw new Error('태그 이름(name)이 필요해요.');
        const from = this.int(a.from, 'from', 0, s.frames.length - 1);
        const to = this.int(a.to, 'to', from, s.frames.length - 1);
        if (a.color && !/^#[0-9a-f]{6}$/i.test(a.color)) throw new Error('태그 color는 #rrggbb 형식이에요.');
        App.saveTag(null, { name: a.name, from, to, direction: a.direction || 'forward', color: a.color || TAG_COLORS[s.tags.length % TAG_COLORS.length] });
      } else throw new Error('action은 add, remove 중 하나예요.');
      return { text: '태그: ' + JSON.stringify(App.sprite.tags) };
    },

    palette(a) {
      if (a.preset) {
        if (!PALETTES[a.preset]) throw new Error(`없는 팔레트예요. 고를 수 있는 것: ${Object.keys(PALETTES).join(', ')}`);
        if (ColorMode.isIndexed()) ColorMode.swapPalette(a.preset, paletteColors(a.preset));
        else App.setPalette(a.preset);
      }
      if (a.colors) {
        if (!Array.isArray(a.colors) || !a.colors.length) throw new Error('colors는 색 목록이에요.');
        const list = a.colors.map(c => { const v = this.color(c); return [v[0], v[1], v[2], 255]; });
        App.setPalette('AI 팔레트', list);
      }
      if (a.primary) App.setColor('fg', this.color(a.primary, 'primary'));
      if (a.secondary) App.setColor('bg', this.color(a.secondary, 'secondary'));
      return { text: `팔레트 "${App.paletteName}": ${App.palette.map(colorToHex).join(' ')} · 주 색 ${colorToHex(App.fg)} · 보조 색 ${colorToHex(App.bg)}` };
    },

    apply_effect(a) {
      this.pick(a);
      const scope = a.scope || 'cel';
      if (!['cel', 'layer', 'all'].includes(scope)) throw new Error('scope는 cel, layer, all 중 하나예요.');
      const label = { outline: '외곽선', replace: '색 바꾸기', adjust: '색조 · 밝기' }[a.effect];
      if (!label) throw new Error('effect는 outline, replace, adjust 중 하나예요.');
      let fn;
      if (a.effect === 'outline') {
        const c = this.color(a.color || colorToHex(App.fg), 'color');
        fn = img => Effects.outlineImage(img, c, !!a.diagonal, null);
      } else if (a.effect === 'replace') {
        const from = this.color(a.from, 'from'), to = this.color(a.to, 'to');
        const tol = this.int(a.tolerance, 'tolerance', 0, 60, 0);
        fn = img => Effects.replaceImage(img, from, to, tol, null);
      } else {
        const snap = ColorMode.isIndexed() ? c => ColorMode.nearest(c) : null;
        const hue = this.int(a.hue, 'hue', -180, 180, 0), sat = this.int(a.saturation, 'saturation', -100, 100, 0);
        const light = this.int(a.lightness, 'lightness', -100, 100, 0);
        fn = img => Effects.adjustImage(img, hue, sat, light, null, snap);
      }
      const p = Effects.beginPreview(scope);
      p.cels.forEach(cel => { fn(cel.image); cel.invalidate(); });
      const ok = Effects.commit('AI: ' + label);
      Editor.refresh();
      return { text: `${label}: ${ok ? `${p.cels.length}칸에 적용했어요` : '바뀐 칸이 없어요'}${p.skipped.length ? ` · 건너뜀: ${p.skipped.join(', ')}` : ''}` };
    },

    history(a) {
      this.need();
      const steps = this.int(a.steps, 'steps', 1, 300, 1);
      let n = 0;
      for (let i = 0; i < steps; i++) {
        const h = App.history;
        if (a.action === 'undo' ? !h.canUndo : !h.canRedo) break;
        a.action === 'undo' ? App.undo() : App.redo();
        n++;
      }
      return { text: `${a.action === 'undo' ? '실행 취소' : '다시 실행'} ${n}번. 지금 기록: ${App.history.entries[App.history.index].label}` };
    },

    async export(a) {
      const s = this.need();
      const scale = this.int(a.scale, 'scale', 1, 16, 1);
      const name = App.fileName || 'dot-art';
      const files = [];
      if (a.format === 'aseprite') {
        files.push({ ext: '.aseprite', base64: bytesToBase64(await AseFile.write(s, App.palette)) });
      } else if (a.format === 'png') {
        const f = this.int(a.frame, 'frame', 0, s.frames.length - 1, App.frame);
        files.push({ ext: '.png', base64: this.canvasBase64(Exporter.renderFrame(f, scale)) });
      } else if (a.format === 'gif') {
        files.push({ ext: '.gif', base64: bytesToBase64(Exporter.gifBytes(scale, this.framesFor(a.tag), null)) });
      } else if (a.format === 'sheet') {
        const frames = this.framesFor(a.tag);
        const { canvas, json } = Exporter.buildSheet(name, scale, frames, a.layout || 'horizontal', this.int(a.padding, 'padding', 0, 64, 0), a.pivot || 'bottom');
        files.push({ ext: '.png', base64: this.canvasBase64(canvas) });
        files.push({ ext: '.json', base64: bytesToBase64(new TextEncoder().encode(JSON.stringify(json, null, 2))) });
      } else throw new Error('format은 aseprite, png, gif, sheet 중 하나예요.');
      if (!a.path) {
        for (const f of files) Exporter.download(new Blob([base64ToBytes(f.base64)]), name + f.ext);
      }
      return { text: `${a.format} 내보내기 완료 (${files.map(f => f.ext).join(' + ')})`, files };
    },

    async open_file(a) {
      const f = a.file;
      if (/\.(aseprite|ase)$/i.test(f.name)) {
        if (!(await UI.openAse(base64ToBytes(f.base64).buffer, 'AI: 파일 열기'))) throw new Error('Aseprite 파일을 열지 못했어요.');
      } else {
        const ext = f.name.split('.').pop().toLowerCase();
        const mime = { png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext];
        if (!mime) throw new Error('.aseprite, .ase, .png, .gif, .jpg, .webp 파일만 열 수 있어요.');
        await new Promise(resolve => UI.loadImageUrl(`data:${mime};base64,${f.base64}`, 'AI: 이미지 열기', resolve));
      }
      App.fileName = f.name.replace(/\.[^.]+$/, '');
      this.closeDialogs();
      return { text: `열었어요: ${f.name}\n` + JSON.stringify(this.state()) };
    },

    async import_sheet(a) {
      const img = await this.loadImage(`data:image/png;base64,${a.file.base64}`);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
      const json = a.json ? SheetImporter.parseJson(a.json) : null;
      if (!json && (a.frame_width == null || a.frame_height == null)) throw new Error('JSON이 없으면 frame_width와 frame_height가 필요해요.');
      const o = {
        w: a.frame_width, h: a.frame_height,
        x: a.offset_x || 0, y: a.offset_y || 0, gapX: a.gap_x || 0, gapY: a.gap_y || 0,
        duration: a.duration || 100, order: a.order || 'rows', count: a.count == null ? null : a.count,
      };
      const name = a.file.name.replace(/\.[^.]+$/, '');
      const mode = App.sprite ? (a.mode || 'new') : 'new';
      if (mode === 'new') {
        App.loadSprite(SheetImporter.split(canvas, o, json), 'AI: 시트 가져오기');
        App.fileName = name;
        this.closeDialogs();
      } else {
        if (!['frames', 'layer'].includes(mode)) throw new Error('mode는 new, frames, layer 중 하나예요.');
        SheetImporter.addToSprite(SheetImporter.extract(canvas, o, json), mode, name);
      }
      return { text: '가져왔어요.\n' + JSON.stringify(this.state()) };
    },
  },
};

const TOOL_LABELS = {
  get_state: '상태 확인', get_image: '그림 확인', new_sprite: '새 그림', draw_ascii: '그리는 중', set_pixels: '점 찍는 중',
  draw_shape: '도형 그리는 중', fill: '채우는 중', clear: '지우는 중', transform: '변형', layer: '레이어', frame: '프레임',
  tag: '태그', palette: '팔레트', apply_effect: '효과', history: '되돌리기', export: '내보내는 중', open_file: '파일 여는 중',
  import_sheet: '시트 가져오는 중',
};

McpBridge.start();
