import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FactoryBot } from '../experiments/s02-bot.mjs';
import { ArenaEmulator } from '../src/engine.mjs';
const start = new ArenaEmulator().getStartPayload();
const robot = { id: 'r', kind: 'robot', props: { color: 'red', handles: false } };
const state = (items = [], cooldownUntil = null) => ({ storage: { capacity: 12, free: 12-items.length, items }, machines: start.machines.map(m => ({ id: m.id, busyUntil: null })), buyers: [{ id: 'b1', cooldownUntil }] });
const event = (seq, t, event, items = [], report = [], cooldown = null) => ({ seq, t, event, state: state(items, cooldown), report });
const newBot = (params = {}) => new FactoryBot({ ...start, buyers: ['b1'], ...params });
const model = bot => bot.buyers.get('b1');
const hyp = (bot, key) => model(bot).hypotheses.find(h => h.key === key);

test('пересечение уровней и округление не исключают допустимые гипотезы', () => {
  const bot = newBot();
  model(bot).updateOnSaleResult(robot, 'sold', 45, undefined);
  assert.equal(hyp(bot, 'red:0').possible, true);
  assert.equal(hyp(bot, 'red:1').possible, true);
  const upper = newBot();
  model(upper).updateOnSaleResult(robot, 'sold', 45.90);
  assert.equal(hyp(upper, 'red:0').possible, true);
  assert.equal(hyp(upper, 'red:1').possible, true);
  const boundary = newBot();
  model(boundary).updateOnSaleResult(robot, 'sold', 44.10, undefined);
  assert.equal(hyp(boundary, 'red:0').possible, true);
  const rounded = newBot();
  model(rounded).updateOnSaleResult(robot, 'sold', 44.095, undefined);
  assert.equal(hyp(rounded, 'red:0').possible, true);
});

test('sale_result без item использует сохранённый товар текущего offer', () => {
  const bot = newBot();
  const offered = bot.handleEvent(event(1, 5, { type: 'idle' }, [robot]));
  assert.ok(offered.some(c => c.type === 'offer'));
  bot.handleEvent(event(2, 5, { type: 'sale_result', buyerId: 'b1', itemId: 'r', outcome: 'sold', price: 62 }));
  assert.equal(hyp(bot, 'blue:1').possible, false);
  assert.ok(hyp(bot, 'red:0').pMaxLo > 60);
});

test('отказ без известного порога и отказ cooldown не меняют гипотезы', () => {
  const bot = newBot();
  const before = structuredClone(model(bot).hypotheses);
  bot.handleEvent(event(1, 10, { type: 'sale_result', buyerId: 'b1', itemId: 'x', item: robot, outcome: 'refused', reason: 'below_min_price' }));
  assert.deepEqual(model(bot).hypotheses, before);
  model(bot).cooldownUntil = 12;
  bot.handleEvent(event(2, 11, { type: 'sale_result', buyerId: 'b1', itemId: 'x', item: robot, outcome: 'refused', reason: 'cooldown' }, [], [], 12));
  assert.deepEqual(model(bot).hypotheses, before);
  assert.equal(model(bot).cooldownUntil, 12);
});

test('противоречащее наблюдение не уничтожает уже подтверждённую модель', () => {
  const bot = newBot();
  model(bot).updateOnSaleResult(robot, 'sold', 62);
  const before = structuredClone(model(bot).hypotheses);
  model(bot).updateOnSaleResult(robot, 'sold', 1000);
  assert.deepEqual(model(bot).hypotheses, before);
});

test('низкий priceCeiling не делает оценку выше возможной цены', () => {
  const bot = newBot({ priceCeiling: 30 });
  const estimate = model(bot).evaluateRobot(robot.props);
  assert.ok(estimate.expectedPrice <= 30);
  assert.ok(estimate.min2MatchPrice <= 30);
});

test('повтор seq не повторяет обучение и другой прогон не наследует его', () => {
  const a = newBot(), b = newBot();
  const msg = event(1, 5, { type: 'sale_result', buyerId: 'b1', itemId: 'r', item: robot, outcome: 'sold', price: 62 });
  const first = a.handleEvent(msg);
  const learned = structuredClone(model(a).hypotheses);
  assert.deepEqual(a.handleEvent(msg), first);
  assert.deepEqual(model(a).hypotheses, learned);
  assert.ok(model(b).hypotheses.every(h => h.possible));
});

test('отклонённый report удаляет сведения о предложении', () => {
  const bot = newBot();
  const commands = bot.handleEvent(event(1, 5, { type: 'idle' }, [robot]));
  const idx = commands.findIndex(c => c.type === 'offer');
  assert.ok(idx >= 0);
  bot.handleEvent(event(2, 5, { type: 'idle' }, [], [{ cmd: idx, ok: false, reason: 'no_such_robot' }]));
  const before = structuredClone(model(bot).hypotheses);
  bot.handleEvent(event(3, 6, { type: 'sale_result', buyerId: 'b1', itemId: 'r', outcome: 'sold', price: 62 }));
  assert.deepEqual(model(bot).hypotheses, before);
});

test('отказ по известному minPrice сужает границу, не устанавливая точную цену', () => {
  const bot = newBot();
  const commands = bot.handleEvent(event(1, 5, { type: 'idle' }, [robot]));
  const offer = commands.find(c => c.type === 'offer');
  assert.ok(offer);
  bot.handleEvent(event(2, 5, { type: 'sale_result', buyerId: 'b1', itemId: 'r', outcome: 'refused', reason: 'below_min_price' }, [robot]));
  const h = hyp(bot, 'red:0');
  assert.ok(h.possible);
  assert.ok(h.pMaxHi <= (offer.minPrice + 0.005) / 0.98 + 1e-8);
  assert.ok(h.pMaxLo < h.pMaxHi);
});

test('при низком потолке априорный диапазон не стягивается в одну точку', () => {
  const bot = newBot({ priceCeiling: 30 });
  assert.ok(hyp(bot, 'red:0').pMaxLo < hyp(bot, 'red:0').pMaxHi);
  const offer = bot.handleEvent(event(1, 5, { type: 'idle' }, [robot])).find(c => c.type === 'offer');
  if (offer) assert.ok(offer.minPrice <= 30);
});

test('продажа за ноль не исключает тип с двумя несовпадениями', () => {
  const bot = newBot();
  model(bot).updateOnSaleResult(robot, 'sold', 0);
  assert.equal(hyp(bot, 'blue:1').possible, true);
  assert.equal(hyp(bot, 'red:0').possible, false);
});

test('нулевой потолок ограничивает все ценовые оценки', () => {
  const evaluated = model(newBot({ priceCeiling: 0 })).evaluateRobot(robot.props);
  assert.equal(evaluated.expectedPrice, 0);
  assert.equal(evaluated.expected2MatchPrice, 0);
  assert.equal(evaluated.expected1MatchPrice, 0);
});
