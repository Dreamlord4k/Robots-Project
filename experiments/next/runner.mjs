import { pathToFileURL } from 'node:url';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ArenaEmulator } from '../../src/engine.mjs';
import { FactoryBot } from './baseline/bot.mjs';
import { WorldMetrics } from '../metrics.mjs';

export const sets={tune:Array.from({length:300},(_,i)=>(3001+i)*1013),check:Array.from({length:200},(_,i)=>(4001+i)*1013),final:Array.from({length:500},(_,i)=>(5001+i)*1013)};

// Защита от «тихих нулей»: без observer-хука в движке метрики пустые,
// а прогон выглядит успешным. Проверяем один раз на процесс.
let observerSupport = null;
function requireObserverSupport() {
  if (observerSupport !== null) return observerSupport;
  let hooked = false;
  const probe = new ArenaEmulator({ seed: 1, horizon: 0 });
  probe.observer = { onTick() { hooked = true; } };
  probe.runFullShift({ handleEvent() { return []; } });
  observerSupport = hooked;
  if (!hooked) throw new Error('ArenaEmulator не вызывает observer: src/engine.mjs не содержит observer-хука, метрики были бы пустыми');
  return true;
}

export function runWorld({seed,horizon=600,Bot=FactoryBot,observe=true,unlimited=false,trace=false}) {
  requireObserverSupport();
  const arena=new ArenaEmulator({seed,horizon, ...(unlimited?{now:()=>0}: {})});
  const start=arena.getStartPayload();
  const metrics=observe?new WorldMetrics(start):null;
  arena.observer=metrics;
  const events=[];
  if (metrics && trace) {
    const onEvent=metrics.onEvent.bind(metrics), onCommands=metrics.onCommands.bind(metrics);
    let recorded=false; const counts=[0,0,0];
    metrics.onEvent=(payload,ms)=>{onEvent(payload,ms); recorded=false; const third=metrics.third(payload.t); const interesting=payload.event?.type==='sale_result' && payload.event.outcome==='refused' || payload.state?.storage?.free<=0 || payload.event?.type==='supply' && payload.t%25<3; if(interesting && counts[third]<40) {events.push({t:payload.t,event:payload.event,state:payload.state,report:payload.report});counts[third]++;recorded=true;}};
    metrics.onCommands=(commands,report)=>{onCommands(commands,report);if(recorded) Object.assign(events.at(-1),{commands,commandReport:report});};
  }
  const bot=new Bot(start, unlimited?{timeBudgetMs:1e6}:{});
  let lastExhausted=0;
  if(metrics) metrics.onAfterDecision=()=>{const count=bot.plannerStats?.exhausted??0;metrics.onDecision({exhausted:count>lastExhausted});lastExhausted=count;};
  const report=arena.runFullShift(bot);
  const financial=Object.fromEntries(['profit','revenue','purchases','opCosts','offerFees','storageCosts','robotsSold','robotsProduced','robotsDiscarded','errors','timeouts','stopReason','invalidCommands'].map(k=>[k,report[k]]));
  return {seed,start,financial,metrics:metrics?.finish(report,arena.items,arena.machines)??null,latencies:metrics?.latencies??[],planner:bot.plannerStats??null,...(trace?{trace:events}: {})};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const set=process.argv[2]??'tune';
  if(set!=='tune' && set!=='check') throw Error('Финальный набор зарезервирован до S12');
  const paths=['src/bot.mjs','src/s04-planner.mjs','src/engine.mjs','experiments/metrics.mjs','experiments/next/runner.mjs','experiments/next/baseline/bot.mjs','experiments/next/baseline/s04-planner.mjs'];
  const hashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
  const rows=sets[set].map(seed=>runWorld({seed}));
  writeFileSync(`experiments/next/s06-${set}-v3.json`,JSON.stringify({set,horizon:600,node:process.version,hashes,rows},null,2)+'\n',{flag:'wx'});
  console.log(`Сохранено ${rows.length} миров: ${set}`);
}
