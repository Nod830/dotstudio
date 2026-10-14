// node tests/sheet-import.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ Uint8ClampedArray });
for (const name of ['sprite.js', 'sheet-import.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), context);
}
const importer = vm.runInContext('SheetImporter', context);
const options = { w: 2, h: 2, x: 0, y: 0, gapX: 0, gapY: 0, duration: 120, order: 'rows', count: null };
const pixels = new Uint8ClampedArray(4 * 4 * 4);
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
  const cell = Math.floor(y / 2) * 2 + Math.floor(x / 2);
  pixels.set([cell * 60, x, y, cell === 3 ? 0 : 128], (y * 4 + x) * 4);
}
const source = {
  width: 4, height: 4,
  getContext: () => ({ getImageData: (x, y, w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      data.set(pixels.subarray(((y + row) * 4 + x) * 4, ((y + row) * 4 + x + w) * 4), row * w * 4);
    }
    return { data };
  } }),
};
const redValues = s => Array.from(s.layers[0].cels, c => c.image.data[0]);
const rowSprite = importer.split(source, options);
assert.deepEqual(redValues(rowSprite), [0, 60, 120, 180]);
assert.equal(rowSprite.width, 2);
assert.equal(rowSprite.height, 2);
assert.ok(rowSprite.frames.every(f => f.duration === 120));
assert.equal(rowSprite.layers[0].cels[0].image.data[3], 128);
assert.ok(rowSprite.layers[0].cels[3].empty, 'Transparent frames must be preserved');
rowSprite.layers[0].cels[0].image.data[0] = 255;
assert.equal(pixels[0], 0, 'Editing a frame must not mutate the sheet');
assert.deepEqual(redValues(importer.split(source, { ...options, order: 'columns' })), [0, 120, 60, 180]);
assert.deepEqual(redValues(importer.split(source, { ...options, count: 3 })), [0, 60, 120]);
const grid = importer.layout(9, 8, { ...options, x: 1, y: 2, gapX: 1, gapY: 2 });
assert.deepEqual(JSON.parse(JSON.stringify(grid.cells)), [
  { x: 1, y: 2 }, { x: 4, y: 2 }, { x: 7, y: 2 },
  { x: 1, y: 6 }, { x: 4, y: 6 }, { x: 7, y: 6 },
]);
assert.equal(grid.remainderX, 0);
assert.equal(grid.remainderY, 0);
assert.equal(importer.layout(5, 5, options).remainderX, 1);
assert.equal(importer.layout(5, 5, options).cells.length, 4);
assert.equal(importer.layout(4, 2, options).cells.length, 2);
assert.equal(importer.layout(2, 4, options).cells.length, 2);
for (const invalid of [{ w: 0 }, { h: 1.5 }, { w: NaN }, { x: -1 }, { gapX: Infinity },
  { duration: 0 }, { duration: 65536 }, { count: 0 }, { count: 5 }, { order: 'bad' }, { x: 5 }]) {
  assert.throws(() => importer.layout(4, 4, { ...options, ...invalid }));
}
assert.throws(() => importer.layout(4096, 4096, options), /1024/);
assert.equal(importer.layout(4096, 4096, { ...options, count: 1024 }).cells.length, 1024);
// JSON (Aseprite array/hash 형식, 잘린 프레임 복원, 태그)
const json = importer.parseJson(JSON.stringify({
  frames: {
    'a 0': { frame: { x: 2, y: 0, w: 2, h: 2 }, duration: 50 },
    'a 1': { frame: { x: 0, y: 2, w: 1, h: 1 }, trimmed: true, spriteSourceSize: { x: 1, y: 1, w: 1, h: 1 }, sourceSize: { w: 2, h: 2 }, duration: 70 },
  },
  meta: { frameTags: [{ name: 'Run', from: 0, to: 1, direction: 'pingpong_reverse', color: '#ff0000ff' }, { name: 'Bad', from: 1, to: 9 }] },
}));
assert.equal(json.frames.length, 2);
assert.deepEqual([json.w, json.h], [2, 2]);
assert.deepEqual(JSON.parse(JSON.stringify(json.tags)), [{ name: 'Run', from: 0, to: 1, direction: 'pingpong', color: '#ff0000' }]);
const jsonSprite = importer.split(source, options, json);
assert.deepEqual([...jsonSprite.frames.map(f => f.duration)], [50, 70]);
assert.equal(jsonSprite.layers[0].cels[0].image.data[0], 60, 'frame 0 comes from x=2 (cell 1)');
const trimmed = jsonSprite.layers[0].cels[1].image;
assert.equal(trimmed.get(0, 0)[3], 0, 'trimmed frame keeps empty area');
assert.equal(trimmed.get(1, 1)[0], 120, 'trimmed pixel restored at spriteSourceSize offset');
assert.equal(jsonSprite.tags[0].name, 'Run');
assert.throws(() => importer.parseJson('{}'), /frames/);
assert.throws(() => importer.parseJson('nope'), /JSON/);
assert.throws(() => importer.split(source, options, importer.parseJson(JSON.stringify({ frames: [{ frame: { x: 3, y: 0, w: 2, h: 2 } }] }))), /밖/);
// 가운데 맞추기
const small = new (vm.runInContext('PixelImage', context))(2, 2);
small.set(0, 0, [9, 9, 9, 255]);
const fitted = importer.fit(small, 4, 4);
assert.equal(fitted.get(1, 1)[0], 9);
assert.equal(importer.fit(small, 2, 2), small);
console.log('PASS: frame pixels, transparency, order, duration, gaps, remainder, limits, invalid inputs, JSON, fit');
