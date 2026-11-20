// tests/test.mjs — юнит-тесты планировщика и обучения цен + интеграционный прогон эмулятора.
// Запуск: node tests/test.mjs
import assert from 'node:assert/strict';
import { createBot, createNaiveBot } from '../src/bot.mjs';
import { makeWorld, Sim } from './harness.mjs';

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    console.log('  ✗ ' + name + '\n      ' + (e && e.message ? e.message : e));
  }
}

const cfg = makeWorld(3).config;
const archKey = (color, handles) => `${color}:${handles ? 1 : 0}`;

// Плоский state — именно такой формат читает FactoryBot (state.items, state.machines, state.buyers)
const baseState = (items = [], buyers = null) => ({
  t: 0,
  money: 0,
  items,
  machines: cfg.machines.map((m) => ({ id: m.id, busy: false, busyUntil: 0, currentOp: null })),
  buyers: buyers || cfg.buyers.map((id) => ({ id, cooldown: 0 })),
});
const body = (seq, t, event, state) => ({ seq, t, event, state, report: [] });
const robotItem = (id, color, handles) => ({ id, kind: 'robot', props: { color, handles } });

// Бот-оракул: подсматриваем секретные параметры покупателей из движка и
// прошиваем их в интервальную модель как единственно возможные гипотезы
function createOracleBot(config, secrets) {
  const bot = createBot(config);
  if (Array.isArray(secrets)) {
    for (const s of secrets) {
      const bel = bot.buyers.get(s.id);
      if (bel) {
        bel.hypotheses = [{
          key: archKey(s.sample.color, s.sample.handles),
          color: s.sample.color,
          handles: Boolean(s.sample.handles),
          possible: true,
          pMaxLo: s.pMax * 0.98,
          pMaxHi: s.pMax * 1.02,
          fLo: Math.max(0.001, s.f * 0.98),
          fHi: s.f * 1.02,
        }];
      }
    }
  }
  return bot;
}

console.log('\n— обучение цен (интервальная модель) —');
test('продажа сужает интервал pMax у совпавшего архетипа и закрывает дальние', () => {
  const bot = createBot(makeWorld(1).config);
  bot.handle(body(1, 10, { type: 'sale_result', buyerId: 'b1', itemId: 'x',
    item: robotItem('x', 'green', true), outcome: 'sold', price: 62 }, baseState()));
  const bel = bot.belief().get('b1');
  const hit = bel.hypotheses.find((h) => h.key === 'green:1');
  assert.ok(hit.pMaxLo >= 62 / 1.02 - 0.01, 'pMaxLo вырос: ' + hit.pMaxLo);
  assert.ok(hit.pMaxHi <= 62 / 0.98 + 0.01, 'pMaxHi сужен: ' + hit.pMaxHi);
  const far = bel.hypotheses.find((h) => h.key === 'blue:0');
  assert.equal(far.possible, false, '0 совпадений закрывает гипотезу');
});
test('отказ по below_min_price сужает pMaxHi сверху', () => {
  const bot = createBot({ ...makeWorld(2).config, buyers: ['b2'] });
  const item = robotItem('y', 'blue', false);
  const offered = bot.handle(body(1, 2, { type: 'idle' }, baseState([item])));
  assert.ok(offered.commands.some(c => c.cmd === 'offer' && c.buyerId === 'b2'));
  bot.handle(body(2, 10, { type: 'sale_result', buyerId: 'b2', itemId: 'y',
    item, outcome: 'refused', reason: 'below_min_price' }, baseState()));
  const h = bot.belief().get('b2').hypotheses.find((h) => h.key === 'blue:0');
  assert.ok(h.pMaxHi < 75, 'pMaxHi сужен: ' + h.pMaxHi);
});

