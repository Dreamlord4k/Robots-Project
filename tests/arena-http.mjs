// Проверка реального HTTP-ответа на события в формате OpenAPI v1.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 19000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['src/server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await once(server.stdout, 'data');
  const base = `http://127.0.0.1:${port}`;
  const send = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const run = '/v1/runs/http-contract';
  const machines = [
    { id: 'm-cut', ops: [{ id: 'cut', inputs: [{ kind: 'sheet' }], output: { kind: 'body', props: { color: null, handles: false } }, duration: 2, cost: 1 }] },
    { id: 'm-handles', ops: [{ id: 'add-handles', inputs: [{ kind: 'body', props: { color: null, handles: false } }], output: { kind: 'body', props: { handles: true } }, inherit: 0, duration: 2, cost: 2 }] },
    { id: 'm-paint', ops: ['red', 'green', 'blue'].map(color => ({ id: `paint-${color}`, inputs: [{ kind: 'body', props: { color: null } }], output: { kind: 'body', props: { color } }, inherit: 0, duration: 3, cost: 2 })) },
    { id: 'm-assemble', ops: [{ id: 'assemble', inputs: [{ kind: 'body', props: { color: '*' } }, { kind: 'control' }], output: { kind: 'robot', props: {} }, inherit: 0, duration: 3, cost: 3 }] }
  ];
  const start = { runId: 'http-contract', mode: 'practice', horizon: 600, eventTimeoutMs: 2000, capacity: 12, storageFee: {}, offerFee: 1, buyerCooldown: 8, priceCeiling: 100, buyers: ['b1', 'b2'], attributes: { color: ['red', 'green', 'blue'], handles: [true, false] }, machines };
  assert.deepEqual(await send(run + '/start', start), { ok: true });
  const snapshot = (items, buyers = [{ id: 'b1', cooldownUntil: null }, { id: 'b2', cooldownUntil: null }], free = 12 - items.length) => ({ cash: 0, storage: { capacity: 12, free, items }, machines: machines.map(m => ({ id: m.id, busyUntil: null })), buyers });
  const event = (seq, t, ev, state) => send(run + '/event', { seq, t, event: ev, state, report: [] });
  const sheet = { id: 's1', kind: 'sheet', props: {} };
  const first = await event(1, 1, { type: 'supply', item: sheet, price: 4 }, snapshot([]));
  assert.deepEqual(first.commands.map(c => c.cmd), ['accept', 'start']);
  assert.ok(first.commands.every(c => !('type' in c)));
  assert.deepEqual(await event(1, 1, { type: 'supply', item: sheet, price: 4 }, snapshot([])), first);
  const raw = { id: 'body1', kind: 'body', props: { color: null, handles: false } };
  const painted = await event(2, 3, { type: 'machine_done', machineId: 'm-cut', opId: 'cut', item: raw }, snapshot([raw]));
  const paint = painted.commands.find(c => c.machineId === 'm-paint');
  assert.ok(paint && /^paint-(red|green|blue)$/.test(paint.opId), 'покраска использует opId из start');
  const color = paint.opId.slice(6);
  const body = { id: 'body2', kind: 'body', props: { color, handles: false } };
  const control = { id: 'c1', kind: 'control', props: {} };
  const assembly = await event(3, 6, { type: 'machine_done', machineId: 'm-paint', opId: paint.opId, item: body }, snapshot([body, control]));
  assert.ok(!assembly.commands.some(c => c.machineId === 'm-handles'), 'окрашенный корпус не идёт на ручки');
  assert.deepEqual(assembly.commands.find(c => c.machineId === 'm-assemble')?.itemIds, ['body2', 'c1']);
  const robot = { id: 'r1', kind: 'robot', props: { color, handles: false } };
  const sale = await event(4, 9, { type: 'machine_done', machineId: 'm-assemble', opId: 'assemble', item: robot }, snapshot([robot], [{ id: 'b1', cooldownUntil: 20 }, { id: 'b2', cooldownUntil: null }]));
  const offer = sale.commands.find(c => c.cmd === 'offer');
  assert.ok(offer && offer.buyerId === 'b2', 'offer свободному покупателю');
  const blocked = await event(5, 10, { type: 'supply', item: { id: 's2', kind: 'sheet', props: {} }, price: 4 }, snapshot([], undefined, 0));
  assert.ok(!blocked.commands.some(c => c.cmd === 'accept'), 'полный склад');
  assert.deepEqual(await send(run + '/finish', {}), { ok: true });
  console.log('HTTP-контракт: поставка, производство, продажа, cooldown и повтор seq — OK');
} finally {
  server.kill();
}
