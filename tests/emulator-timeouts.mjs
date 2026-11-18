import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaEmulator } from '../src/engine.mjs';

test('отсутствующий предмет для offer даёт no_such_robot', () => {
  const em = new ArenaEmulator({ horizon: 0 });
  assert.deepEqual(em.executeCommands([{ cmd: 'offer', buyerId: 'b1', itemId: 'absent' }]), [{ cmd: 0, ok: false, reason: 'no_such_robot' }]);
  assert.deepEqual(em.executeCommands([{ cmd: 'discard', itemId: 'absent' }]), [{ cmd: 0, ok: false, reason: 'no_such_item' }]);
});

test('опоздавшие команды игнорируются, смена завершается после превышения лимита', () => {
  let now = 0;
  const em = new ArenaEmulator({ horizon: 100, idleEvery: 1, eventTimeoutMs: 10, maxTimeouts: 2, now: () => now });
  let calls = 0;
  const result = em.runFullShift({ handleEvent({ event }) {
    calls++;
    now += 11;
    return event.type === 'supply' ? [{ cmd: 'accept', itemId: event.item.id }] : [{ cmd: 'discard', itemId: 'x' }];
  } });
  assert.equal(em.getStartPayload().eventTimeoutMs, 10);
  assert.equal(calls, 3);
  assert.equal(result.timeouts, 3);
  assert.equal(result.stopReason, 'max_timeouts');
  assert.equal(result.invalidCommands.length, 0);
  assert.equal(result.purchases, 0);
});

test('успешный ответ сбрасывает серию; ошибка и некорректный ответ учитываются', () => {
  let now = 0;
  const em = new ArenaEmulator({ horizon: 20, idleEvery: 1, eventTimeoutMs: 10, maxTimeouts: 1, now: () => now });
  let calls = 0;
  const result = em.runFullShift({ handleEvent() {
    calls++;
    if (calls === 1) { now += 11; return []; }
    if (calls === 2) return [];
    if (calls === 3) throw new Error('test');
    return null;
  } });
  assert.equal(calls, 4);
  assert.equal(result.timeouts, 1);
  assert.equal(result.errors, 2);
  assert.equal(result.invalidCommands.length, 0, 'ошибки обработчика не являются недопустимыми командами');
  assert.equal(result.stopReason, 'max_timeouts');
});
