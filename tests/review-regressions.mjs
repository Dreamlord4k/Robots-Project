import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FactoryBot } from '../src/bot.mjs';
import { FactoryBot as DelayBot } from '../experiments/next/s11-delay-bot.mjs';
import { worstDeciles, validateHttpEvidence, moduleGraph, assertExperimentAllowed } from '../experiments/next/review-tools.mjs';

test('отказ при дробном пороге сохраняет допустимый Pmax после округления',()=>{
  const bot=new FactoryBot({buyers:['b1'],priceCeiling:30.001});
  const item={id:'r',kind:'robot',props:{color:'red',handles:false}};
  const belief=bot.buyers.get('b1');
  belief.updateOnSaleResult(item,'refused',undefined,30.001);
  const h=belief.hypotheses.find(x=>x.key==='red:0');
  assert.ok(h.possible&&h.pMaxLo<=30.615&&h.pMaxHi>=30.615);
});

test('очень малая доля копейки не исключает возможный Pmax',()=>{
  const bot=new FactoryBot({buyers:['b1'],priceCeiling:30.000000000001});
  const belief=bot.buyers.get('b1');
  belief.updateOnSaleResult({props:{color:'red',handles:false}},'refused',undefined,30.000000000001);
  assert.ok(belief.hypotheses.find(x=>x.key==='red:0').pMaxHi>=30.615);
});

test('отложенный зонд не мешает альтернативной подтверждённой продаже',()=>{
  const bot=new DelayBot({buyers:['b'],priceCeiling:100,horizon:100});
  const b={buyerId:'b',evaluateRobot:p=>({prob2Match:1,expected2MatchPrice:p.color==='red'?70:60,min2MatchPrice:44.1})};
  const red={id:'r',props:{color:'red',handles:false}},blue={id:'u',props:{color:'blue',handles:false}};
  bot.confirmed.add('b|blue:false');bot.firstSeen.set('r',10);bot.firstSeen.set('u',10);
  assert.equal(bot.planBestOffers(10,90,10,[red,blue],[b])[0]?.itemId,'u');
});

test('S11 восстанавливает проданный item и не меняет подтверждения при повторе seq',()=>{
  const bot=new DelayBot({buyers:['b'],priceCeiling:100,horizon:100});
  bot.lastOfferItems.set('b#r',{id:'r',kind:'robot',props:{color:'red',handles:false}});
  const state={storage:{items:[],free:12},machines:[],buyers:[{id:'b',cooldownUntil:18}]};
  bot.handleEvent({seq:1,t:10,event:{type:'sale_result',buyerId:'b',itemId:'r',outcome:'sold',price:62},state,report:[]});
  assert.ok(bot.confirmed.has('b|red:false'));
  bot.handleEvent({seq:1,t:10,event:{type:'sale_result',buyerId:'b',itemId:'r',item:{props:{color:'blue',handles:false}},outcome:'sold',price:62},state,report:[]});
  assert.ok(!bot.confirmed.has('b|blue:false'));
});

test('независимый худший дециль учитывает новые потери кандидата',()=>{
  const rows=Array.from({length:10},(_,i)=>({base:{profit:i===0?0:100},cand:{profit:i===9?-100:100}}));
  const r=worstDeciles(rows);assert.equal(r.baseMean,0);assert.equal(r.candidateMean,-100);assert.equal(r.pairedCandidateMean,100);
});

test('без полного HTTP-замера критерий времени остаётся непроверенным',()=>{
  assert.equal(validateHttpEvidence(null,{candidateHash:'x',timeout:2000}).status,'unverified');
  const worlds=[{invalid:0,errors:0,timeouts:0,stopReason:null}];
  assert.equal(validateHttpEvidence({source:'http',candidateHash:'x',timeout:2000,count:10,p99:20,max:2001,hashes:{a:'1'},worlds},{candidateHash:'x',timeout:2000,hashes:{a:'1'}}).status,'fail');
  assert.equal(validateHttpEvidence({source:'http',candidateHash:'wrong',timeout:2000,count:10,p99:20,max:30,hashes:{a:'1'},worlds},{candidateHash:'x',timeout:2000,hashes:{a:'1'}}).status,'unverified');
  assert.equal(validateHttpEvidence({source:'http',candidateHash:'x',timeout:2000,count:10,p99:20,max:30,hashes:{a:'old'},worlds},{candidateHash:'x',timeout:2000,hashes:{a:'new'}}).status,'unverified');
  assert.equal(validateHttpEvidence({source:'http',candidateHash:'x',timeout:2000,count:10,p99:20,max:30,hashes:{a:'1'},worlds},{candidateHash:'x',timeout:2000,hashes:{a:'1'},candidateDependencies:['different-planner']}).status,'unverified');
  assert.equal(validateHttpEvidence({source:'http',candidateHash:'x',timeout:2000,count:10,p99:20,max:30,hashes:{a:'1'},worlds},{candidateHash:'x',timeout:2000,hashes:{a:'1'},candidatePath:'experiments/candidate.mjs',deployedPath:'src/bot.mjs'}).status,'unverified');
});

test('граф хэшей включает импорт планировщика архивной S04',()=>{
  assert.ok(moduleGraph('experiments/s04-bot.mjs').includes('experiments/s04-planner.mjs'));
});

test('закрытый финал и существующий файл отклоняются до запуска',()=>{
  assert.throws(()=>assertExperimentAllowed({set:'final',outputExists:false,finalUsed:true}),/финал/i);
  assert.throws(()=>assertExperimentAllowed({set:'tune',outputExists:true,finalUsed:false}),/существует/i);
});
