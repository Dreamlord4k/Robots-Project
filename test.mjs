// test.mjs — юнит-тесты планировщика и обучения цен + интеграционный прогон эмулятора.
//   node test.mjs
import assert from 'node:assert/strict';
import { createBot, createNaiveBot, parseWorld, newBelief, estPrice, keyOf, mismatches } from './bot.mjs';
import { makeWorld, Sim } from './engine.mjs';

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
const baseState = (items = [], free = null, machines = null) => ({
  cash: 0,
  storage: {
    capacity: 12,
    free: free == null ? 12 - items.length : free,
    items,
  },
  machines: machines || cfg.machines.map((m) => ({ id: m.id, busyUntil: null })),
  buyers: cfg.buyers.map((id) => ({ id, cooldownUntil: null })),
});
const body = (seq, t, event, state) => ({ seq, t, event, state, report: [] });

console.log('\n— конфиг мира —');
test('parseWorld не падает на мусоре и даёт дефолты v1', () => {
  const w = parseWorld(null);
  assert.equal(w.horizon, 600);
  assert.equal(w.capacity, 12);
  assert.ok(w.ops.cut && w.ops.assemble && w.ops.handles);
  assert.ok(w.ops.paint.red && w.ops.paint.green && w.ops.paint.blue);
  assert.equal(w.types.length, 6);
  assert.equal(w.buyers.length, 4);
});
test('parseWorld восстанавливает станки, если machines битые', () => {
  const w = parseWorld({ machines: 'nope', attributes: null, buyers: 7, horizon: 'x' });
  assert.equal(w.horizon, 600);
  assert.equal(w.ops.cut.opId, 'cut');
  assert.equal(w.ops.paint.blue.opId, 'paint-blue');
  assert.equal(w.buyers.length, 4);
});

console.log('\n— обучение цен —');
test('структура цены: образец / одно расхождение / два расхождения', () => {
  const w = parseWorld({});
  const bel = newBelief();
  bel.sample = { color: 'red', handles: false };
  bel.pmax = 60;
  bel.ftier = 27;
  assert.equal(mismatches(bel.sample, { color: 'red', handles: false }), 0);
  assert.equal(mismatches(bel.sample, { color: 'red', handles: true }), 1);
  assert.equal(mismatches(bel.sample, { color: 'blue', handles: true }), 2);
  assert.ok(Math.abs(estPrice(bel, { color: 'red', handles: false }, w) - 59.4) < 0.01);
  assert.ok(Math.abs(estPrice(bel, { color: 'red', handles: true }, w) - 26.46) < 0.01);
  assert.equal(estPrice(bel, { color: 'blue', handles: true }, w), 0);
});
test('продажа по высокой цене опознаёт образец и восстанавливает f-ступень', () => {
  const bot = createBot(makeWorld(1).config);
  const st = baseState();
  bot.handle(body(1, 10, { type: 'sale_result', buyerId: 'b1', itemId: 'x', item: { id: 'x', kind: 'robot', props: { color: 'green', handles: true } }, outcome: 'sold', price: 62 }, st));
  const b1 = bot.belief().get('b1');
  assert.equal(keyOf(b1.sample), 'green#1');
  assert.ok(estPrice(b1, { color: 'green', handles: true }, bot.world) > 55, 'свой тип дороже 55');

  // одна сделка на «чужом» типе (одно расхождение) даёт Pmax*f для ВСЕХ таких типов
  bot.handle(body(2, 20, { type: 'sale_result', buyerId: 'b1', itemId: 'y', item: { id: 'y', kind: 'robot', props: { color: 'red', handles: false } }, outcome: 'sold', price: 27 }, st));
  assert.ok(Math.abs(b1.ftier - 27) < 0.5, 'f-ступень = 27');
  assert.ok(estPrice(b1, { color: 'blue', handles: true }, bot.world) > 25, 'перенос на непроверенный тип');
  assert.equal(estPrice(b1, { color: 'blue', handles: false }, bot.world), 0, 'два расхождения = 0');
});
test('отказ на своём minPrice закрывает пару как бесполезную', () => {
  const bot = createBot(makeWorld(2).config);
  bot.handle(body(1, 10, { type: 'sale_result', buyerId: 'b2', itemId: 'y', item: { id: 'y', kind: 'robot', props: { color: 'blue', handles: false } }, outcome: 'refused', reason: 'below_min_price' }, baseState()));
  assert.equal(estPrice(bot.belief().get('b2'), { color: 'blue', handles: false }, bot.world), 0);
  assert.equal(bot.belief().get('b2').sample, null, 'отказ не опознаёт образец');
});
test('отказ по cooldown не портит модель покупателя', () => {
  const bot = createBot(makeWorld(2).config);
  bot.handle(body(1, 10, { type: 'sale_result', buyerId: 'b3', itemId: 'y', item: { id: 'y', kind: 'robot', props: { color: 'red', handles: true } }, outcome: 'refused', reason: 'cooldown' }, baseState()));
  assert.ok(estPrice(bot.belief().get('b3'), { color: 'red', handles: true }, bot.world) === 22, 'оценка осталась априорной');
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
test('при свободных местах < 2 поставка не принимается', () => {
  const bot = createBot(cfg);
  const items = Array.from({ length: 11 }, (_, i) => ({ id: 'z' + i, kind: 'body', props: { color: null, handles: false } }));
  const res = bot.handle(body(1, 5, { type: 'supply', item: { id: 's1', kind: 'sheet', props: {} }, price: 4 }, baseState(items, 1)));
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
  const items = [{ id: 'r1', kind: 'robot', props: { color: 'red', handles: false } }];
  const state = baseState(items);
  state.buyers = state.buyers.map((b) => ({ ...b, cooldownUntil: b.id === 'b1' ? 99 : null }));
  const res = bot.handle(body(1, 100, { type: 'machine_done', machineId: 'm-assemble', opId: 'assemble', item: items[0] }, state));
  const offer = res.commands.find((c) => c.cmd === 'offer');
  assert.ok(offer, 'offer есть');
  assert.notEqual(offer.buyerId, 'b1', 'не предлагаем тому, у кого пауза');
  assert.ok(offer.minPrice > 0, 'minPrice отсекает нулевую ступень');
});
test('на горизонте бот не делает ничего', () => {
  const bot = createBot(cfg);
  const items = [{ id: 's1', kind: 'sheet', props: {} }];
  const res = bot.handle(body(1, cfg.horizon, { type: 'supply', item: { id: 's2', kind: 'sheet', props: {} }, price: 4 }, baseState(items)));
  assert.deepEqual(res.commands, []);
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
const or = bench((w) => createBot(w.config, { oracle: w.buyers }), 5);
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
