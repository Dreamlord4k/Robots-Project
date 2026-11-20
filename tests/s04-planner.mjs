import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planProduction } from '../src/s04-planner.mjs';
import { ArenaEmulator } from '../src/engine.mjs';
const start = new ArenaEmulator().getStartPayload();
const body = (id, color, handles = false) => ({ id, kind:'body', props:{color,handles} });
const control = { id:'c', kind:'control', props:{} };
const make = (items, opts={}) => ({ start, items, t:10, horizon:100, freeSlots:12-items.length, machines:start.machines.map(m=>({id:m.id,busyUntil:null})), buyers:[{cooldownUntil:0,evaluateRobot:r=>({expectedPrice:r.color==='blue'?70:40})}], maxCandidates:200, timeBudgetMs:1000, now:()=>0, ...opts });

test('сборка выбирает наиболее ценный корпус и не использует предмет дважды', () => {
  const result=planProduction(make([body('red','red'),body('blue','blue'),control]));
  const assembly=result.commands.find(c=>c.machineId==='m-assemble');
  assert.deepEqual(assembly.itemIds,['blue','c']);
  const ids=result.commands.flatMap(c=>c.itemIds);
  assert.equal(new Set(ids).size,ids.length);
});

test('покраска использует фактическую длительность и доступность покупателя', () => {
  const later=planProduction(make([body('raw',null),control],{t:90,horizon:95}));
  assert.ok(!later.commands.some(c=>c.machineId==='m-paint'));
  const ready=planProduction(make([body('raw',null),control]));
  assert.ok(ready.commands.some(c=>c.opId==='paint-blue'));
  const noBuyer=planProduction(make([body('raw',null),control],{buyers:[{cooldownUntil:200,evaluateRobot:()=>({expectedPrice:70})}]}));
  assert.deepEqual(noBuyer.commands,[]);
});

test('резерв склада и занятый станок не нарушаются', () => {
  const items=[body('raw',null),control];
  const busy=start.machines.map(m=>({id:m.id,busyUntil:m.id==='m-paint'?15:null}));
  const result=planProduction(make(items,{freeSlots:0,machines:busy}));
  assert.ok(!result.commands.some(c=>c.machineId==='m-paint'));
  assert.ok(result.commands.every(c=>c.itemIds.every(id=>items.some(item=>item.id===id))));
});

test('без control не планирует сборку, но может обработать имеющийся корпус', () => {
  const result=planProduction(make([body('raw',null)]));
  assert.ok(!result.commands.some(c=>c.machineId==='m-assemble'));
  assert.ok(result.commands.some(c=>c.machineId==='m-paint'));
});

test('при исчерпании бюджета возвращает безопасный пустой план', () => {
  assert.deepEqual(planProduction(make([body('raw',null),control],{maxCandidates:0})),{commands:[],exhausted:true});
  assert.deepEqual(planProduction(make([body('raw',null),control],{timeBudgetMs:0})),{commands:[],exhausted:true});
});

test('порядок входов сборки берётся из start, включая control первым', () => {
  const machines = structuredClone(start.machines);
  const op = machines.find(m=>m.id==='m-assemble').ops[0];
  op.inputs.reverse();
  op.inherit = 1;
  const custom = {...start, machines};
  const result=planProduction(make([body('blue','blue'),control],{start:custom}));
  assert.deepEqual(result.commands.find(c=>c.machineId==='m-assemble').itemIds,['c','blue']);
  const chain=planProduction(make([body('raw',null),control],{start:custom}));
  assert.ok(chain.commands.some(c=>c.opId==='paint-blue'));
});

test('укороченная операция из start делает маршрут выполнимым у конца смены', () => {
  const machines=structuredClone(start.machines);
  for (const op of machines.find(m=>m.id==='m-paint').ops) op.duration=1;
  const result=planProduction(make([body('raw',null),control],{start:{...start,machines},t:90,horizon:95}));
  assert.ok(result.commands.some(c=>c.opId==='paint-blue'));
});

test('ограничивает оценку покупателей при большом start', () => {
  let calls=0;
  const buyers=Array.from({length:200},()=>({cooldownUntil:0,evaluateRobot:()=>{calls++;return {expectedPrice:60};}}));
  const result=planProduction(make([body('blue','blue'),control],{buyers}));
  assert.ok(result.commands.some(c=>c.machineId==='m-assemble'));
  assert.ok(calls<=32);
});

test('прогноз учитывает суммарную выручку, включая ступень одного совпадения',()=>{
  const buyers=[{cooldownUntil:0,evaluateRobot:r=>r.color==='red'
    ? {expectedPrice:50,prob2Match:0,expected2MatchPrice:0}
    : {expectedPrice:10,prob2Match:0.5,expected2MatchPrice:10}}];
  const result=planProduction(make([body('red','red'),body('blue','blue'),control],{buyers}));
  assert.deepEqual(result.commands.find(c=>c.machineId==='m-assemble').itemIds,['red','c']);
});

test('лист допускается разрезать без прогноза будущей поставки control',()=>{
  const result=planProduction(make([{id:'s',kind:'sheet',props:{}}]));
  assert.ok(result.commands.some(c=>c.machineId==='m-cut'&&c.itemIds[0]==='s'));
});

test('учитывает готовые роботы и избегает перепроизводства одинаковых типов',()=>{
  const robots=['red','green','blue'].map((color,i)=>({id:`r${i}`,kind:'robot',props:{color,handles:false}}));
  const buyers=[{cooldownUntil:0,evaluateRobot:()=>({expectedPrice:60,prob2Match:1,expected2MatchPrice:60})}];
  const result=planProduction(make([...robots,body('raw',null),control],{buyers}));
  assert.ok(result.commands.some(c=>c.opId==='add-handles'));
});

test('частичное производство не запускается, если все покупатели недоступны до конца смены',()=>{
  const buyers=[{cooldownUntil:200,evaluateRobot:()=>({expectedPrice:60})}];
  const result=planProduction(make([{id:'s',kind:'sheet',props:{}}],{buyers,horizon:100}));
  assert.deepEqual(result.commands,[]);
});

test('сборка с control первым не штрафует собственный корпус как лишний запас',()=>{
  const machines=structuredClone(start.machines);
  const op=machines.find(m=>m.id==='m-assemble').ops[0];op.inputs.reverse();op.inherit=1;
  const buyers=[{cooldownUntil:0,evaluateRobot:()=>({expectedPrice:10,prob2Match:1/6,expected2MatchPrice:60})}];
  const result=planProduction(make([body('blue','blue'),control],{start:{...start,machines},buyers}));
  assert.deepEqual(result.commands.find(c=>c.machineId==='m-assemble')?.itemIds,['c','blue']);
});
