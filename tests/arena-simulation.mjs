// Прогон стратегии на снимках в формате арены поверх локального эмулятора.
import assert from 'node:assert/strict';
import { ArenaEmulator } from '../src/engine.mjs';
import { FactoryBot } from '../src/bot.mjs';

for (const seed of [1, 5, 13]) {
  const em = new ArenaEmulator({ seed, horizon: 600 });
  const base = em.getStartPayload();
  const ids = { handles: 'add-handles', paint_red: 'paint-red', paint_green: 'paint-green', paint_blue: 'paint-blue' };
  const machines = Object.entries(base.machines).map(([id, machine]) => ({ id, ops: Object.entries(machine.ops).map(([opId, op]) => ({
    ...op, id: ids[opId] || opId,
    inputs: op.inputs.map(input => ({ kind: input.kind, ...(input.colored ? { props: { color: '*' } } : input.color === null ? { props: { color: null } } : input.handles === false ? { props: { color: null, handles: false } } : {}) }))
  })) }));
  const bot = new FactoryBot({ ...base, machines });
  const counts = {};
  const adapter = { handleEvent(payload) {
    const state = payload.state;
    const busy = Object.values(state.machines).filter(m => m.busy).length;
    const arenaState = { cash: state.money, storage: { capacity: base.capacity, free: base.capacity - state.items.length - busy, items: state.items },
      machines: Object.entries(state.machines).map(([id, m]) => ({ id, busyUntil: m.busy ? m.busyUntil : null })),
      buyers: Object.entries(state.buyers).map(([id, b]) => ({ id, cooldownUntil: b.cooldown ? payload.t + b.cooldown : null })) };
    const result = bot.handleEvent({ ...payload, state: arenaState });
    for (const command of result) {
      counts[command.type] = (counts[command.type] || 0) + 1;
      if (command.opId === 'add-handles') {
        const item = state.items.find(i => i.id === command.itemIds[0]);
        assert.ok(item && item.props.color == null && !item.props.handles, 'ручки только на неокрашенный корпус');
      }
    }
    const originalIds = Object.fromEntries(Object.entries(ids).map(([a, b]) => [b, a]));
    return result.map(c => ({ ...c, opId: originalIds[c.opId] || c.opId }));
  } };
  const result = em.runFullShift(adapter);
  assert.equal(result.invalidCommands.length, 0, `seed ${seed}: ${JSON.stringify(result.invalidCommands.slice(0, 3))}`);
  assert.ok(result.robotsSold > 0 && counts.offer > 0 && counts.start > 0 && counts.accept > 0, `seed ${seed}: полный цикл`);
  console.log(`seed ${seed}: продано ${result.robotsSold}, недопустимых команд ${result.invalidCommands.length}`);
}
