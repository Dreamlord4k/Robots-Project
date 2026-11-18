import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaEmulator } from '../src/engine.mjs';

test('предпочтения покупателей могут совпадать и воспроизводятся по seed', () => {
  const generate = seed => new ArenaEmulator({ seed }).buyers.map(b => b.sample);
  assert.deepEqual(generate(1), generate(1));
  const hasDuplicates = Array.from({ length: 30 }, (_, i) => generate(i + 1)).some(samples =>
    new Set(samples.map(s => `${s.color}:${s.handles}`)).size < samples.length);
  assert.ok(hasDuplicates, 'среди миров должны встречаться одинаковые образцы');
});

test('offer при cooldown возвращает отказ, списывает комиссию и не меняет паузу', () => {
  const em = new ArenaEmulator({ seed: 5, horizon: 0 });
  const robot = { id: 'r1', kind: 'robot', props: { color: 'red', handles: false } };
  em.items.push(robot);
  em.buyers[0].cooldown = 4;
  const events = [];
  const report = em.runFullShift({ handleEvent({ event, t }) {
    events.push({ event, t });
    if (event.type === 'idle') return [{ type: 'offer', itemId: robot.id, buyerId: 'b1', minPrice: 10 }];
    return [];
  } });
  const refusal = events.find(e => e.event.type === 'sale_result');
  assert.ok(refusal, 'бот получает sale_result');
  assert.equal(refusal.t, 0);
  assert.deepEqual(refusal.event, { type: 'sale_result', buyerId: 'b1', itemId: 'r1', item: robot, outcome: 'refused', reason: 'cooldown' });
  assert.equal(report.invalidCommands.length, 0);
  assert.equal(report.offerFees, em.offerFee);
  assert.equal(em.buyers[0].cooldown, 3);
  assert.deepEqual(em.items, [robot]);
});

test('отказ на предложение в ответе на sale_result доставляется в том же такте', () => {
  const em = new ArenaEmulator({ seed: 5, horizon: 0 });
  const robot = { id: 'r1', kind: 'robot', props: { color: 'red', handles: false } };
  em.items.push(robot);
  const events = [];
  const report = em.runFullShift({ handleEvent({ event, t }) {
    events.push({ event, t });
    if (event.type === 'idle') return [{ type: 'offer', itemId: 'r1', buyerId: 'b1', minPrice: 1000 }];
    if (event.type === 'sale_result' && event.reason === 'below_min_price') return [{ type: 'offer', itemId: 'r1', buyerId: 'b1', minPrice: 10 }];
    return [];
  } });
  assert.deepEqual(events.filter(e => e.event.type === 'sale_result').map(e => [e.t, e.event.reason]), [[0, 'below_min_price'], [0, 'cooldown']]);
  assert.equal(report.offerFees, 2 * em.offerFee);
  assert.equal(report.invalidCommands.length, 0);
});
