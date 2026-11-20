import { pathToFileURL } from 'node:url';
import { ArenaEmulator } from '../src/engine.mjs';
import { FactoryBot as S02 } from './s02-bot.mjs';
import { FactoryBot as S04 } from './s04-bot.mjs';
import { WorldMetrics } from './metrics.mjs';

const quantile = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];
export function summarizeLatencies(values) {
  if (!values.length) return {count:0,meanMs:null,p95Ms:null,p99Ms:null,maxMs:null};
  const sorted=[...values].sort((a,b)=>a-b);
  return {count:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:quantile(sorted,.95),p99Ms:quantile(sorted,.99),maxMs:sorted[sorted.length-1]};
}
export function pairedSummary(base, candidate) {
  if (!base.length || base.length !== candidate.length) throw Error('Несовпадение числа миров');
  const deltas=base.map((a,i)=>{if(a.seed!==candidate[i].seed) throw Error('Несовпадение seed');return Math.round((candidate[i].profit-a.profit)*100)/100;});
  const sorted=[...deltas].sort((a,b)=>a-b), n=sorted.length;
  return {meanDelta:deltas.reduce((a,b)=>a+b,0)/n,medianDelta:(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2,p10:quantile(sorted,.1),p90:quantile(sorted,.9),min:sorted[0],max:sorted[n-1],wins:deltas.filter(x=>x>0).length,losses:deltas.filter(x=>x<0).length,ties:deltas.filter(x=>x===0).length};
}
function run(seed,Bot,samples) {
  const observer=new WorldMetrics();
  const arena=new ArenaEmulator({seed,horizon:650,observer});
  const bot=new Bot(arena.getStartPayload());
  const report=arena.runFullShift(bot);
  samples.push(...observer.latencies);
  const metrics=observer.finish(report,arena.items);
  return {seed,profit:report.profit,revenue:report.revenue,sales:report.robotsSold,refusedPrice:metrics.offers.refusedPrice,
    invalid:report.invalidCommands.length,errors:report.errors,timeouts:report.timeouts,stopReason:report.stopReason,
    latency:metrics.latency,...(bot.plannerStats ? {planner:{...bot.plannerStats}}:{})};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const count=Number(process.argv[2] ?? 500);
  if (!Number.isInteger(count)||count<1||count>500) throw Error('Число настроечных миров: 1..500');
  const base=[], candidate=[], baseTimes=[], candidateTimes=[];
  for(let i=1;i<=count;i++) {const seed=i*1013;base.push(run(seed,S02,baseTimes));candidate.push(run(seed,S04,candidateTimes));}
  console.log(JSON.stringify({set:'tune',seedFormula:`i*1013, i=1..${count}`,horizon:650,comparison:pairedSummary(base,candidate),baseLatency:summarizeLatencies(baseTimes),candidateLatency:summarizeLatencies(candidateTimes),base,candidate},null,2));
}
