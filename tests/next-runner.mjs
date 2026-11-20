import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorld, sets } from '../experiments/next/runner.mjs';
import { FactoryBot as Current } from '../src/bot.mjs';
import { FactoryBot as Frozen } from '../experiments/next/baseline/bot.mjs';

test('миры раздельны и не пересекаются с прежними диапазонами',()=>{
  const all=Object.values(sets).flat();
  assert.equal(new Set(all).size,all.length);
  assert.ok(all.every(seed=>seed>2500*1013));
});

test('наблюдатель не меняет финансы на одном и том же боте',()=>{
  const opts={seed:3039*1013,horizon:80,unlimited:true};
  const a=runWorld({...opts,Bot:Current,observe:false});
  const b=runWorld({...opts,Bot:Current,observe:true});
  assert.deepEqual(a.financial,b.financial);
});

test('рабочий бот и замороженная S06-база запускаются на одинаковом мире',()=>{
  const opts={seed:3039*1013,horizon:80,unlimited:true};
  const current=runWorld({...opts,Bot:Current,observe:true});
  const frozen=runWorld({...opts,Bot:Frozen,observe:true});
  assert.equal(current.financial.invalidCommands.length,0);
  assert.equal(frozen.financial.invalidCommands.length,0);
  // После Ф1 результаты могут отличаться: это кандидат, а не копия базы.
  assert.equal(typeof current.financial.profit,'number');
  assert.equal(typeof frozen.financial.profit,'number');
});

test('бот не получает seed и раскрытые предпочтения в start и событиях',()=>{
  class Spy extends Frozen {
    constructor(start,options){assert.ok(!JSON.stringify(start).match(/buyersSecret|pMax|sample|"seed"/));super(start,options);}
    handleEvent(payload){assert.ok(!JSON.stringify(payload).match(/buyersSecret|pMax|sample|"seed"/));return super.handleEvent(payload);}
  }
  const out=runWorld({seed:3031*1013,horizon:60,Bot:Spy});
  assert.equal(out.financial.errors,0);
});

test('сумма расходов наблюдателя совпадает с финансовым отчётом эмулятора',()=>{
  const r=runWorld({seed:3001*1013,horizon:100});
  const sum=key=>r.metrics.costByThird.reduce((s,x)=>s+x[key],0);
  for (const [key,field] of [['purchases','purchases'],['operations','opCosts'],['offers','offerFees'],['storage','storageCosts']])
    assert.ok(Math.abs(sum(key)-r.financial[field])<0.011, `${key}: ${sum(key)} vs ${r.financial[field]}`);
});
