import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { FactoryBot as Previous } from './s04-bot.mjs';
import { FactoryBot as Current } from '../src/bot.mjs';
import { runWorld, summarize } from './benchmark.mjs';
import { pairedSummary } from './s04-compare.mjs';

const paths=['src/bot.mjs','src/s04-planner.mjs','experiments/s04-bot.mjs','experiments/s04-planner.mjs','src/engine.mjs'];
const hashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const previous=[], current=[];
for(let i=1;i<=500;i++) {
  const seed=(2000+i)*1013;
  previous.push(runWorld(seed,650,Previous));
  current.push(runWorld(seed,650,Current));
}
const result={seedFormula:'(2000+i)*1013, i=1..500',horizon:650,node:process.version,hashes,previousSummary:summarize(previous),currentSummary:summarize(current),paired:pairedSummary(previous,current),previous,current};
writeFileSync('experiments/review-comparison.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({previous:result.previousSummary,current:result.currentSummary,paired:result.paired}));
