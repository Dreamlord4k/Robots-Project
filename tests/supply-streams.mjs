import assert from 'node:assert/strict';
import { ArenaEmulator } from '../src/engine.mjs';
import { FactoryBot } from '../src/bot.mjs';

function collect(seed) {
  const em = new ArenaEmulator({ seed, horizon: 600 });
  const supplies = [];
  em.runFullShift({ handleEvent({ t, event }) {
    if (event.type === 'supply') supplies.push({ t, kind: event.item.kind });
    return [];
  } });
  return supplies;
}
const first = collect(42);
assert.deepEqual(collect(42), first, 'поставки воспроизводимы по seed');
for (const kind of ['sheet', 'control']) {
  const ticks = first.filter(s => s.kind === kind).map(s => s.t);
  assert.ok(ticks.length > 140, `${kind}: независимый поток поставок`);
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(ticks[i] - ticks[i - 1] >= 2 && ticks[i] - ticks[i - 1] <= 4, `${kind}: интервалы 2–4 такта`);
  }
}
assert.ok(first.some((s, i) => i > 0 && s.t === first[i - 1].t && s.kind !== first[i - 1].kind), 'два вида могут прийти в одном такте');
const em = new ArenaEmulator({ seed: 42, horizon: 600 });
const bot = new FactoryBot(em.getStartPayload());
const actual = [];
em.runFullShift({ handleEvent(payload) {
  if (payload.event.type === 'supply') actual.push({ t: payload.t, kind: payload.event.item.kind });
  return bot.handleEvent(payload);
} });
assert.deepEqual(actual, first, 'поток поставок не зависит от действий стратегии');
console.log('Независимые поставки sheet и control: OK');
