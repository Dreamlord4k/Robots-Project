// tests/harness.mjs — адаптер: ArenaEmulator -> интерфейс makeWorld/Sim из тестов
import { ArenaEmulator } from '../src/engine.mjs';

export function makeWorld(seed) {
  const em = new ArenaEmulator({ seed });
  const start = em.getStartPayload();
  const config = {
    horizon: start.horizon,
    capacity: start.capacity,
    buyers: start.buyers,                                        // ['b1'... 'b4']
    machines: Object.keys(start.machines).map((id) => ({ id })),  // [{ id: 'm-cut' }...]
    ...start.machines,                                           // ops-определения по id станков
  };
  return { config, seed, buyers: em.buyers, _em: em };
}

export class Sim {
  constructor(world, bot, opts = {}) {
    this.world = world;
    this.bot = bot;
    this.em = world._em;
    this.maxLatency = 0;
  }

  run() {
    const self = this;
    // Адаптер интерфейса бота: тесты используют bot.handle(payload) -> { commands },
    // движок зовёт bot.handleEvent(payload) -> commands[]
    const adapter = {
      handleEvent(payload) {
        const t0 = performance.now();
        const res = self.bot.handle(payload);
        const dt = performance.now() - t0;
        if (dt > self.maxLatency) self.maxLatency = dt;
        return res && Array.isArray(res.commands) ? res.commands : [];
      },
    };

    const report = this.em.runFullShift(adapter);
    return {
      profit: report.profit,
      maxLatency: Math.round(this.maxLatency * 10) / 10,
      stats: {
        invalid: report.invalidCommands.length, // движок копит массив, тест ждёт число
        sales: report.robotsSold,
      },
      report,
    };
  }
}
