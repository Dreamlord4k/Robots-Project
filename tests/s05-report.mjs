import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWorlds, compareWorlds, holdoutSeeds } from '../experiments/s05-evaluate.mjs';

test('итоговая статистика считает квантили, убыточные миры и нарушения',()=>{
  const rows=[{seed:1,profit:-10,sales:2,invalid:1,errors:0,timeouts:0},{seed:2,profit:10,sales:4,invalid:0,errors:1,timeouts:0},{seed:3,profit:30,sales:6,invalid:0,errors:0,timeouts:1}];
  const s=summarizeWorlds(rows);
  assert.equal(s.meanProfit,10);assert.equal(s.medianProfit,10);assert.equal(s.p10,-10);assert.equal(s.p90,30);
  assert.equal(s.lossWorlds,1);assert.equal(s.meanSales,4);assert.equal(s.invalid,1);assert.equal(s.errors,1);assert.equal(s.timeouts,1);
});
test('парное сравнение строго сверяет seed и считает разницы',()=>{
  const base=[{seed:1,profit:10},{seed:2,profit:20},{seed:3,profit:30}];
  const candidate=[{seed:1,profit:8},{seed:2,profit:20},{seed:3,profit:34}];
  const s=compareWorlds(base,candidate);
  assert.equal(s.meanDelta,2/3);assert.equal(s.medianDelta,0);assert.equal(s.winRate,1/3);
  assert.throws(()=>compareWorlds(base,[...candidate].reverse()),/seed/);
});
test('отложенные seed фиксированы и не пересекаются с настройкой',()=>{
  const holdout=holdoutSeeds();const tune=new Set(Array.from({length:500},(_,i)=>(i+1)*1013));
  assert.equal(holdout.length,500);assert.equal(holdout[0],1001*1013);assert.equal(holdout.at(-1),1500*1013);
  assert.ok(holdout.every(seed=>!tune.has(seed)));
});
