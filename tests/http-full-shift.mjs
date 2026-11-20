// Полная смена через рабочий HTTP-сервер: локальный прогон записывает payload-ы
// и команды, затем те же payload-ы воспроизводятся по HTTP и сравниваются.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ArenaEmulator } from '../src/engine.mjs';
import { FactoryBot } from '../src/bot.mjs';

const port = 19000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['src/server.mjs'], {
  env: { ...process.env, PORT: String(port), ENABLE_DASHBOARD: '0' },
  stdio: ['ignore', 'pipe', 'inherit']
});

try {
  await once(server.stdout, 'data');
  const base = `http://127.0.0.1:${port}`;
  const post = async (url, data) => {
    const response = await fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return { status: response.status, body: await response.json() };
  };

  const em = new ArenaEmulator({ seed: 20261121, horizon: 60 });
  const start = em.getStartPayload();
  const payloads = [];
  const expected = new Map();
  const bot = new FactoryBot(start);
  const handle = bot.handleEvent.bind(bot);
  bot.handleEvent = (payload) => {
    const copy = structuredClone(payload);
    const commands = handle(payload);
    payloads.push(copy);
    expected.set(payload.seq, commands.map(({ type, ...rest }) => ({ cmd: type, ...rest })));
    return commands;
  };
  const report = em.runFullShift(bot);
  assert.equal(report.invalidCommands.length, 0);
  assert.ok(payloads.length > 50, `событий: ${payloads.length}`);

  assert.deepEqual((await post('/v1/runs/http-full/start', start)).body, { ok: true });
  for (const payload of payloads) {
    const response = await post('/v1/runs/http-full/event', payload);
    assert.equal(response.status, 200, `seq ${payload.seq}`);
    assert.deepEqual(response.body.commands, expected.get(payload.seq), `seq ${payload.seq}: команды сервера и локального бота совпадают`);
  }
  assert.deepEqual((await post('/v1/runs/http-full/finish', {})).body, { ok: true });

  const last = payloads[payloads.length - 1];
  const replay = await post('/v1/runs/http-full/event', last);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.commands, expected.get(last.seq), 'повтор seq после finish');
  assert.equal((await post('/v1/runs/http-full/event', { ...last, seq: last.seq + 1 })).status, 409);

  assert.equal((await fetch(base + '/api/runs')).status, 404, 'ENABLE_DASHBOARD=0 отключает /api');
  assert.deepEqual(await (await fetch(base + '/v1/health')).json(), { status: 'ok' });
  console.log(`HTTP-полная смена: ${payloads.length} событий, команды совпали, идемпотентность после finish — OK`);
} finally {
  server.kill();
  await once(server, 'exit');
}
