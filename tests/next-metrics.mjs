import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldMetrics } from '../experiments/metrics.mjs';

test('поставки считаются по фактическому report и цене события', () => {
  const m=new WorldMetrics();
  m.onEvent({t:3,event:{type:'supply',item:{id:'s',kind:'sheet'},price:4}},1);
  m.onCommands([{type:'accept',itemId:'s'}],[{ok:true}]);
  m.onEvent({t:4,event:{type:'supply',item:{id:'c',kind:'control'},price:3}},1);
  m.onCommands([],[]);
  assert.deepEqual(m.finish({},[]).supplies,{accepted:1,skipped:1,acceptedCost:4,skippedCost:3});
});

test('простои классифицируются как наблюдаемые признаки и остаток включает обработку',()=>{
  const m=new WorldMetrics();
  m.onTick({t:1,items:[],machines:{'m-paint':{busy:false},'m-assemble':{busy:false}}});
  const out=m.finish({},[],{'m-cut':{busy:true,finishAt:5}});
  assert.equal(out.idleReasons['m-paint'].noBody,1);
  assert.equal(out.idleReasons['m-assemble'].noControl,1);
  assert.equal(out.inFlight,1);
});

test('считает расходы по третям смены и ступени продаж после завершения',()=>{
  const start={horizon:8,storageFee:{robot:0.5},offerFee:2,machines:[{id:'m',ops:[{id:'op',cost:3}]}]};
  const m=new WorldMetrics(start);
  m.onEvent({t:0,event:{type:'supply',item:{id:'s',kind:'sheet'},price:4},state:{}},1);
  m.onCommands([{type:'accept',itemId:'s'},{type:'start',machineId:'m',opId:'op'},{type:'offer',buyerId:'b',itemId:'r'}],[{ok:true},{ok:true},{ok:true}]);
  m.onTick({t:0,items:[{kind:'robot'}],machines:{}});
  m.onEvent({t:4,event:{type:'sale_result',buyerId:'b',item:{props:{color:'red',handles:false}},outcome:'sold',price:30},state:{}},1);
  m.onCommands([],[]);
  const out=m.finish({buyersSecret:[{id:'b',sample:{color:'red',handles:true}}]},[]);
  assert.deepEqual(out.costByThird[0],{purchases:4,operations:3,offers:2,storage:0.5});
  assert.deepEqual(out.salesByMatch,{zero:0,one:1,two:0,unavailable:0});
});

test('фиксирует признаки перегрузки, занятых покупателей и лимита поиска',()=>{
  const m=new WorldMetrics({horizon:10});
  m.onEvent({t:5,event:{type:'idle'},state:{storage:{free:0,items:[{kind:'robot'}]},buyers:[{id:'b',cooldownUntil:8}]}},1);
  m.onDecision({exhausted:true});
  m.onCommands([],[]);
  assert.equal(m.decisionSignals.fullStorage,1);
  assert.equal(m.decisionSignals.robotsAllBuyersBusy,1);
  assert.equal(m.decisionSignals.searchExhausted,1);
  assert.equal(m.decisionSignals.noProductionCommand,1);
});

test('учитывает стоимость незавершённой операции и готового остатка без комиссий',()=>{
  const m=new WorldMetrics({horizon:8,machines:[{id:'m',ops:[{id:'op',cost:3}]}]});
  m.onEvent({t:0,event:{type:'supply',item:{id:'s',kind:'sheet'},price:4},state:{}},0);
  m.onCommands([{type:'accept',itemId:'s'},{type:'start',machineId:'m',opId:'op',itemIds:['s']}],[{ok:true},{ok:true}]);
  assert.equal(m.finish({},[],{m:{busy:true,currentOp:{opId:'op',outputItem:{id:'out',kind:'body'}}}}).remainingInvestment.inFlight,7);
  m.onEvent({t:2,event:{type:'machine_done',machineId:'m',item:{id:'out',kind:'body'}},state:{}},0);
  m.onCommands([],[]);
  const balance=m.finish({},[{id:'out',kind:'body'}],{}).remainingInvestment;
  assert.deepEqual(balance,{storage:7,inFlight:0,unknownStorage:0,unknownInFlight:0});
});
