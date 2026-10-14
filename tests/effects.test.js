// node tests/effects.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ Uint8ClampedArray });
for (const name of ['sprite.js', 'effects.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), context);
}
const Effects = vm.runInContext('Effects', context);
const PixelImage = vm.runInContext('PixelImage', context);
const [rgbToHsl, hslToRgb] = vm.runInContext('[rgbToHsl, hslToRgb]', context);

// 외곽선: 가운데 한 칸 → 4방향이면 4칸, 대각선까지면 8칸
const dot = () => { const img = new PixelImage(3, 3); img.set(1, 1, [10, 20, 30, 255]); return img; };
const solidCount = img => { let n = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) n++; return n; };
let img = dot();
Effects.outlineImage(img, [255, 0, 0, 255], false, null);
assert.equal(solidCount(img), 5);
assert.deepEqual([...img.get(1, 0)], [255, 0, 0, 255]);
assert.equal(img.get(0, 0)[3], 0);
assert.deepEqual([...img.get(1, 1)], [10, 20, 30, 255], 'original pixel untouched');
img = dot();
Effects.outlineImage(img, [255, 0, 0, 255], true, null);
assert.equal(solidCount(img), 9);
// 선택 영역 밖은 그대로
img = dot();
const clip = new Uint8Array(9); clip[1] = 1;
Effects.outlineImage(img, [255, 0, 0, 255], false, clip);
assert.equal(solidCount(img), 2);
// 한 번 계산할 때 새로 칠한 칸이 다시 퍼지지 않는다
img = new PixelImage(5, 1); img.set(0, 0, [1, 1, 1, 255]);
Effects.outlineImage(img, [9, 9, 9, 255], false, null);
assert.equal(solidCount(img), 2);

// 색 바꾸기
img = new PixelImage(3, 1);
img.set(0, 0, [100, 100, 100, 255]); img.set(1, 0, [104, 100, 100, 128]); img.set(2, 0, [200, 0, 0, 255]);
Effects.replaceImage(img, [100, 100, 100], [0, 255, 0], 0, null);
assert.deepEqual([...img.get(0, 0)], [0, 255, 0, 255]);
assert.deepEqual([...img.get(1, 0)], [104, 100, 100, 128], 'tolerance 0 = exact only');
Effects.replaceImage(img, [100, 100, 100], [0, 0, 255], 2, null);
assert.deepEqual([...img.get(1, 0)], [0, 0, 255, 128], 'keeps alpha');
assert.deepEqual([...img.get(2, 0)], [200, 0, 0, 255]);

// HSL 변환 왕복
for (const c of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [18, 200, 77], [91, 110, 225]]) {
  assert.deepEqual([...hslToRgb(...rgbToHsl(...c))], c);
}
// 색조 120도: 빨강 → 초록, 밝기 +100 → 흰색, 0이면 그대로
img = new PixelImage(1, 1); img.set(0, 0, [255, 0, 0, 255]);
Effects.adjustImage(img, 120, 0, 0, null, null);
assert.deepEqual([...img.get(0, 0)], [0, 255, 0, 255]);
Effects.adjustImage(img, 0, 0, 100, null, null);
assert.deepEqual([...img.get(0, 0)], [255, 255, 255, 255]);
img.set(0, 0, [91, 110, 225, 255]);
Effects.adjustImage(img, 0, 0, 0, null, null);
assert.deepEqual([...img.get(0, 0)], [91, 110, 225, 255]);
Effects.adjustImage(img, 0, -100, 0, null, c => [1, 2, 3]);
assert.deepEqual([...img.get(0, 0)], [1, 2, 3, 255], 'snap applied');
console.log('PASS: outline (4/8 directions, clip, single pass), replace (tolerance, alpha), hsl round trip, adjust, snap');
