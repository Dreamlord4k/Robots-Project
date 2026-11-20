import test from 'node:test';
import assert from 'node:assert/strict';
import { FactoryBot } from '../src/bot.mjs';

const ROBOT = { id: 'r1', kind: 'robot', props: { color: 'red', handles: false } };

function makeBot() {
  return new FactoryBot({
    horizon: 600,
    capacity: 12,
    priceCeiling: 100,
    offerFee: 1,
    buyerCooldown: 8,
    buyers: ['b1']
  });
}

function state(items, cooldownUntil = null) {
  return {
    storage: { capacity: 12, free: 12 - items.length, items },
    machines: [],
    buyers: [{ id: 'b1', cooldownUntil }]
  };
}

function idleEvent(t, items, cooldownUntil = null, seq = 1) {
  return { seq, t, event: { type: 'idle' }, state: state(items, cooldownUntil), report: [] };
}

function offerOf(bot, t, items, cooldownUntil = null, seq = 1) {
  const commands = bot.handleEvent(idleEvent(t, items, cooldownUntil, seq));
  return commands.find(command => command.type === 'offer');
}

function exactHypothesis(bot) {
  return bot.buyers.get('b1').hypotheses.find(h => h.color === 'red' && h.handles === false);
}

test('Ф1: отказ на нижней границе закрывает гипотезу точного совпадения', () => {
  const bot = makeBot();
  const offer = offerOf(bot, 10, [ROBOT]);
  assert.ok(offer, 'должен быть оффер');
  assert.equal(offer.minPrice, 44.1);

  bot.handleEvent({
    seq: 2,
    t: 10,
    event: {
      type: 'sale_result',
      buyerId: 'b1',
      itemId: ROBOT.id,
      item: ROBOT,
      outcome: 'refused',
      reason: 'below_min_price'
    },
    state: state([ROBOT], 18),
    report: []
  });

  assert.equal(exactHypothesis(bot).possible, false, 'отказ при 44,1 доказывает, что точного совпадения нет');
});

test('Ф1: после такого отказа пара не опрашивается повторно', () => {
  const bot = makeBot();
  offerOf(bot, 10, [ROBOT]);
  bot.handleEvent({
    seq: 2,
    t: 10,
    event: { type: 'sale_result', buyerId: 'b1', itemId: ROBOT.id, item: ROBOT, outcome: 'refused', reason: 'below_min_price' },
    state: state([ROBOT], 18),
    report: []
  });
  const again = offerOf(bot, 19, [ROBOT], null, 3);
  assert.equal(again, undefined, 'повторный оффер той же паре не нужен');
});

test('Ф1: продажа по-прежнему сужает интервал и оставляет гипотезу возможной', () => {
  const bot = makeBot();
  const offer = offerOf(bot, 10, [ROBOT]);
  assert.ok(offer);
  bot.handleEvent({
    seq: 2,
    t: 10,
    event: { type: 'sale_result', buyerId: 'b1', itemId: ROBOT.id, item: ROBOT, outcome: 'sold', price: 62 },
    state: state([], 18),
    report: []
  });
  const hit = exactHypothesis(bot);
  assert.equal(hit.possible, true);
  assert.ok(hit.pMaxLo >= 62 / 1.02 - 0.01, `pMaxLo=${hit.pMaxLo}`);
  assert.ok(hit.pMaxHi <= 62 / 0.98 + 0.01, `pMaxHi=${hit.pMaxHi}`);
  for (const hypothesis of bot.buyers.get('b1').hypotheses) {
    const distance = (hypothesis.color !== 'red' ? 1 : 0) + (Boolean(hypothesis.handles) !== false ? 1 : 0);
    if (distance === 2) assert.equal(hypothesis.possible, false, 'две несовпадающие гипотезы закрываются продажей');
  }
});

test('Ф1: отказ по cooldown не является ценовым наблюдением', () => {
  const bot = makeBot();
  offerOf(bot, 10, [ROBOT]);
  const before = bot.buyers.get('b1').hypotheses.filter(h => h.possible).length;
  bot.handleEvent({
    seq: 2,
    t: 10,
    event: { type: 'sale_result', buyerId: 'b1', itemId: ROBOT.id, item: ROBOT, outcome: 'refused', reason: 'cooldown' },
    state: state([ROBOT], 18),
    report: []
  });
  const after = bot.buyers.get('b1').hypotheses.filter(h => h.possible).length;
  assert.equal(after, before, 'cooldown не должен сужать модель');
});

test('Ф1: отказ без известного minPrice не ломает модель', () => {
  const bot = makeBot();
  const before = bot.buyers.get('b1').hypotheses.filter(h => h.possible).length;
  bot.handleEvent({
    seq: 2,
    t: 10,
    event: { type: 'sale_result', buyerId: 'b1', itemId: 'unknown', item: ROBOT, outcome: 'refused', reason: 'below_min_price' },
    state: state([ROBOT], 18),
    report: []
  });
  const after = bot.buyers.get('b1').hypotheses.filter(h => h.possible).length;
  assert.equal(after, before);
});
