import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ArenaEmulator } from '../src/engine.mjs';

// Отдельная копия сервера позволяет проверить эксперимент без смены рабочей стратегии.
const dir = await mkdtemp(path.join(tmpdir(), 'robot-s02-'));
await mkdir(path.join(dir, 'src'));
await Promise.all([
  copyFile('src/server.mjs', path.join(dir, 'src/server.mjs')),
  copyFile('src/engine.mjs', path.join(dir, 'src/engine.mjs')),
  copyFile('experiments/s02-bot.mjs', path.join(dir, 'src/bot.mjs'))
]);
const port = 19000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, [path.join(dir, 'src/server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await once(server.stdout, 'data');
  const base = `http://127.0.0.1:${port}`;
  const post = async (url, data) => {
    const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal(res.status, 200);
    return res.json();
  };
  const params = { ...new ArenaEmulator().getStartPayload(), buyers: ['b1'] };
  for (const id of ['a', 'b']) await post(`/v1/runs/${id}/start`, { ...params, runId: id });
  const item = { id: 'r', kind: 'robot', props: { color: 'red', handles: false } };
  const state = { storage: { capacity: 12, free: 11, items: [item] }, machines: params.machines.map(m => ({ id: m.id, busyUntil: null })), buyers: [{ id: 'b1', cooldownUntil: null }] };
  const request = { seq: 1, t: 5, event: { type: 'idle' }, state, report: [] };
  const offered = await post('/v1/runs/a/event', request);
  assert.ok(offered.commands.some(c => c.cmd === 'offer'));
  assert.deepEqual(await post('/v1/runs/a/event', request), offered);
  const result = { seq: 2, t: 5, event: { type: 'sale_result', buyerId: 'b1', itemId: 'r', outcome: 'sold', price: 62 }, state: { ...state, storage: { ...state.storage, items: [], free: 12 } }, report: [] };
  const first = await post('/v1/runs/a/event', result);
  assert.deepEqual(await post('/v1/runs/a/event', result), first);
  const a = await (await fetch(base + '/api/runs/a')).json();
  const b = await (await fetch(base + '/api/runs/b')).json();
  assert.equal(a.buyersBelief[0].salesCount, 1);
  assert.equal(a.buyersBelief[0].hypotheses.length, 1);
  assert.equal(b.buyersBelief[0].salesCount, 0);
  assert.equal(b.buyersBelief[0].hypotheses.length, 6);
  for (const id of ['a', 'b']) await post(`/v1/runs/${id}/finish`, {});
  console.log('Эксперимент S02: HTTP, отсутствие item, повтор seq и изоляция runId — OK');
} finally {
  server.kill();
  await once(server, 'exit');
  await rm(dir, { recursive: true, force: true });
}
