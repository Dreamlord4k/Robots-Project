import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSupply, decideBridgeSupply, shouldLiquidate } from '../experiments/next/supply-policy.mjs';
import { ArenaEmulator } from '../src/engine.mjs';
import { BridgeBot, DynamicLiquidationBot } from '../experiments/next/s10-bot.mjs';
const start={...new ArenaEmulator().getStartPayload(),horizon:100};
const sheet={id:'s',kind:'sheet',props:{}}, control={id:'c',kind:'control',props:{}}, body={id:'b',kind:'body',props:{color:'red',handles:false}};
const state=items=>({storage:{free:12-items.length,items},machines:start.machines.map(m=>({id:m.id,busyUntil:null}))});
const buyer={buyerId:'b',cooldownUntil:0,evaluateRobot:()=>({prob2Match:1,expected2MatchPrice:60,prob1Match:0,expected1MatchPrice:0})};

test('цена покупки сравнивается с приростом стоимости продолжения',()=>{
  const continuationValue=({items})=>items.some(i=>i.id==='s')?20:0;
  assert.equal(decideSupply({item:sheet,price:5,state:state([]),start,t:10,continuationValue}).accept,true);
  assert.equal(decideSupply({item:sheet,price:25,state:state([]),start,t:10,continuationValue}).accept,false);
});

test('учитывает корпус на станке и фактическую длительность сборки',()=>{
  const result=decideSupply({item:control,price:3,state:state([]),start,pending:[{kind:'body',color:'red',handles:false,finishTick:12}],beliefs:[buyer],t:10});
  assert.equal(result.accept,true);
  const late=decideSupply({item:control,price:3,state:state([]),start,pending:[{kind:'body',color:'red',handles:false,finishTick:99}],beliefs:[buyer],t:10});
  assert.equal(late.accept,false);
});

test('дорогой control не покупается при известном малом доходе',()=>{
  const result=decideSupply({item:control,price:100,state:state([body]),start,beliefs:[buyer],t:10,budget:{timeMs:100}});
  assert.equal(result.accept,false);
});

test('нет вымышленной резки и нельзя принять поставку на полный склад',()=>{
  const noCut={...start,machines:start.machines.filter(m=>m.id!=='m-cut')};
  assert.equal(decideSupply({item:sheet,price:4,state:state([control]),start:noCut,beliefs:[buyer],t:10}).accept,false);
  const full=state([body]);full.storage.free=0;
  assert.equal(decideSupply({item:control,price:3,state:full,start,beliefs:[buyer],t:10}).accept,false);
  full.storage.free=1;
  assert.equal(decideSupply({item:control,price:3,state:full,start,beliefs:[buyer],t:10}).accept,true);
});

test('последний маршрут успевает завершиться и продать робота',()=>{
  assert.equal(decideSupply({item:control,price:3,state:state([body]),start,beliefs:[buyer],t:97}).accept,true);
  assert.equal(decideSupply({item:control,price:3,state:state([body]),start,beliefs:[buyer],t:98}).accept,false);
});

test('распродажа зависит от числа роботов и доступных окон покупателей',()=>{
  const buyers=[{cooldownUntil:0}];
  assert.equal(shouldLiquidate({t:95,horizon:100,buyers,robots:[{id:'r'}],pending:[],buyerCooldown:8}),true);
  assert.equal(shouldLiquidate({t:10,horizon:100,buyers,robots:[{id:'r'}],pending:[],buyerCooldown:8}),false);
});

test('гипотеза поставки отдельно усредняет интервалы 2–4 и требует наблюдённую цену',()=>{
  const args={item:sheet,price:4,state:state([]),start,beliefs:[buyer],t:10};
  assert.equal(decideSupply(args).accept,false);
  assert.equal(decideBridgeSupply({...args,complementPrice:3}).accept,true);
  assert.equal(decideBridgeSupply({...args,complementPrice:null}).accept,false);
  assert.equal(decideBridgeSupply({...args,t:98,complementPrice:3}).accept,false);
});

test('прогноз учитывает повторное предложение разным покупателям после отказа',()=>{
  const uncertain=Array.from({length:4},(_,i)=>({buyerId:`b${i}`,cooldownUntil:0,evaluateRobot:()=>({prob2Match:1/6,expected2MatchPrice:60,prob1Match:0.5,expected1MatchPrice:27})}));
  const result=decideBridgeSupply({item:sheet,price:4,state:state([]),start,beliefs:uncertain,t:10,complementPrice:3,budget:{timeMs:100}});
  assert.equal(result.accept,true);
});

test('при нехватке времени вычислений покупка безопасно отклоняется',()=>{
  const result=decideSupply({item:control,price:3,state:state([body]),start,beliefs:[buyer],t:10,budget:{timeMs:0}});
  assert.equal(result.accept,false);assert.equal(result.reason,'budget_exhausted');
});

test('цены поставок изолированы между экземплярами бота',()=>{
  const a=new BridgeBot(start),b=new BridgeBot(start);
  const payload={seq:1,t:2,event:{type:'supply',item:control,price:3},state:{...state([]),buyers:[]},report:[]};
  a.handleEvent(payload);a.handleEvent(payload);
  assert.equal(a.observedPrices.get('control'),3);assert.equal(b.observedPrices.has('control'),false);
});

test('распродажа делает доступной низкую ступень в последнем окне',()=>{
  const bot=new DynamicLiquidationBot({...start,buyers:['b']});
  const low={buyerId:'b',cooldownUntil:0,evaluateRobot:()=>({prob2Match:0,prob1Match:1,expected1MatchPrice:25,expectedPrice:25})};
  bot.buyers.set('b',low);
  const offers=bot.planBestOffers(95,5,10,[{id:'r',kind:'robot',props:{color:'red',handles:false}}],[low]);
  assert.equal(offers[0]?.minPrice,13);
});
