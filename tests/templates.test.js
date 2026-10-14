// node tests/templates.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ Uint8ClampedArray, Uint32Array });
for (const name of ['sprite.js', 'raster.js', 'templates.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), context);
}
const Templates = vm.runInContext('Templates', context);
const solid = img => { let n = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) n++; return n; };

for (const size of [16, 32, 64]) {
  const idle = Templates.build('idle', size, size);
  assert.equal(idle.frames.length, 4);
  assert.equal(idle.tags.length, 1);
  const run = Templates.build('run', size, size);
  assert.equal(run.frames.length, 6);
  const both = Templates.build('both', size, size);
  assert.equal(both.frames.length, 10);
  assert.equal(JSON.stringify(both.tags.map(t => [t.name, t.from, t.to])), '[["Idle",0,3],["Run",4,9]]');
  for (const s of [idle, run, both]) {
    assert.equal(s.layers.length, 2);
    assert.ok(s.layers[0].reference && s.layers[0].locked);
    for (const l of s.layers) assert.equal(l.cels.length, s.frames.length);
    assert.equal(s.layers[1].cels.filter(c => !c.empty).length, 0); // 그릴 레이어는 비어 있다
    for (const c of s.layers[0].cels) assert.ok(c.image.w === size && !c.empty);
  }
  // 달리기: 프레임마다 실루엣이 달라야 한다
  const sigs = new Set(run.layers[0].cels.map(c => c.image.data.join(',')));
  assert.ok(sigs.size >= 4, `run ${size}: 서로 다른 포즈 ${sigs.size}개`);
}
console.log('templates ok');