console.log('\n— планировщик —');
test('accept и запуск резки в одном ответе', () => {
  const bot = createBot(cfg);
  const res = bot.handle(body(1, 5, { type: 'supply', item: { id: 's1', kind: 'sheet', props: {} }, price: 4 }, baseState()));
  assert.ok(res.commands.some((c) => c.cmd === 'accept' && c.itemId === 's1'), 'приняли лист');
  const start = res.commands.find((c) => c.cmd === 'start');
  assert.ok(start, 'запустили станок');
  assert.equal(start.machineId, 'm-cut');
  assert.deepEqual(start.itemIds, ['s1']);
});
test('при свободном месте 1 поставка не принимается', () => {
  const bot = createBot(cfg);
  const items = Array.from({ length: 11 }, (_, i) => ({ id: 'z' + i, kind: 'body', props: { color: null, handles: false } }));
  const res = bot.handle(body(1, 5, { type: 'supply', item: { id: 's1', kind: 'sheet', props: {} }, price: 4 }, baseState(items)));
  assert.ok(!res.commands.some((c) => c.cmd === 'accept'), 'не приняли');
});
test('сборка идёт только с окрашенного корпуса и контроллера, body первым', () => {
  const bot = createBot(cfg);
  const items = [
    { id: 'c1', kind: 'control', props: {} },
    { id: 'b1', kind: 'body', props: { color: 'red', handles: true } },
  ];
  const res = bot.handle(body(1, 30, { type: 'idle' }, baseState(items)));
  const start = res.commands.find((c) => c.cmd === 'start' && c.machineId === 'm-assemble');
  assert.ok(start, 'сборка запущена');
  assert.deepEqual(start.itemIds, ['b1', 'c1'], 'сначала body, потом control');
});
test('бесцветный корпус не уходит в сборку', () => {
  const bot = createBot(cfg);
  const items = [
    { id: 'c1', kind: 'control', props: {} },
    { id: 'b1', kind: 'body', props: { color: null, handles: false } },
  ];
  const res = bot.handle(body(1, 30, { type: 'idle' }, baseState(items)));
  assert.ok(!res.commands.some((c) => c.machineId === 'm-assemble'), 'сборки нет');
});
test('робот предлагается только свободному покупателю и с minPrice > 0', () => {
  const bot = createBot(cfg);
  const items = [robotItem('r1', 'red', false)];
  const state = baseState(items);
  state.buyers = state.buyers.map((b) => ({ ...b, cooldown: b.id === 'b1' ? 99 : 0 }));
  const res = bot.handle(body(1, 100, { type: 'machine_done', machineId: 'm-assemble', opId: 'assemble', item: items[0] }, state));
  const offer = res.commands.find((c) => c.cmd === 'offer');
  assert.ok(offer, 'offer есть');
  assert.notEqual(offer.buyerId, 'b1', 'не предлагаем тому, у кого пауза');
  assert.ok(offer.minPrice > 0, 'minPrice отсекает нулевую ступень');
});
test('на горизонте нет accept и запуска станков', () => {
  const bot = createBot(cfg);
  const items = [{ id: 's1', kind: 'sheet', props: {} }];
  const res = bot.handle(body(1, cfg.horizon, { type: 'supply', item: { id: 's2', kind: 'sheet', props: {} }, price: 4 }, baseState(items)));
  assert.ok(!res.commands.some((c) => c.cmd === 'accept'), 'accept на горизонте нет');
  assert.ok(!res.commands.some((c) => c.cmd === 'start'), 'запусков станков нет');
});
test('идемпотентность по seq', () => {
  const bot = createBot(cfg);
  const b = body(7, 5, { type: 'supply', item: { id: 's1', kind: 'sheet', props: {} }, price: 4 }, baseState());
  const r1 = bot.handle(b);
  const r2 = bot.handle(b);
  assert.deepEqual(r1, r2);
});
test('устойчивость к кривому входу', () => {
  const bot = createBot(cfg);
  for (const b of [null, undefined, {}, { seq: 'x' }, { seq: 1, event: 42, state: 'q' }, { seq: 2, event: { type: 'supply' }, state: { storage: null } }]) {
    const r = bot.handle(b);
    assert.ok(r && Array.isArray(r.commands), 'вернулся корректный ответ');
  }
});

console.log('\n— эмулятор —');
test('один мир: нет недопустимых команд, ответ быстрый', () => {
  const world = makeWorld(1);
  const sim = new Sim(world, createBot(world.config), { series: false });
  const res = sim.run();
  assert.equal(res.stats.invalid, 0, 'недопустимых команд нет: ' + res.stats.invalid);
  assert.ok(res.maxLatency < 50, 'худший ответ ' + res.maxLatency + ' мс');
  assert.ok(res.stats.sales > 20, 'продаж: ' + res.stats.sales);
  assert.ok(res.profit > 0, 'прибыль ' + res.profit);
});
test('наивная стратегия тоже валидна', () => {
  const world = makeWorld(1);
  const sim = new Sim(world, createNaiveBot(world.config), { series: false });
  const res = sim.run();
  assert.equal(res.stats.invalid, 0);
  assert.ok(res.stats.sales > 20);
});

console.log('\n— бенчмарк (5 миров) —');
function bench(make, seeds) {
  const profits = [];
  let invalid = 0;
  for (let i = 1; i <= seeds; i++) {
    const world = makeWorld(i);
    const sim = new Sim(world, make(world), { series: false });
    const r = sim.run();
    profits.push(r.profit);
    invalid += r.stats.invalid;
  }
  const mean = profits.reduce((a, b) => a + b, 0) / profits.length;
  return { mean, invalid, profits };
}
const l1 = bench((w) => createNaiveBot(w.config), 5);
const l3 = bench((w) => createBot(w.config), 5);
const or = bench((w) => createOracleBot(w.config, w.buyers), 5);
console.log(`      уровень 1 (наивная): ${l1.mean.toFixed(0)}  ${JSON.stringify(l1.profits)}`);
console.log(`      уровень 3 (наша):    ${l3.mean.toFixed(0)}  ${JSON.stringify(l3.profits)}`);
console.log(`      оракул:              ${or.mean.toFixed(0)}  ${JSON.stringify(or.profits)}`);
if (l3.mean <= l1.mean) console.log('      ВНИМАНИЕ: наша стратегия не обогнала наивную — смотрите журнал report.');

test('уровень 3 прибыльнее 1000 на 5 мирах и не ломает правила', () => {
  assert.ok(l3.mean > 1000, 'средняя прибыль ' + l3.mean.toFixed(0));
  assert.equal(l3.invalid, 0, 'недопустимых команд: ' + l3.invalid);
});

console.log(`\nИтог: ${pass} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
