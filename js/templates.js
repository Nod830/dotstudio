// 애니메이션 템플릿: 프레임 수 · 속도 · 태그를 미리 잡아 두고, 밑그림 레이어에 가이드 실루엣을 깔아 준다.
// 가이드는 32칸 기준 좌표로 그린 뒤 그림 크기에 맞춰 늘린다. 밑그림 레이어라서 내보내기에는 들어가지 않는다.

const GUIDE_COLOR = [150, 165, 200, 255];

const TEMPLATES = [
  { id: 'idle', name: 'Idle 대기', desc: '4프레임 · 숨 쉬는 모습', parts: [{ name: 'Idle', frames: 4, ms: 200 }] },
  { id: 'run', name: 'Run 달리기', desc: '6프레임 · 옆에서 본 달리기', parts: [{ name: 'Run', frames: 6, ms: 100 }] },
  {
    id: 'both', name: 'Idle + Run', desc: '10프레임 · 태그 2개',
    parts: [{ name: 'Idle', frames: 4, ms: 200 }, { name: 'Run', frames: 6, ms: 100 }],
  },
];

const Templates = {
  // 한 프레임의 가이드 실루엣 (오른쪽을 보는 사람). 32×32 기준 좌표.
  // pose: { sink: 몸 내려가는 칸 수, legs: [앞다리 {x,lift}, 뒷다리], arms: [앞팔 x, 뒷팔 x], lean }
  poseFor(kind, i, n) {
    const t = (i / n) * Math.PI * 2;
    if (kind === 'idle') {
      // 숨 쉴 때 머리와 어깨만 살짝 내려갔다 올라온다
      const breath = [0, 0, 1, 1][i % 4];
      return { sink: breath, legs: [{ x: 2, lift: 0 }, { x: -2, lift: 0 }], arms: [1, -1], lean: 0, idle: true };
    }
    const s = Math.sin(t), c = Math.cos(t);
    return {
      sink: Math.round(Math.abs(s)), // 발이 벌어질 때 몸이 가장 낮다
      legs: [{ x: Math.round(5 * s), lift: Math.round(3 * Math.max(0, c)) }, { x: Math.round(-5 * s), lift: Math.round(3 * Math.max(0, -c)) }],
      arms: [Math.round(-4 * s), Math.round(4 * s)],
      lean: 1,
    };
  },

  // 가이드 한 장을 PixelImage에 그린다
  drawGuide(img, w, h, kind, i, n) {
    const k = Math.min(w, h) / 32;
    const ox = Math.round((w - 32 * k) / 2), oy = Math.round(h - 32 * k);
    const X = v => ox + Math.round(v * k), Y = v => oy + Math.round(v * k);
    const thick = Math.max(1, Math.round(2 * k));
    const plot = (x, y) => img.set(x, y, GUIDE_COLOR);
    const dot = (x, y) => Raster.rectFill(x - ((thick - 1) >> 1), y - ((thick - 1) >> 1), x + (thick >> 1), y + (thick >> 1), plot);
    const limb = (x0, y0, x1, y1) => Raster.line(X(x0), Y(y0), X(x1), Y(y1), dot);
    const p = Templates.poseFor(kind, i, n);
    const cx = 16 + p.lean * 0; // 몸 중심
    const sink = p.sink, hipY = 21 + sink, shY = 13 + sink;

    // 바닥선 (발이 닿는 곳)
    Raster.line(ox + Math.round(3 * k), Y(31), ox + Math.round(29 * k), Y(31), (x, y) => { if (((x - ox) >> 1) % 2 === 0) plot(x, y); });

    // 뒤쪽 팔 · 다리 → 몸통 → 앞쪽 다리 · 팔 → 머리
    const back = 1, front = 0;
    const leg = j => {
      const L = p.legs[j];
      const knee = { x: cx + L.x / 2 - (p.idle ? 0 : 1), y: (hipY + 31 - L.lift) / 2 };
      limb(cx, hipY, knee.x, knee.y);
      limb(knee.x, knee.y, cx + L.x, 30 - L.lift);
      Raster.rectFill(X(cx + L.x), Y(30 - L.lift), X(cx + L.x + 2) - 1, Y(31 - L.lift) - 1, plot); // 발
    };
    const arm = j => {
      const hx = cx + p.arms[j];
      limb(cx, shY + 1, hx - (p.idle ? 0 : 1), shY + 5);
      limb(hx - (p.idle ? 0 : 1), shY + 5, hx + (p.idle ? 0 : 2), shY + 9 - (p.idle ? 0 : 2));
    };
    leg(back); arm(back);
    Raster.rectFill(X(cx - 3), Y(shY), X(cx + 3) - 1, Y(hipY + 1) - 1, plot);
    leg(front); arm(front);
    Raster.ellipseFill(X(cx - 4 + p.lean), Y(5 + sink), X(cx + 4 + p.lean) - 1, Y(13 + sink) - 1, plot);
  },

  // 템플릿으로 새 그림을 만든다: [밑그림(가이드), 그림] 두 레이어 + 프레임 + 태그
  build(id, w, h) {
    const tpl = TEMPLATES.find(t => t.id === id);
    if (!tpl) throw new Error('없는 템플릿: ' + id);
    const s = new Sprite(w, h);
    s.frames = [];
    s.tags = [];
    const guide = new Layer('밑그림 가이드');
    guide.reference = true;
    guide.locked = true;
    guide.opacity = 120;
    const art = new Layer('레이어 1');
    s.layers = [guide, art];
    let f = 0;
    tpl.parts.forEach((part, pi) => {
      for (let i = 0; i < part.frames; i++, f++) {
        s.frames.push({ duration: part.ms });
        const gi = new PixelImage(w, h);
        Templates.drawGuide(gi, w, h, part.name.toLowerCase(), i, part.frames);
        guide.cels.push(new Cel(gi));
        art.cels.push(new Cel(new PixelImage(w, h)));
      }
      s.tags.push({ name: part.name, from: f - part.frames, to: f - 1, color: TAG_COLORS[pi % TAG_COLORS.length], direction: 'forward' });
    });
    return s;
  },
};
