import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaEmulator } from '../src/engine.mjs';

test('observer получает тик, событие, решение и команды', () => {
  const seen = { ticks: 0, events: 0, decisions: 0, commands: 0 };
  const observer = {
    onTick(payload) {
      seen.ticks++;
      assert.equal(typeof payload.t, 'number');
      assert.ok(Array.isArray(payload.items));
    },
    onEvent(payload, elapsedMs) {
      seen.events++;
      assert.ok(payload && payload.event && payload.state);
      assert.equal(typeof elapsedMs, 'number');
    },
    onAfterDecision() {
      seen.decisions++;
    },
    onCommands(commands, report) {
      seen.commands++;
      assert.ok(Array.isArray(commands));
      assert.ok(Array.isArray(report));
    }
  };
  const em = new ArenaEmulator({ seed: 7, horizon: 3, observer });
  em.runFullShift({ handleEvent() { return []; } });
  assert.equal(seen.ticks, 4, 'по одному onTick на такт 0..3');
  assert.ok(seen.events >= 1, 'должно быть хотя бы событие idle/поставки');
  assert.equal(seen.decisions, seen.events, 'решение на каждое событие');
  assert.equal(seen.commands, seen.events, 'команды на каждое событие');
});

test('observer не меняет финансовый результат и решения бота', () => {
  // Детерминированный бот без wall-clock бюджета: проверяем нейтральность observer,
  // а не поведение планировщика под нагрузкой.
  const simpleBot = {
    handleEvent(payload) {
      const commands = [];
      const event = payload.event || {};
      const state = payload.state || {};
      const items = state.storage?.items || [];
      const free = state.storage?.free ?? 0;
      if (event.type === 'supply' && free > 0) commands.push({ type: 'accept', itemId: event.item.id });
      const sheet = items.find(item => item.kind === 'sheet');
      const cutBusy = (state.machines || []).some(machine => machine.id === 'm-cut' && machine.busyUntil != null);
      if (sheet && !cutBusy) commands.push({ type: 'start', machineId: 'm-cut', opId: 'cut', itemIds: [sheet.id] });
      return commands;
    }
  };
  const run = (observer) => {
    const em = new ArenaEmulator({ seed: 13, horizon: 60, observer });
    const report = em.runFullShift(simpleBot);
    return {
      profit: report.profit,
      sold: report.robotsSold,
      invalid: report.invalidCommands.length,
      produced: report.robotsProduced,
      history: report.history.map(point => point.money)
    };
  };
  const plain = run(null);
  const observed = run({ onTick() {}, onEvent() {}, onAfterDecision() {}, onCommands() {} });
  assert.deepEqual(observed, plain);
});
