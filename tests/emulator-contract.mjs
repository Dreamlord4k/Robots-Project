import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaEmulator } from '../src/engine.mjs';

test('start и события содержат состояние и операции в формате арены', () => {
  const em = new ArenaEmulator({ seed: 1, horizon: 0 });
  const start = em.getStartPayload();
  assert.ok(Array.isArray(start.machines));
  assert.ok(start.machines.every(m => Array.isArray(m.ops) && m.ops.every(op => typeof op.id === 'string')));
  let received;
  em.runFullShift({ handleEvent(p) { received = p; return []; } });
  assert.equal(received.state.cash, 0);
  assert.equal(received.state.storage.capacity, 12);
  assert.equal(received.state.storage.free, 12);
  assert.deepEqual(received.state.storage.items, []);
  assert.ok(Array.isArray(received.state.machines));
  assert.ok(received.state.machines.every(m => m.busyUntil === null));
  assert.ok(Array.isArray(received.state.buyers));
  assert.deepEqual(received.report, []);
});

test('report содержит результаты команд предыдущего ответа по порядку', () => {
  const em = new ArenaEmulator({ seed: 1, horizon: 10, idleEvery: 1 });
  const events = [];
  em.runFullShift({ handleEvent(p) {
    events.push(p);
    if (events.length === 1) return [{ cmd: 'discard', itemId: 'missing' }, { cmd: 'accept', itemId: 'missing' }];
    return [];
  } });
  assert.deepEqual(events[1].report, [{ cmd: 0, ok: false, reason: 'no_such_item' }, { cmd: 1, ok: false, reason: 'not_offered' }]);
  assert.deepEqual(events[2].report, []);
});

test('report сочетает успешные и отклонённые команды, станок резервирует место', () => {
  const em = new ArenaEmulator({ seed: 2, horizon: 0 });
  const body = { id: 'body', kind: 'body', props: { color: null, handles: false } };
  em.items.push(body);
  const report = em.executeCommands([
    { cmd: 'start', machineId: 'm-handles', opId: 'add-handles', itemIds: ['body'] },
    { cmd: 'discard', itemId: 'body' }
  ]);
  assert.deepEqual(report, [{ cmd: 0, ok: true }, { cmd: 1, ok: false, reason: 'no_such_item' }]);
  assert.equal(em.getPublicState().storage.free, 11);
  assert.equal(em.getPublicState().machines.find(m => m.id === 'm-handles').busyUntil, 2);
});

test('шаблон props и inherit по индексу учитываются при выполнении операции', () => {
  const em = new ArenaEmulator({ seed: 1, horizon: 0 });
  em.machinesDef['m-assemble'].ops.assemble = { inputs: [{ kind: 'body', props: { color: '*', handles: false } }, { kind: 'control', props: { model: 'x' } }], output: { kind: 'robot', props: { built: true } }, inherit: 1, duration: 1, cost: 1 };
  em.items.push({ id: 'b', kind: 'body', props: { color: 'red', handles: false } }, { id: 'c', kind: 'control', props: { model: 'x', extra: 42 } });
  em.executeCommands([{ cmd: 'start', machineId: 'm-assemble', opId: 'assemble', itemIds: ['b', 'c'] }]);
  assert.equal(em.stats.invalidCommands.length, 0);
  assert.deepEqual(em.machines['m-assemble'].currentOp.outputItem.props, { model: 'x', extra: 42, built: true });
  const bad = new ArenaEmulator({ seed: 1, horizon: 0 });
  bad.items.push({ id: 'b', kind: 'body', props: { color: 'red', handles: false } });
  bad.executeCommands([{ cmd: 'start', machineId: 'm-handles', opId: 'add-handles', itemIds: ['b'] }]);
  assert.equal(bad.stats.invalidCommands[0]?.reason, 'bad_inputs');
});

test('wildcard требует заданного значения, а null допускает отсутствующее свойство', () => {
  const em = new ArenaEmulator({ seed: 1, horizon: 0 });
  em.items.push({ id: 'body', kind: 'body', props: { handles: false } }, { id: 'control', kind: 'control', props: {} });
  assert.equal(em.executeCommands([{ cmd: 'start', machineId: 'm-assemble', opId: 'assemble', itemIds: ['body', 'control'] }])[0].reason, 'bad_inputs');
  assert.equal(em.executeCommands([{ cmd: 'start', machineId: 'm-handles', opId: 'add-handles', itemIds: ['body'] }])[0].ok, true);
});

test('priceCeiling по умолчанию 100, как в спецификации', () => {
  const em = new ArenaEmulator({ seed: 1, horizon: 0 });
  assert.equal(em.getStartPayload().priceCeiling, 100);
});

test('нулевая длительность не подвешивает станок', () => {
  const em = new ArenaEmulator({ seed: 1, horizon: 2 });
  em.machinesDef['m-cut'].ops.cut.duration = 0;
  em.items.push({ id: 's', kind: 'sheet', props: {} });
  const report = em.executeCommands([{ cmd: 'start', machineId: 'm-cut', opId: 'cut', itemIds: ['s'] }]);
  assert.equal(report[0].ok, true);
  assert.equal(em.machines['m-cut'].busyUntil, 1);
  em.runFullShift({ handleEvent() { return []; } });
  assert.equal(em.stats.invalidCommands.length, 0);
  assert.ok(em.items.some(item => item.kind === 'body'), 'результат появился на складе');
});
