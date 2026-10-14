// 따라 하기 튜토리얼: 점 찍기 → 색 바꾸기 → 프레임 복제 → 점 옮기기 → 재생
// 단계마다 해야 할 곳에 깜빡이는 테두리를 두르고, 해냈는지는 0.25초마다 확인해서 자동으로 다음 단계로 넘어간다.

const TUTORIAL_KEY = 'dotstudio.tutorialDone';

const celHasPixels = (layer, f) => !layer.cels[f].empty;
const celsDiffer = (a, b) => {
  const x = a.image.data, y = b.image.data;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return true;
  return false;
};

const TUTORIAL_STEPS = [
  {
    title: '점 하나 찍어 보세요',
    text: '캔버스(체크무늬 칸)를 <b>왼쪽 클릭</b>하면 한 칸이 칠해져요. 여러 번 눌러 작은 모양을 그려도 좋아요.',
    target: ['.tool-btn[data-tool=pencil]', '#view'],
    setup() { App.setTool('pencil'); },
    done: () => App.sprite.layers.some(l => !l.reference && celHasPixels(l, 0)),
  },
  {
    title: '색을 바꿔 보세요',
    text: '오른쪽 <b>팔레트</b>에서 다른 색을 눌러 보세요. 이제 그 색으로 칠해져요.',
    target: ['#palette'],
    setup() { this.base = App.fg.join(); },
    done() { return App.fg.join() !== this.base; },
  },
  {
    title: '프레임을 복제해요',
    text: '애니메이션은 그림 여러 장(프레임)을 빠르게 넘기는 거예요. 아래 <b>⧉ 프레임 복제</b>를 눌러 지금 그림을 한 장 더 만드세요.',
    target: ['[data-tl=frame-dup]'],
    done: () => App.sprite.frames.length >= 2,
  },
  {
    title: '복제한 그림을 조금 바꿔요',
    text: '지금 <b>2번 프레임</b>이에요. 점을 하나 더 찍거나 <b>E</b>(지우개)로 지워서 1번과 다르게 만들어 보세요.',
    target: ['#view'],
    done: () => {
      const s = App.sprite;
      return s.layers.some(l => !l.reference && celHasPixels(l, 1) && celsDiffer(l.cels[0], l.cels[1]));
    },
  },
  {
    title: '재생해 보세요',
    text: '<b>▶ 재생</b>을 누르면 두 장이 번갈아 나와요. 움직이는 게 보이나요? 다시 누르면 멈춰요.',
    target: ['[data-tl=play]'],
    done: () => Timeline.playing,
  },
  {
    title: '다 했어요! 🎉',
    text: '이게 애니메이션의 전부예요. 프레임을 늘려 가며 조금씩 고치면 돼요. 저장은 <b>Ctrl+S</b>, GIF나 게임용 시트는 <b>내보내기</b>에서 해요.',
    target: ['[data-action=export]'],
    final: true,
  },
];

const Tutorial = {
  active: false,
  step: -1,

  init() {
    $('#tut-skip').addEventListener('click', () => this.next());
    $('#tut-quit').addEventListener('click', () => this.stop());
    $('#tut-finish').addEventListener('click', () => this.stop(true));
  },

  get done() {
    try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch { return false; }
  },

  start() {
    App.loadSprite(Sprite.create(16, 16, null), '튜토리얼');
    UI.closeModals();
    this.active = true;
    this.sprite = App.sprite;
    this.go(0);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.check(), 250);
  },

  stop(finished) {
    this.active = false;
    clearInterval(this.timer);
    this.highlight([]);
    $('#tutorial').hidden = true;
    if (finished) {
      try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /* 저장 못 해도 상관없음 */ }
      UI.toast('튜토리얼 완료! 이제 마음껏 그려 보세요.');
    }
  },

  go(i) {
    this.step = i;
    this.advancing = false;
    const st = TUTORIAL_STEPS[i];
    if (st.setup) st.setup.call(st);
    $('#tut-count').textContent = `${i + 1} / ${TUTORIAL_STEPS.length}`;
    $('#tut-title').textContent = st.title;
    $('#tut-text').innerHTML = st.text;
    $('#tut-skip').hidden = !!st.final;
    $('#tut-finish').hidden = !st.final;
    $('#tutorial').hidden = false;
    this.highlight(st.target);
  },

  next() {
    if (this.step < TUTORIAL_STEPS.length - 1) this.go(this.step + 1);
  },

  check() {
    if (!this.active) return;
    // 다른 그림을 열거나 새로 만들면 튜토리얼을 끝낸다
    if (App.sprite !== this.sprite) { this.stop(); return; }
    const st = TUTORIAL_STEPS[this.step];
    if (this.advancing || !st.done || !st.done.call(st)) return;
    this.advancing = true; // 잠깐 보여 주고 넘어간다
    setTimeout(() => { this.advancing = false; if (this.active) this.next(); }, 400);
  },

  highlight(selectors) {
    document.querySelectorAll('.tut-glow').forEach(e => e.classList.remove('tut-glow'));
    for (const sel of selectors) document.querySelector(sel)?.classList.add('tut-glow');
  },
};
