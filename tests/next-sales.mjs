import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOffer, rankSaleActions } from '../experiments/next/sale-policy.mjs';

const robot=(id,color='red')=>({id,kind:'robot',props:{color,handles:false}});
const buyer=(id,color,price,cooldownUntil=0)=>({buyerId:id,cooldownUntil,priceCeiling:100,hypotheses:[{possible:true,color,handles:false,pMaxLo:price,pMaxHi:price,fLo:0.5,fHi:0.5}]});
const start={horizon:100,offerFee:1,buyerCooldown:8,priceCeiling:100,storageFee:{robot:0.5}};

test('учитывает нулевую ступень, порог, комиссию и потолок',()=>{
  const b=buyer('b','blue',60);
  assert.deepEqual([evaluateOffer({belief:b,props:robot('r','red').props,minPrice:0,t:0,horizon:100,offerFee:1}).saleProbability,evaluateOffer({belief:b,props:robot('r','red').props,minPrice:50,t:0,horizon:100,offerFee:1}).saleProbability],[1,0]);
  const zero=buyer('z','red',0);zero.priceCeiling=0;
  const result=evaluateOffer({belief:zero,props:robot('r').props,minPrice:0,t:0,horizon:100,offerFee:2});
  assert.equal(result.expectedRevenue,0);assert.equal(result.saleProbability,1);assert.equal(result.immediateNet,-2);
});

test('учитывает шум, пересечение ценовых уровней и недоступного покупателя',()=>{
  const b=buyer('b','red',45);
  const x=evaluateOffer({belief:b,props:robot('r').props,minPrice:45,t:0,horizon:100,offerFee:1});
  assert.ok(x.saleProbability>0&&x.saleProbability<1);assert.ok(x.expectedRevenue>0&&x.expectedRevenue<45);
  b.cooldownUntil=4;assert.equal(evaluateOffer({belief:b,props:robot('r').props,minPrice:0,t:0,horizon:100,offerFee:1}).available,false);
});

test('предположение о шуме влияет на прогноз порога',()=>{
  const args={belief:buyer('b','red',45),props:robot('r').props,minPrice:45.2,t:0,horizon:100};
  assert.equal(evaluateOffer({...args,noise:0}).saleProbability,0);
  assert.ok(evaluateOffer({...args,noise:0.02}).saleProbability>0);
});

test('пересечение ступеней не гарантирует продажу по порогу 45',()=>{
  const hypotheses=[{possible:true,color:'red',handles:false,pMaxLo:45,pMaxHi:45,fLo:0.6,fHi:0.6},{possible:true,color:'blue',handles:false,pMaxLo:75,pMaxHi:75,fLo:0.6,fHi:0.6}];
  const x=evaluateOffer({belief:{hypotheses,priceCeiling:100},props:robot('r').props,minPrice:45,t:0,horizon:100,offerFee:1});
  assert.ok(x.saleProbability>0&&x.saleProbability<1);
  assert.ok(x.expectedRevenue>0&&x.expectedRevenue<45);
});

test('лучший робот в конце склада попадает в выбор, роботы и покупатели не повторяются',()=>{
  const items=[...Array.from({length:6},(_,i)=>robot(`x${i}`,'blue')),robot('best')];
  const actions=rankSaleActions({items,buyers:[buyer('b','red',70)],start,t:10});
  assert.equal(actions[0]?.itemId,'best');assert.equal(new Set(actions.map(x=>x.itemId)).size,actions.length);assert.equal(new Set(actions.map(x=>x.buyerId)).size,actions.length);
});

test('может ждать дорогого покупателя и продавать ближе к концу',()=>{
  const buyers=[buyer('cheap','blue',45),buyer('later','red',70,12)];
  assert.deepEqual(rankSaleActions({items:[robot('r')],buyers,start,t:10}),[]);
  assert.ok(rankSaleActions({items:[robot('r')],buyers:[buyers[0]],start:{...start,horizon:10},t:10}).length);
  assert.deepEqual(rankSaleActions({items:[robot('r')],buyers:[buyers[0]],start:{...start,offerFee:100},t:10}),[]);
});

test('параллельные предложения не используют предметы и покупателей повторно',()=>{
  const items=[robot('r'),robot('b','blue')];
  const actions=rankSaleActions({items,buyers:[buyer('red','red',70),buyer('blue','blue',65)],start,t:10});
  assert.equal(actions.length,2);
  assert.equal(new Set(actions.map(x=>x.itemId)).size,actions.length);
  assert.equal(new Set(actions.map(x=>x.buyerId)).size,actions.length);
});
