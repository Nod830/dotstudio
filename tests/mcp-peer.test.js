// node tests/mcp-peer.test.js
// AI 도구 두 개(MCP 서버 두 개)를 같이 켜도 같은 브라우저를 함께 쓰는지, 먼저 켠 쪽이 꺼지면 이어받는지 확인한다.
// 브라우저는 가짜로 흉내 낸다. 실제 5174 포트 대신 5199를 쓴다.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const PORT = 5199;
const SERVER = path.join(__dirname, '../mcp/server.js');
const env = { ...process.env, DOTSTUDIO_MCP_PORT: String(PORT) };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client() {
  const p = spawn(process.execPath, [SERVER], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', id = 0;
  const waits = new Map();
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      waits.get(msg.id)?.(msg);
    }
  });
  const call = (name, args = {}) => new Promise(resolve => {
    const n = ++id; waits.set(n, resolve);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
  return { p, call, text: r => r.result.content[0].text };
}

// 가짜 브라우저: 명령을 받아 "<이름> 완료"라고 답한다
let stop = false;
(async () => {
  while (!stop) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/mcp/poll`);
      if (r.status !== 200) continue;
      const cmd = await r.json();
      await fetch(`http://127.0.0.1:${PORT}/mcp/result`, { method: 'POST', body: JSON.stringify({ id: cmd.id, ok: true, text: cmd.name + ' 완료' }) });
    } catch { await sleep(200); }
  }
})();

(async () => {
  const a = client();
  await sleep(500);
  const b = client();
  await sleep(500);
  assert.equal(a.text(await a.call('get_state')), 'get_state 완료');   // hub
  assert.equal(b.text(await b.call('get_state')), 'get_state 완료');   // peer: hub를 거쳐서
  assert.equal(b.text(await b.call('clear')), 'clear 완료');
  a.p.kill();                                                          // 먼저 켠 쪽이 꺼져도
  await sleep(500);
  assert.equal(b.text(await b.call('get_state')), 'get_state 완료');   // 남은 쪽이 이어받는다
  const c = client();                                                  // 새로 켠 쪽은 이어받은 서버에 붙는다
  await sleep(500);
  assert.equal(c.text(await c.call('get_state')), 'get_state 완료');
  stop = true;
  b.p.kill(); c.p.kill();
  console.log('PASS: hub, peer, failover');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
