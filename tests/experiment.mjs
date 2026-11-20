import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorld, summarize } from '../experiments/benchmark.mjs';

test('один seed воспроизводит показатели мира, кроме времени', () => {
  const deterministic = { bot: { timeBudgetMs: 1e6 }, emulator: { eventTimeoutMs: 1e9 } };
  const a = runWorld(1013, 80, undefined, deterministic);
  const b = runWorld(1013, 80, undefined, deterministic);
  assert.deepEqual(a, b);
  assert.equal(a.seed, 1013);
  assert.equal(a.invalid, 0);
});

test('сводка корректно считает среднее, медиану и ошибки', () => {
  assert.deepEqual(summarize([{profit: 1, invalid: 0, errors: 0, timeouts: 0}, {profit: 3, invalid: 2, errors: 1, timeouts: 0}]),
    {worlds: 2, meanProfit: 2, medianProfit: 2, invalid: 2, errors: 1, timeouts: 0});
});

test('метрики не меняют результат базового мира и не сохраняют секреты', async () => {
  const { runWorldDetailed } = await import('../experiments/benchmark.mjs');
  const deterministic = { bot: { timeBudgetMs: 1e6 }, emulator: { eventTimeoutMs: 1e9 } };
  const normal = runWorld(1013, 100, undefined, deterministic);
  const detailed = runWorldDetailed(1013, 100, undefined, deterministic);
  for (const [key, value] of Object.entries(normal)) assert.deepEqual(detailed[key], value);
  assert.ok(detailed.metrics.latency.count > 0);
  assert.equal(JSON.stringify(detailed).includes('buyersSecret'), false);
});

test('детальные показатели одного seed повторяются кроме измерений времени', async () => {
  const { runWorldDetailed } = await import('../experiments/benchmark.mjs');
  const deterministic = { bot: { timeBudgetMs: 1e6 }, emulator: { eventTimeoutMs: 1e9 } };
  const a = runWorldDetailed(2026, 100, undefined, deterministic), b = runWorldDetailed(2026, 100, undefined, deterministic);
  delete a.metrics.latency;
  delete b.metrics.latency;
  assert.deepEqual(a, b);
});
