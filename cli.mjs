import { ArenaEmulator } from './src/engine.mjs';
import { FactoryBot, NaiveBot } from './src/bot.mjs';

const args = process.argv.slice(2);
const seedsIdx = args.indexOf('--seeds');
const seedsCount = seedsIdx !== -1 ? Number(args[seedsIdx + 1]) : 20;
const horizonIdx = args.indexOf('--horizon');
const horizon = horizonIdx !== -1 ? Number(args[horizonIdx + 1]) : 650;
const verbose = args.includes('--verbose');

console.log(`Running benchmark: ${seedsCount} worlds, horizon ${horizon}...`);

let sumNaive = 0;
let sumLevel3 = 0;
let totalSold = 0;
let totalInvalid = 0;
let totalLatencyMs = 0;
let totalEvents = 0;

for (let i = 1; i <= seedsCount; i++) {
  const seed = i * 1013;

  const emu1 = new ArenaEmulator({ seed, horizon });
  const rep1 = emu1.runFullShift(new NaiveBot(emu1.getStartPayload()));
  sumNaive += rep1.profit;

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
      `World #${i} (seed ${seed}): ` +
      `Naive=${rep1.profit.toFixed(1)}, ` +
      `Level3=${rep3.profit.toFixed(1)} (${rep3.robotsSold} sold)`
    );
  }
}

const avgNaive = sumNaive / seedsCount;
const avgLevel3 = sumLevel3 / seedsCount;
const avgEventUs = (totalLatencyMs * 1000) / Math.max(1, totalEvents);

console.log('------------------------------------------------------------------');
console.log(`Benchmark results (${seedsCount} worlds):`);
console.log(`  Naive Avg Profit: ${avgNaive.toFixed(2)}`);
console.log(`  Level3 Avg Profit: ${avgLevel3.toFixed(2)}`);
console.log(`  Total Robots Sold: ${totalSold}`);
console.log(`  Avg Event Latency: ${avgEventUs.toFixed(2)} µs`);
console.log('------------------------------------------------------------------');
