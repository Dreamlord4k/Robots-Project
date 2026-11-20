import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArenaEmulator } from '../src/engine.mjs';
import { WorldMetrics } from '../experiments/metrics.mjs';

test('считает результаты offer, комиссии, простои и остатки по наблюдениям, не раскрывая секреты боту', () => {
  let clock = 0;
  const metrics = new WorldMetrics();
  const arena = new ArenaEmulator({ seed: 1, horizon: 2, idleEvery: 1, now: () => clock++, observer: metrics });
  arena.items.push({ id: 'r1', kind: 'robot', props: { color: 'red', handles: false } });
  const bot = { handleEvent(payload) {
    assert.equal(payload.state.buyers.some(b => 'sample' in b || 'pMax' in b), false);
    if (payload.t === 0 && payload.event.type === 'idle') return [
      { type: 'offer', buyerId: 'b1', itemId: 'r1', minPrice: 1000 },
      { type: 'offer', buyerId: 'b1', itemId: 'r1', minPrice: 1000 },
      { type: 'offer', buyerId: 'bad', itemId: 'r1', minPrice: 1 }
    ];
    return [];
  }};
  const report = arena.runFullShift(bot);
  const result = metrics.finish(report, arena.items);
  assert.deepEqual(result.offers, { submitted: 3, accepted: 2, invalid: 1, sold: 0, refusedPrice: 1, refusedCooldown: 1, other: 0 });
  assert.equal(report.offerFees, 2);
  assert.equal(report.storageCosts, 1.5);
  assert.equal(report.profit, -3.5);
  assert.equal(result.idleTicks['m-paint'], 3);
  assert.equal(result.idleTicks['m-assemble'], 3);
  assert.equal(result.robotWaitingTicks, 3);
  assert.deepEqual(result.remaining, { robot: 1 });
  assert.equal(result.latency.count, arena.seq);
  assert.equal(result.latency.p95Ms, 1);
  assert.equal(result.latency.maxMs, 1);
  assert.equal(result.preferenceMatches.offers.total, 2);
});

test('при отсутствии секретов постфактум предпочтения недоступны', () => {
  const metrics = new WorldMetrics();
  metrics.onEvent({ event: { type: 'sale_result', buyerId: 'b1', item: { props: { color: 'red', handles: false } }, outcome: 'sold' } }, 2);
  const result = metrics.finish({}, []);
  assert.equal(result.preferenceMatches, null);
  assert.equal(result.learningAccuracy, null);
});

test('точность модели и время первого верного единственного типа определяются только после смены', () => {
  const metrics = new WorldMetrics();
  metrics.onBeliefs(3, [{ id: 'b1', possible: ['red:0', 'blue:1'] }]);
  metrics.onBeliefs(7, [{ id: 'b1', possible: ['red:0'] }]);
  metrics.onBeliefs(9, [{ id: 'b1', possible: ['blue:1'] }]);
  const result = metrics.finish({ buyersSecret: [{ id: 'b1', sample: { color: 'red', handles: false } }] }, []);
  assert.deepEqual(result.learningAccuracy, { evaluated: 1, trueTypePossible: 0, uniqueCorrect: 0, uniqueIncorrect: 1 });
  assert.deepEqual(result.learningTime, { firstCorrectUniqueTicks: [7], neverCorrectUnique: 0 });
});


test('квантили задержки учитывают все события по правилу ближайшего ранга', () => {
  const metrics = new WorldMetrics();
  for (let i = 1; i <= 100; i++) metrics.onEvent({ event: { type: 'idle' } }, i);
  const latency = metrics.finish({}, []).latency;
  assert.deepEqual(latency, { count: 100, meanMs: 50.5, p95Ms: 95, p99Ms: 99, maxMs: 100 });
});
