// Прогон стратегии непосредственно на данных эмулятора в формате арены.
import assert from 'node:assert/strict';
import { ArenaEmulator } from '../src/engine.mjs';
import { FactoryBot } from '../src/bot.mjs';

for (const seed of [1, 5, 13]) {
  const em = new ArenaEmulator({ seed, horizon: 600 });
  const bot = new FactoryBot(em.getStartPayload());
  const counts = {};
  const result = em.runFullShift({ handleEvent(payload) {
    assert.ok(Array.isArray(payload.report));
    assert.ok(Array.isArray(payload.state.storage.items));
    assert.ok(Array.isArray(payload.state.machines));
    const commands = bot.handleEvent(payload);
    for (const command of commands) {
      counts[command.type] = (counts[command.type] || 0) + 1;
      if (command.opId === 'add-handles') {
        const item = payload.state.storage.items.find(i => i.id === command.itemIds[0]);
        assert.ok(item && item.props.color == null && !item.props.handles, 'ручки только на неокрашенный корпус');
      }
    }
    return commands;
  } });
  assert.equal(result.errors, 0, `seed ${seed}: ошибки обработчика ${JSON.stringify(result.failedEvents)}`);
  assert.equal(result.timeouts, 0, `seed ${seed}: таймауты ${JSON.stringify(result.failedEvents)}`);
  assert.equal(result.stopReason, null, `seed ${seed}: преждевременная остановка`);
  assert.equal(result.invalidCommands.length, 0, `seed ${seed}: ${JSON.stringify(result.invalidCommands.slice(0, 3))}`);
  assert.ok(result.robotsSold > 0 && counts.offer > 0 && counts.start > 0 && counts.accept > 0, `seed ${seed}: полный цикл`);
  console.log(`seed ${seed}: продано ${result.robotsSold}, недопустимых команд ${result.invalidCommands.length}`);
}
