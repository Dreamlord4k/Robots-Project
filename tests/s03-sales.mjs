import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FactoryBot } from '../experiments/s03-bot.mjs';
import { ArenaEmulator } from '../src/engine.mjs';
const start = new ArenaEmulator().getStartPayload();
const robot = (id, color = 'red', handles = false) => ({ id, kind:'robot', props:{ color, handles } });

test('паросочетание не повторяет робота или покупателя и исключает cooldown', () => {
  const bot = new FactoryBot(start);
  const buyers = [...bot.buyers.values()];
  buyers[0].cooldownUntil = 20;
  const pairs = bot.planBestOffers(10, 100, 4, [robot('r1'), robot('r2','blue',true), robot('r3','green')], buyers);
  assert.ok(pairs.length > 0);
  assert.equal(new Set(pairs.map(p=>p.itemId)).size,pairs.length);
  assert.equal(new Set(pairs.map(p=>p.buyerId)).size,pairs.length);
  assert.ok(!pairs.some(p=>p.buyerId===buyers[0].buyerId));
});

test('комиссия может сделать предложение невыгодным', () => {
  const bot = new FactoryBot({ ...start, offerFee: 1000 }, { informationWeight: 0 });
  assert.deepEqual(bot.planBestOffers(0, 100, 4, [robot('r')], [...bot.buyers.values()]), []);
});

test('информационная надбавка отключается и исчезает у конца смены', () => {
  const withInfo = new FactoryBot(start, { informationWeight: 10 });
  const without = new FactoryBot(start, { informationWeight: 0 });
  const a = withInfo.scoreOffer(robot('r'), [...withInfo.buyers.values()][0], 44, 100);
  const b = without.scoreOffer(robot('r'), [...without.buyers.values()][0], 44, 100);
  const end = withInfo.scoreOffer(robot('r'), [...withInfo.buyers.values()][0], 44, 0);
  assert.ok(a.information > 0);
  assert.equal(b.information, 0);
  assert.equal(end.information, 0);
  assert.ok(Math.abs(a.utility - b.utility - a.information) < 1e-10);
});

test('отказ увеличивает ожидаемые расходы хранения и уменьшает доход', () => {
  const bot = new FactoryBot(start, { informationWeight: 0 });
  const buyer = [...bot.buyers.values()][0];
  const low = bot.scoreOffer(robot('r'), buyer, 13, 100);
  const high = bot.scoreOffer(robot('r'), buyer, 75, 100);
  assert.ok(high.saleProbability < low.saleProbability);
  assert.ok(high.waitingCost > low.waitingCost);
});

test('пауза и стоимость хранения снижают оценку предложения', () => {
  const fast = new FactoryBot({ ...start, buyerCooldown: 1, storageFee: { robot: 0 } }, { informationWeight: 0 });
  const slow = new FactoryBot({ ...start, buyerCooldown: 8, storageFee: { robot: 1 } }, { informationWeight: 0 });
  const a = fast.scoreOffer(robot('r'), [...fast.buyers.values()][0], 44, 100);
  const b = slow.scoreOffer(robot('r'), [...slow.buyers.values()][0], 44, 100);
  assert.ok(b.cooldownCost > a.cooldownCost);
  assert.ok(b.waitingCost > a.waitingCost);
  assert.ok(b.utility < a.utility);
});

test('поиск ограничивает число пар даже при большом числе покупателей', () => {
  const bot = new FactoryBot({ ...start, buyers: Array.from({ length: 100 }, (_, i) => `b${i}`) });
  const pairs = bot.planBestOffers(0, 100, 8, Array.from({ length: 10 }, (_, i) => robot(`r${i}`)), [...bot.buyers.values()]);
  assert.ok(pairs.length <= 4);
  assert.equal(new Set(pairs.map(p => p.buyerId)).size, pairs.length);
  assert.equal(new Set(pairs.map(p => p.itemId)).size, pairs.length);
});

test('ошибка report отменяет фиктивную паузу и результат cooldown не обучает', () => {
  const bot = new FactoryBot({ ...start, buyers: ['b1'] });
  const item = robot('r');
  const state = { storage: { capacity: 12, free: 11, items: [item] }, machines: start.machines.map(m=>({id:m.id,busyUntil:null})), buyers:[{id:'b1',cooldownUntil:null}] };
  const first = bot.handleEvent({ seq: 1, t: 5, event: { type: 'idle' }, state, report: [] });
  const index = first.findIndex(c => c.type === 'offer');
  assert.ok(index >= 0);
  const before = structuredClone(bot.buyers.get('b1').hypotheses);
  bot.handleEvent({ seq: 2, t: 5, event: { type:'idle' }, state: {...state, storage:{...state.storage,items:[],free:12}}, report:[{cmd:index,ok:false,reason:'no_such_robot'}] });
  assert.equal(bot.buyers.get('b1').cooldownUntil, 5);
  bot.handleEvent({ seq: 3, t: 6, event: { type:'sale_result',buyerId:'b1',itemId:'r',item,outcome:'refused',reason:'cooldown' }, state: {...state, storage:{...state.storage,items:[],free:12}}, report:[] });
  assert.deepEqual(bot.buyers.get('b1').hypotheses, before);
});
