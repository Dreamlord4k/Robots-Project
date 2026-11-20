import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JointBuyer, GridBuyer } from '../experiments/next/buyer-model.mjs';
import { FactoryBot, GridBot } from '../experiments/next/s08-bot.mjs';
import { ArenaEmulator } from '../src/engine.mjs';
import { predictOffer, coverage } from '../experiments/next/s08-metrics.mjs';
const robot=(color='red',handles=false)=>({id:'r',kind:'robot',props:{color,handles}});
for (const Model of [JointBuyer,GridBuyer]) {
  test(`${Model.name}: произведение сохраняет наблюдение и совместимые параметры`,()=>{
    const b=new Model('b',80);b.observe({item:robot(),outcome:'sold',price:27});
    const h=b.hypotheses.find(x=>x.key==='red:1');
    assert.ok(h.possible && h.productLo<=27/0.98 && h.productHi>=27/1.02);
    const estimates=b.priceScenarios(robot().props);
    assert.ok(estimates.length && estimates.every(x=>Number.isFinite(x.price)&&x.weight>=0));
    const estimate=b.evaluateRobot(robot().props);assert.ok(estimate.expected1MatchPrice>=26 && estimate.expected1MatchPrice<=28);
  });
  test(`${Model.name}: cooldown, неизвестный порог и противоречие не портят модель`,()=>{
    const b=new Model('b',80);b.observe({item:robot(),outcome:'sold',price:62});const before=structuredClone(b.hypotheses);
    b.observe({item:robot(),outcome:'refused',reason:'cooldown',minPrice:44});
    b.observe({item:robot(),outcome:'refused',reason:'below_min_price'});
    b.observe({item:robot(),outcome:'sold',price:1000});
    assert.deepEqual(b.hypotheses,before);
  });
  test(`${Model.name}: нулевая продажа, непрерывные параметры и потолок`,()=>{
    const b=new Model('b',80);b.observe({item:robot(),outcome:'sold',price:0});assert.ok(b.hypotheses.find(h=>h.key==='blue:1').possible);
    const c=new Model('c',80); c.observe({item:robot(),outcome:'sold',price:27.37});
    const h=c.hypotheses.find(h=>h.key==='red:1');assert.ok(h.possible && h.productLo<=27.37/0.98 && h.productHi>=27.37/1.02);
    const trueP=64.4,trueF=0.425,trueProduct=trueP*trueF;
    assert.ok(h.pMaxLo<=trueP&&h.pMaxHi>=trueP&&h.fLo<=trueF&&h.fHi>=trueF&&h.productLo<=trueProduct&&h.productHi>=trueProduct);
    assert.ok(new Model('z',0).priceScenarios(robot().props).every(s=>s.price<=0));
  });
}

for(const Bot of [FactoryBot,GridBot]) test(`${Bot.name}: необязательный item, повтор seq и изоляция прогонов`,()=>{
  const start={...new ArenaEmulator().getStartPayload(),buyers:['b1']};
  const a=new Bot(start),b=new Bot(start),item=robot();
  const state=items=>({storage:{capacity:12,free:12-items.length,items},machines:start.machines.map(m=>({id:m.id,busyUntil:null})),buyers:[{id:'b1',cooldownUntil:null}]});
  const offered=a.handleEvent({seq:1,t:5,event:{type:'idle'},state:state([item]),report:[]});
  assert.ok(offered.some(c=>c.type==='offer'));
  const msg={seq:2,t:5,event:{type:'sale_result',buyerId:'b1',itemId:'r',outcome:'sold',price:62},state:state([]),report:[]};
  a.handleEvent(msg);const history=a.buyers.get('b1').history.length;assert.equal(history,1);
  a.handleEvent(msg);assert.equal(a.buyers.get('b1').history.length,history);
  assert.equal(b.buyers.get('b1').history.length,0);
});

for(const Bot of [FactoryBot,GridBot]) test(`${Bot.name}: отклонённая команда не создаёт наблюдения`,()=>{
  const start={...new ArenaEmulator().getStartPayload(),buyers:['b1']}, bot=new Bot(start), item=robot();
  const state=items=>({storage:{capacity:12,free:12-items.length,items},machines:start.machines.map(m=>({id:m.id,busyUntil:null})),buyers:[{id:'b1',cooldownUntil:null}]});
  const commands=bot.handleEvent({seq:1,t:5,event:{type:'idle'},state:state([item]),report:[]});
  const idx=commands.findIndex(c=>c.type==='offer');assert.ok(idx>=0);
  bot.handleEvent({seq:2,t:5,event:{type:'idle'},state:state([]),report:[{cmd:idx,ok:false,reason:'no_such_robot'}]});
  bot.handleEvent({seq:3,t:6,event:{type:'sale_result',buyerId:'b1',itemId:'r',outcome:'sold',price:62},state:state([]),report:[]});
  assert.equal(bot.buyers.get('b1').history.length,0);
});

test('прогноз метрик считает вероятность порога и цену условно при продаже',()=>{
  const model={priceScenarios:()=>[{price:50,weight:1}]};
  const prediction=predictOffer(model,robot().props,50);
  assert.ok(prediction.saleProbability>0.49&&prediction.saleProbability<0.51);
  assert.ok(prediction.expectedSoldPrice>50&&prediction.expectedSoldPrice<51);
});

test('офлайн покрытие отличает отдельные интервалы от ограничения произведения',()=>{
  const h={possible:true,color:'red',handles:false,pMaxLo:50,pMaxHi:70,fLo:0.3,fHi:0.6,productLo:29,productHi:31};
  const actual=coverage(new Map([['b',{hypotheses:[h]}]]),[{id:'b',sample:{color:'red',handles:false},pMax:60,f:0.4}]);
  assert.deepEqual(actual,{buyers:1,typeCovered:1,parametersCovered:1,productCovered:0});
});
