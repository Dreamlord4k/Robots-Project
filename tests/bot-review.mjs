import test from 'node:test';
import assert from 'node:assert/strict';
import { FactoryBot } from '../src/bot.mjs';
import { ArenaEmulator } from '../src/engine.mjs';

const start = new ArenaEmulator().getStartPayload();
const snapshot = (items, buyers = [{ id: 'b1', cooldownUntil: null }]) => ({ storage: { capacity: 12, free: 12 - items.length, items }, machines: start.machines.map(m => ({ id: m.id, busyUntil: null })), buyers });
test('не запускает недоступные станки при пустой или неполной конфигурации', () => {
  for (const machines of [[], start.machines.filter(m => m.id !== 'm-cut'), start.machines.map(m => m.id === 'm-paint' ? { ...m, ops: [] } : m)]) {
    const bot = new FactoryBot({ ...start, machines });
    const result = bot.handleEvent({ seq: 1, t: 1, event: { type: 'supply', item: { id: 's1', kind: 'sheet', props: {} }, price: 4 }, state: snapshot([]), report: [] });
    assert.ok(!result.some(c => c.type === 'start'), 'не запускать неподтверждённую производственную цепочку');
  }
});
test('ошибка offer из report освобождает покупателя для следующего решения', () => {
  const bot = new FactoryBot({ ...start, buyers: ['b1'] });
  const robot = { id: 'r', kind: 'robot', props: { color: 'red', handles: false } };
  const first = bot.handleEvent({ seq: 1, t: 10, event: { type: 'idle' }, state: snapshot([robot]), report: [] });
  const offerIndex = first.findIndex(c => c.type === 'offer');
  assert.ok(offerIndex >= 0);
  assert.equal(bot.buyers.get('b1').cooldownUntil, 18);
  bot.handleEvent({ seq: 2, t: 10, event: { type: 'idle' }, state: snapshot([]), report: [{ cmd: offerIndex, ok: false, reason: 'no_such_robot' }] });
  assert.equal(bot.buyers.get('b1').cooldownUntil, 10);
  assert.equal(bot.lastOfferMinPrice.size, 0);
});
