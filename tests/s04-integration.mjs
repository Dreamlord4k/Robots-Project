import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FactoryBot } from '../src/bot.mjs';
import { ArenaEmulator } from '../src/engine.mjs';
const start=new ArenaEmulator().getStartPayload();
const state=items=>({storage:{capacity:12,free:12-items.length,items},machines:start.machines.map(m=>({id:m.id,busyUntil:null})),buyers:start.buyers.map(id=>({id,cooldownUntil:null}))});

test('не закупает сырьё без оборудования',()=>{
  const bot=new FactoryBot({...start,machines:[]});
  const payload={seq:1,t:10,event:{type:'supply',item:{id:'s',kind:'sheet',props:{}}},state:{...state([]),machines:[]},report:[]};
  assert.ok(!bot.handleEvent(payload).some(c=>c.type==='accept'));
});

test('недостаток бюджета отключает только производство, сохраняя доступную продажу и повтор seq',()=>{
  const bot=new FactoryBot(start,{timeBudgetMs:0});
  const items=[{id:'r',kind:'robot',props:{color:'red',handles:false}},{id:'s',kind:'sheet',props:{}},{id:'c',kind:'control',props:{}}];
  const payload={seq:1,t:10,event:{type:'idle'},state:state(items),report:[]};
  const commands=bot.handleEvent(payload);
  assert.ok(commands.some(c=>c.type==='offer'));
  assert.ok(!commands.some(c=>c.type==='start'));
  assert.deepEqual(bot.plannerStats, { calls: 1, exhausted: 1 });
  assert.deepEqual(bot.handleEvent(payload),commands);
});

test('неполный набор станков отключает только недоступное производство, но сохраняет продажу',()=>{
  const partialStart={...start,machines:start.machines.filter(m=>m.id!=='m-cut')};
  const bot=new FactoryBot(partialStart,{timeBudgetMs:100});
  const items=[{id:'r',kind:'robot',props:{color:'red',handles:false}}];
  const partialState={...state(items),machines:partialStart.machines.map(m=>({id:m.id,busyUntil:null}))};
  const commands=bot.handleEvent({seq:1,t:10,event:{type:'idle'},state:partialState,report:[]});
  assert.ok(commands.some(c=>c.type==='offer'));
  assert.ok(commands.every(c=>c.type!=='start'||partialStart.machines.some(m=>m.id===c.machineId)));
});

test('полный прогон планировщика сохраняет допустимость и производит продажи',()=>{
  const arena=new ArenaEmulator({seed:1013,horizon:120});
  const result=arena.runFullShift(new FactoryBot(arena.getStartPayload(),{timeBudgetMs:100}));
  assert.equal(result.invalidCommands.length,0);
  assert.equal(result.errors,0);
  assert.equal(result.timeouts,0);
  assert.ok(result.robotsSold>0);
});

test('приём sheet около конца смены учитывает реальные длительности операций',()=>{
  const machines=structuredClone(start.machines);
  for (const machine of machines) for (const op of machine.ops) op.duration=1;
  const cfg={...start,horizon:100,machines};
  const bot=new FactoryBot(cfg,{timeBudgetMs:100});
  const control={id:'c',kind:'control',props:{}};
  const items=[control];
  const payload={seq:1,t:96,event:{type:'supply',item:{id:'s',kind:'sheet',props:{}},price:4},state:state(items),report:[]};
  const commands=bot.handleEvent(payload);
  assert.ok(commands.some(c=>c.type==='accept'&&c.itemId==='s'));
  assert.ok(commands.some(c=>c.type==='start'&&c.machineId==='m-cut'&&c.itemIds[0]==='s'));
});
