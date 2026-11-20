import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, estimateQueue } from '../experiments/next/planner.mjs';
import { ArenaEmulator } from '../src/engine.mjs';
import { FactoryBot } from '../experiments/next/s09-bot.mjs';
import { planProduction as withoutPenalty } from '../experiments/next/s09-no-penalty-planner.mjs';
import { planProduction as withPenalty } from '../experiments/next/baseline/s04-planner.mjs';
const start={...new ArenaEmulator().getStartPayload(),horizon:100};
const buyer=id=>({buyerId:id,cooldownUntil:0,priceCeiling:80,hypotheses:[{possible:true,color:'red',handles:false,pMaxLo:60,pMaxHi:60,fLo:0.4,fHi:0.4}]});
const body=(id,color='red')=>({id,kind:'body',props:{color,handles:false}});
const robot=id=>({id,kind:'robot',props:{color:'red',handles:false}});
const control={id:'c',kind:'control',props:{}};
const state=items=>({storage:{free:12-items.length,items},machines:start.machines.map(m=>({id:m.id,busyUntil:null}))});

test('один покупатель не может одновременно купить двух роботов',()=>{
  const one=estimateQueue({robots:[{...robot('a'),readyAt:95},{...robot('b'),readyAt:95}],buyers:[buyer('x')],t:95,horizon:100,start});
  const two=estimateQueue({robots:[{...robot('a'),readyAt:95},{...robot('b'),readyAt:95}],buyers:[buyer('x'),buyer('y')],t:95,horizon:100,start});
  assert.ok(two.value>one.value+30);
});

test('сборка резервирует предметы и станок, учитывает порядок входов из start',()=>{
  const cfg=structuredClone(start);const op=cfg.machines.find(m=>m.id==='m-assemble').ops[0];op.inputs.reverse();op.inherit=1;
  const result=plan({start:cfg,state:state([body('b'),control]),pending:[],beliefs:[buyer('x')],t:10,budget:{timeMs:1000,maxNodes:1000,now:()=>0}});
  assert.ok(result.commands.some(c=>c.machineId==='m-assemble'&&c.itemIds.join(',')==='c,b'));
  const ids=result.commands.flatMap(c=>c.itemIds);assert.equal(new Set(ids).size,ids.length);
  assert.equal(new Set(result.commands.map(c=>c.machineId)).size,result.commands.length);
});

test('не запускает занятый станок или маршрут за пределами горизонта',()=>{
  const s=state([body('b'),control]);s.machines.find(m=>m.id==='m-assemble').busyUntil=20;
  assert.ok(!plan({start,state:s,pending:[],beliefs:[buyer('x')],t:10,budget:{timeMs:1000,maxNodes:1000,now:()=>0}}).commands.some(c=>c.machineId==='m-assemble'));
  assert.ok(!plan({start,state:state([body('b'),control]),pending:[],beliefs:[buyer('x')],t:99,budget:{timeMs:1000,maxNodes:1000,now:()=>0}}).commands.some(c=>c.machineId==='m-assemble'));
});

test('станок с busyUntil равным текущему такту остаётся занятым в снимке',()=>{
  const s=state([body('b'),control]);s.machines.find(m=>m.id==='m-assemble').busyUntil=10;
  const r=plan({start,state:s,pending:[],beliefs:[buyer('x')],t:10,budget:{timeMs:1000,maxNodes:1000,now:()=>0}});
  assert.ok(!r.commands.some(c=>c.machineId==='m-assemble'));
});

test('пустой бюджет возвращает допустимый запасной план',()=>{
  const r=plan({start,state:state([body('b'),control]),pending:[],beliefs:[buyer('x')],t:10,budget:{maxNodes:0,timeMs:0}});
  assert.deepEqual(r.commands,[]);assert.equal(r.exhausted,true);
});

test('ограничение посреди поиска сохраняет только допустимые начальные команды',()=>{
  const r=plan({start,state:state([body('b'),body('d'),control]),pending:[],beliefs:[buyer('x')],t:10,budget:{maxNodes:2,timeMs:1000,now:()=>0}});
  assert.equal(r.exhausted,true);
  assert.ok(r.commands.length>0);
  assert.ok(r.commands.every(c=>c.itemIds.every(id=>['b','c','d'].includes(id))));
  assert.equal(new Set(r.commands.flatMap(c=>c.itemIds)).size,r.commands.flatMap(c=>c.itemIds).length);
});

test('готовый результат занятого станка не выдаётся как существующий предмет',()=>{
  const r=plan({start,state:state([control]),pending:[{kind:'body',color:'red',handles:false,finishTick:12}],beliefs:[buyer('x')],t:10,budget:{maxNodes:1000,timeMs:1000,now:()=>0}});
  assert.ok(r.commands.every(c=>c.itemIds.every(id=>id==='c')));
});

test('на полном складе разрешает сборку без повторного расхода предметов',()=>{
  const items=[body('b'),control,...Array.from({length:10},(_,i)=>({id:`z${i}`,kind:'sheet',props:{}}))];
  const r=plan({start,state:state(items),pending:[],beliefs:[buyer('x')],t:10,budget:{maxNodes:1000,timeMs:1000,now:()=>0}});
  assert.ok(r.commands.some(c=>c.machineId==='m-assemble'));
  assert.equal(new Set(r.commands.flatMap(c=>c.itemIds)).size,r.commands.flatMap(c=>c.itemIds).length);
});

test('прогон по нескольким мирам не выдаёт недопустимых команд',()=>{
  for(const seed of [3040013,3041026,3042039]){
    const arena=new ArenaEmulator({seed,horizon:100});const r=arena.runFullShift(new FactoryBot(arena.getStartPayload()));
    assert.deepEqual(r.invalidCommands,[]);assert.equal(r.errors,0);assert.equal(r.timeouts,0);
  }
});

test('абляция убирает только штраф за копии в прежнем планировщике',()=>{
  const items=[body('b'),control,robot('r1'),robot('r2'),robot('r3')];
  const fakeBuyer={cooldownUntil:0,evaluateRobot:()=>({prob2Match:1,expected2MatchPrice:60})};
  const args={start,items,machines:state(items).machines,freeSlots:7,t:10,horizon:100,buyers:[fakeBuyer],timeBudgetMs:1000,maxCandidates:1000,now:()=>0};
  assert.ok(!withPenalty(args).commands.some(c=>c.machineId==='m-assemble'));
  assert.ok(withoutPenalty(args).commands.some(c=>c.machineId==='m-assemble'));
});

test('отклонённая команда освобождает локальный станок и повтор seq идемпотентен',()=>{
  const bot=new FactoryBot(start,{timeBudgetMs:100});
  const items=[body('b'),control];const s={...state(items),buyers:[{id:'b1',cooldownUntil:null}]};
  const first={seq:1,t:10,event:{type:'idle'},state:s,report:[]};
  const commands=bot.handleEvent(first), index=commands.findIndex(c=>c.type==='start');
  assert.ok(index>=0);assert.deepEqual(bot.handleEvent(first),commands);
  const m=commands[index].machineId;
  bot.handleEvent({seq:2,t:10,event:{type:'idle'},state:s,report:[{cmd:index,ok:false,reason:'bad_inputs'}]});
  assert.ok(bot.previousCommands.some(c=>c.type==='start'&&c.machineId===m));
});
