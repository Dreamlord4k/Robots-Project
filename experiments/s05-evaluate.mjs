import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { ArenaEmulator } from '../src/engine.mjs';
import { FactoryBot as Baseline } from './baseline-bot.mjs';
import { FactoryBot as S02 } from './s02-bot.mjs';
import { FactoryBot as S03Info } from './s03-bot.mjs';
import { FactoryBot as S03NoInfo } from './s03-no-info-bot.mjs';
import { FactoryBot as S04 } from './s04-bot.mjs';
import { WorldMetrics } from './metrics.mjs';
import { summarizeLatencies, pairedSummary } from './s04-compare.mjs';

const variants = { baseline: Baseline, s02: S02, s03_info: S03Info, s03_no_info: S03NoInfo, s04: S04 };
const expected = {
  'experiments/baseline-bot.mjs':'b137f07804fefe4067677c51541a260c1ce81859a509d8bcb278a94876722faf',
  'experiments/s02-bot.mjs':'53f2eb23d49633a647e7f2802735dddc5dcddae4b69bad8e4535ad1be5759f6d',
  'experiments/s03-bot.mjs':'666cd74b32396d7bb1600c655ee52a6133219c2008ef7931bc584c4e5574e923',
  'experiments/s03-no-info-bot.mjs':'dfad3a1efe1907f0d29ed678f0ff3a95191bb214c5b137c08614c61db49ee604',
  'experiments/s04-bot.mjs':'e53db21f645963843fceb4ebe717992dd50539fb411621a4c3b02009f5c34bc3',
  'experiments/s04-planner.mjs':'c199c57f16352a5a267d636125180c3f024010b460e1a29cbff7228b38329e8b',
  'src/engine.mjs':'4fe1d398b0530c04a8c74f0c5e67ae7ee63fda3ff9d8b9bc3f9d729ce12f1d10'
};
export const holdoutSeeds = () => Array.from({length:500},(_,i)=>(1001+i)*1013);
const quantile=(sorted,p)=>sorted[Math.ceil(sorted.length*p)-1];
export function summarizeWorlds(rows) {
  if (!rows.length) throw Error('Нет миров');
  const values=rows.map(r=>r.profit).sort((a,b)=>a-b),n=values.length;
  const meanProfit=values.reduce((a,b)=>a+b,0)/n;
  const total=key=>rows.reduce((sum,r)=>sum+(r[key]??0),0);
  return {worlds:n,meanProfit,medianProfit:(values[Math.floor((n-1)/2)]+values[Math.floor(n/2)])/2,
    p10:quantile(values,.1),p90:quantile(values,.9),min:values[0],max:values[n-1],
    stddev:n>1?Math.sqrt(values.reduce((s,x)=>s+(x-meanProfit)**2,0)/(n-1)):0,
    lossWorlds:values.filter(x=>x<0).length,meanSales:total('sales')/n,meanRefused:total('refusedPrice')/n,
    invalid:total('invalid'),errors:total('errors'),timeouts:total('timeouts'),stopped:rows.filter(r=>r.stopReason!=null).length};
}
export function compareWorlds(base,candidate) {
  const stats=pairedSummary(base,candidate),n=base.length;
  const deltas=base.map((r,i)=>candidate[i].profit-r.profit);
  const stddev=n>1?Math.sqrt(deltas.reduce((s,x)=>s+(x-stats.meanDelta)**2,0)/(n-1)):0;
  return {...stats,stddev,winRate:stats.wins/n,lossRate:stats.losses/n,tieRate:stats.ties/n};
}
function sha(path) {return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');}
function writeAll(fd, buffer) {let offset=0;while(offset<buffer.length) offset+=fs.writeSync(fd,buffer,offset,buffer.length-offset);}
function execute() {
  const paths=['experiments/s05-worlds.jsonl','experiments/s05-summary.json',...Object.keys(variants).map(name=>`experiments/s05-latency-${name}.bin`)];
  for(const path of paths) if(fs.existsSync(path)) throw Error(`Результат уже существует: ${path}; повторный запуск запрещён`);
  for(const [path,hash] of Object.entries(expected)) if(sha(path)!==hash) throw Error(`Версия изменилась: ${path}`);
  const recordFd=fs.openSync(paths[0],'wx');
  const latencyFds={};
  try {
    for(const name of Object.keys(variants)) latencyFds[name]=fs.openSync(`experiments/s05-latency-${name}.bin`,'wx');
    const startParams=new ArenaEmulator({seed:0,horizon:650}).getStartPayload();
    const manifest={type:'manifest',set:'holdout',seedFormula:'(1000+i)*1013, i=1..500',seeds:holdoutSeeds(),node:process.version,
      platform:process.platform,arch:process.arch,hostEndian:os.endianness(),latencyEncoding:'IEEE754 float64 little-endian, milliseconds',
      command:'node experiments/s05-evaluate.mjs',variants:Object.keys(variants),hashes:{...expected,'experiments/metrics.mjs':sha('experiments/metrics.mjs'),'experiments/s05-evaluate.mjs':sha('experiments/s05-evaluate.mjs')},startParams};
    writeAll(recordFd,Buffer.from(JSON.stringify(manifest)+'\n'));
    const rows=Object.fromEntries(Object.keys(variants).map(name=>[name,[]]));
    for(const [index,seed] of holdoutSeeds().entries()) {
      const entry={type:'world',seed,variants:{}};
      for(const [name,Bot] of Object.entries(variants)) {
        const observer=new WorldMetrics();
        const arena=new ArenaEmulator({seed,horizon:650,observer});
        const bot=new Bot(arena.getStartPayload());
        const report=arena.runFullShift(bot);
        const metric=observer.finish(report,arena.items);
        const bytes=Buffer.allocUnsafe(observer.latencies.length*8);
        observer.latencies.forEach((x,i)=>bytes.writeDoubleLE(x,i*8));
        writeAll(latencyFds[name],bytes);
        const row={seed,profit:report.profit,revenue:report.revenue,purchases:report.purchases,opCosts:report.opCosts,
          storageCosts:report.storageCosts,offerFees:report.offerFees,sales:report.robotsSold,produced:report.robotsProduced,
          refusedPrice:metric.offers.refusedPrice,refusedCooldown:metric.offers.refusedCooldown,
          invalid:report.invalidCommands.length,invalidCommands:report.invalidCommands,errors:report.errors,timeouts:report.timeouts,
          failedEvents:report.failedEvents,stopReason:report.stopReason,latency:metric.latency,
          ...(bot.plannerStats?{planner:{...bot.plannerStats}}:{})};
        rows[name].push(row);entry.variants[name]=row;
      }
      writeAll(recordFd,Buffer.from(JSON.stringify(entry)+'\n'));
      if ((index+1)%50===0) {fs.fsyncSync(recordFd);for(const fd of Object.values(latencyFds)) fs.fsyncSync(fd);console.error(`Миров завершено: ${index+1}/500`);}
    }
    for(const [path,hash] of Object.entries(expected)) if(sha(path)!==hash) throw Error(`Версия изменилась во время прогона: ${path}`);
    const summaries={}, comparisons={};
    for(const name of Object.keys(variants)) {
      const bytes=fs.readFileSync(`experiments/s05-latency-${name}.bin`);
      if(bytes.length%8) throw Error(`Повреждены измерения: ${name}`);
      const samples=Array.from({length:bytes.length/8},(_,i)=>bytes.readDoubleLE(i*8));
      summaries[name]={...summarizeWorlds(rows[name]),latency:summarizeLatencies(samples),
        plannerCalls:rows[name].reduce((s,r)=>s+(r.planner?.calls??0),0),plannerExhausted:rows[name].reduce((s,r)=>s+(r.planner?.exhausted??0),0)};
      if(name!=='baseline') comparisons[name]=compareWorlds(rows.baseline,rows[name]);
    }
    fs.writeFileSync(paths[1],JSON.stringify({manifest,variants:summaries,versusBaseline:comparisons},null,2)+'\n',{flag:'wx'});
  } finally {for(const fd of Object.values(latencyFds)) fs.closeSync(fd);fs.closeSync(recordFd);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) execute();
