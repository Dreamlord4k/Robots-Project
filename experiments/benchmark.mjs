// Локальный эксперимент: секреты и номер seed не передаются боту.
import { pathToFileURL } from 'node:url';
import { ArenaEmulator } from '../src/engine.mjs';
import { FactoryBot } from '../src/bot.mjs';
import { WorldMetrics } from './metrics.mjs';

function fields(seed, result) {
  return {
    seed, profit: result.profit, revenue: result.revenue, purchases: result.purchases,
    opCosts: result.opCosts, offerFees: result.offerFees, storageCosts: result.storageCosts,
    sales: result.robotsSold, produced: result.robotsProduced, discarded: result.robotsDiscarded,
    invalid: result.invalidCommands.length, errors: result.errors, timeouts: result.timeouts,
    stopReason: result.stopReason
  };
}

export function runWorld(seed, horizon = 650, Bot = FactoryBot, options = {}) {
  const arena = new ArenaEmulator({ seed, horizon, ...(options.emulator ?? {}) });
  return fields(seed, arena.runFullShift(new Bot(arena.getStartPayload(), options.bot ?? {})));
}

export function runWorldDetailed(seed, horizon = 650, Bot = FactoryBot, options = {}) {
  const metrics = new WorldMetrics();
  const arena = new ArenaEmulator({ seed, horizon, observer: metrics, ...(options.emulator ?? {}) });
  const bot = new Bot(arena.getStartPayload(), options.bot ?? {});
  // Неизвестные модели не инспектируются; это не часть API арены.
  if (bot.buyers instanceof Map) metrics.onAfterDecision = t => {
    const beliefs = [];
    for (const [id, belief] of bot.buyers) {
      if (!Array.isArray(belief?.hypotheses)) continue;
      beliefs.push({ id, possible: belief.hypotheses.filter(h => h.possible).map(h => h.key).filter(key => typeof key === 'string') });
    }
    metrics.onBeliefs(t, beliefs);
  };
  const result = arena.runFullShift(bot);
  return { ...fields(seed, result), metrics: metrics.finish(result, arena.items) };
}

export function summarize(rows) {
  const values = rows.map(row => row.profit).sort((a, b) => a - b);
  const n = values.length;
  if (!n) throw new Error('Пустой набор миров');
  return { worlds: n, meanProfit: values.reduce((a, b) => a + b, 0) / n,
    medianProfit: (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2,
    invalid: rows.reduce((a, r) => a + r.invalid, 0),
    errors: rows.reduce((a, r) => a + r.errors, 0),
    timeouts: rows.reduce((a, r) => a + r.timeouts, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const detailed = args.includes('--metrics');
  const [set = 'tune', countArg = '100', botPath] = args.filter(arg => arg !== '--metrics');
  const count = Number(countArg);
  if (!['tune', 'holdout'].includes(set) || !Number.isInteger(count) || count < 1 || count > 500) throw new Error('Использование: node experiments/benchmark.mjs tune|holdout 1..500 [путь к модулю бота]');
  const Bot = botPath ? (await import(pathToFileURL(process.cwd() + '/' + botPath))).FactoryBot : FactoryBot;
  const offset = set === 'tune' ? 0 : 1000;
  const rows = Array.from({ length: count }, (_, i) => (detailed ? runWorldDetailed : runWorld)((offset + i + 1) * 1013, 650, Bot));
  console.log(JSON.stringify({ set, horizon: 650, seedFormula: `(${offset}+i)*1013, i=1..${count}`, summary: summarize(rows), rows }, null, 2));
}
