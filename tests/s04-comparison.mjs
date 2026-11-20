import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLatencies, pairedSummary } from '../experiments/s04-compare.mjs';

test('сводка использует все замеры и ближайший ранг',()=>{
  const latencies=Array.from({length:100},(_,i)=>i+1);
  assert.deepEqual(summarizeLatencies(latencies),{count:100,meanMs:50.5,p95Ms:95,p99Ms:99,maxMs:100});
});
test('парная разница считается по совпадающим seed и учитывает проигрыши',()=>{
  const base=[{seed:1,profit:10},{seed:2,profit:20},{seed:3,profit:30}];
  const candidate=[{seed:1,profit:8},{seed:2,profit:20},{seed:3,profit:34}];
  const s=pairedSummary(base,candidate);
  assert.equal(s.meanDelta,2/3); assert.equal(s.medianDelta,0); assert.equal(s.wins,1);assert.equal(s.losses,1);assert.equal(s.ties,1);
  assert.throws(()=>pairedSummary(base,[...candidate].reverse()),/seed/);
});
