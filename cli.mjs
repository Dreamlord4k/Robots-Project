import { ArenaEmulator } from './src/engine.mjs';
import { FactoryBot, NaiveBot } from './src/bot.mjs';

const args = process.argv.slice(2);
const seedsIdx = args.indexOf('--seeds');
const seedsCount = seedsIdx !== -1 ? Number(args[seedsIdx + 1]) : 20;
const horizonIdx = args.indexOf('--horizon');
const horizon = horizonIdx !== -1 ? Number(args[horizonIdx + 1]) : 650;
const verbose = args.includes('--verbose');

console.log(XXXINLINECODEXXX47XXXINLINECODEXXX);

let sumNaive = 0;
let sumLevel3 = 0;
let totalSold = 0;
let totalInvalid = 0;
let totalLatencyMs = 0;
let totalEvents = 0;

for (let i = 1; i <= seedsCount; i++) {
  const seed = i * 1013;

  // Уровень 1 (Наивный)
  const emu1 = new ArenaEmulator({ seed, horizon });
  const rep1 = emu1.runFullShift(new NaiveBot(emu1.getStartPayload()));
  sumNaive += rep1.profit;

  // Уровень 3+ (Байесовский планировщик)
  const emu3 = new ArenaEmulator({ seed, horizon });
  const bot3 = new FactoryBot(emu3.getStartPayload());

  const tStart = performance.now();
  const rep3 = emu3.runFullShift(bot3);
  const elapsed = performance.now() - tStart;

  sumLevel3 += rep3.profit;
  totalSold += rep3.robotsSold;
  totalInvalid += rep3.invalidCommands.length;
  totalLatencyMs += elapsed;
  totalEvents += emu3.seq;

  if (verbose) {
    console.log(
      XXXINLINECODEXXX48XXXINLINECODEXXX +
      XXXINLINECODEXXX49XXXINLINECODEXXX +
      XXXINLINECODEXXX50XXXINLINECODEXXX
    );
  }
}

const avgNaive = sumNaive / seedsCount;
const avgLevel3 = sumLevel3 / seedsCount;
const avgEventUs = (totalLatencyMs * 1000) / Math.max(1, totalEvents);

console.log('------------------------------------------------------------------');
console.log(XXXINLINECODEXXX51XXXINLINECODEXXX);
console.log(XXXINLINECODEXXX52XXXINLINECODEXXX);
console.log(XXXINLINECODEXXX53XXXINLINECODEXXX);
console.log(XXXINLINECODEXXX54XXXINLINECODEXXX);
console.log(XXXINLINECODEXXX55XXXINLINECODEXXX);
console.log('------------------------------------------------------------------');
