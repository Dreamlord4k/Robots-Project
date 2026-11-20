import { evaluateOffer } from './sale-policy.mjs';
import { planProduction as fallbackProduction } from './baseline/s04-planner.mjs';

const accepts=(req,item)=>item&&(!req.kind||req.kind===item.kind)&&Object.entries(req.props??{}).every(([k,v])=>v===null?item.props?.[k]==null:v==='*'?item.props?.[k]!=null:item.props?.[k]===v);
const output=(op,inputs)=>({kind:op.output.kind,props:{...(Number.isInteger(op.inherit)?inputs[op.inherit]?.props:{}),...(op.output.props??{})}});

// Ограниченная ветка успеха/отказа: покупатель занят после обоих исходов.
export function estimateQueue({robots,buyers,t,horizon,start,maxOffers=2,canContinue=()=>true}) {
  const fee=start.offerFee??1,storage=start.storageFee?.robot??0.5,cooldown=start.buyerCooldown??8;
  const initial=robots.slice(0,3).map(r=>({...r,readyAt:r.readyAt??t,attempts:0}));
  const bs=buyers.slice(0,4).map(b=>({buyer:b,available:b.cooldownUntil??t}));
  let explored=0;
  function branch(queue,people,depth) {
    if(!queue.length||depth>=maxOffers||!canContinue())return 0;
    explored++;const [robot,...rest]=queue;let best=0;
    for(let i=0;i<people.length;i++) {
      if(!canContinue())break;
      const entry=people[i],at=Math.max(t,robot.readyAt,entry.available);if(at>horizon)continue;
      const ev=entry.buyer.evaluateRobot?.(robot.props);
      const threshold=ev?.prob2Match>0?Math.min(start.priceCeiling??80,Math.max(43.5,Math.min(73,Math.floor(ev.min2MatchPrice*10)/10))):horizon-at<=18&&ev?.prob1Match>0.3&&ev.expected1MatchPrice>=15?Math.min(start.priceCeiling??80,13):null;
      // Синтетические тесты без evaluateRobot используют типичный высокий порог.
      const minPrice=threshold??(ev?null:Math.min(start.priceCeiling??80,43.5));if(minPrice===null)continue;
      const result=evaluateOffer({belief:{...entry.buyer,cooldownUntil:at},props:robot.props,minPrice,t:at,horizon,offerFee:fee});
      const next=people.map((b,j)=>j===i?{...b,available:at+cooldown}:b);
      const success=branch(rest,next,depth+1);
      const failed=robot.attempts<1?[...rest,{...robot,readyAt:at+1,attempts:robot.attempts+1}]:rest;
      const failure=branch(failed,next,depth+1);
      const value=result.immediateNet-storage*(at-robot.readyAt)+result.saleProbability*success+(1-result.saleProbability)*failure;
      best=Math.max(best,value);
    }
    return best;
  }
  return {value:branch(initial,bs,0),explored};
}

export function plan({start,state,pending=[],beliefs=[],t,budget={}}) {
  const now=budget.now??(()=>performance.now()),timeMs=budget.timeMs??1,maxNodes=budget.maxNodes??64,width=budget.width??3,depth=budget.depth??3;
  const empty={commands:[],exhausted:true,diagnostics:{nodes:0}};
  if(timeMs<=0||maxNodes<=0)return empty;
  const deadline=now()+timeMs;let nodes=0,exhausted=false;
  const within=()=>{if(nodes>=maxNodes||now()>=deadline){exhausted=true;return false;}return true;};
  const horizon=start.horizon??650;
  const ops=[];for(const m of (start.machines??[]).slice(0,32))for(const op of (m.ops??[]).slice(0,64))if(ops.length<64&&op?.id&&op.output?.kind&&Array.isArray(op.inputs)&&op.inputs.length>=1&&op.inputs.length<=2&&Number.isFinite(op.duration)&&op.duration>0)ops.push({machineId:m.id,op});
  const machineTimes=new Map((state.machines??[]).map(m=>[m.id,m.busyUntil==null?t:Math.max(t+1,m.busyUntil)]));
  const items=(state.storage?.items??[]).slice(0,64).map(item=>({...item,props:{...item.props},readyAt:t}));
  for(const [i,p] of pending.slice(0,32).entries()) if(p.kind&&Number.isFinite(p.finishTick)&&p.finishTick<=horizon)items.push({id:`pending-${i}`,kind:p.kind,props:{color:p.color??p.props?.color,handles:Boolean(p.handles??p.props?.handles)},readyAt:p.finishTick});
  const initial={items,machineTimes,free:state.storage?.free??0,commands:[],cost:0,storage:0};
  const queueValue=s=>estimateQueue({robots:s.items.filter(i=>i.kind==='robot').sort((a,b)=>a.readyAt-b.readyAt),buyers:beliefs,t,horizon,start,canContinue:within}).value;
  const penalty=s=>{if(budget.mode!=='queue-fixed')return 0;const counts=new Map();for(const i of s.items)if((i.kind==='body'||i.kind==='robot')&&i.props?.color){const k=`${i.props.color}:${Boolean(i.props.handles)}`;counts.set(k,(counts.get(k)??0)+1);}return [...counts.values()].reduce((sum,n)=>sum+Math.max(0,n-1)*20,0);};
  const base=queueValue(initial),basePenalty=penalty(initial);let beam=[initial],best=initial,bestScore=0;
  const maxWidth=Math.max(1,Math.min(width,16)),maxDepth=Math.max(1,Math.min(depth,4));
  for(let step=0;step<maxDepth&&within();step++) {
    const candidates=[];
    for(const current of beam)for(const {machineId,op} of ops){
      if(!within())break;
      const first=current.items.filter(i=>accepts(op.inputs[0],i)).slice(0,8);
      for(const a of first){const seconds=op.inputs.length===1?[null]:current.items.filter(i=>i.id!==a.id&&accepts(op.inputs[1],i)).slice(0,4);
        for(const b of seconds){if(!within())break;nodes++;
          const inputs=b?[a,b]:[a],begin=Math.max(t,current.machineTimes.get(machineId)??t,...inputs.map(x=>x.readyAt)),done=begin+op.duration;
          if(done>horizon||current.free+inputs.length-1<0)continue;
          const out={...output(op,inputs),id:`virtual-${step}-${nodes}`,readyAt:done};
          const nextItems=current.items.filter(x=>!inputs.some(y=>y.id===x.id));nextItems.push(out);
          const times=new Map(current.machineTimes);times.set(machineId,done);
          const commands=[...current.commands];if(begin===t&&inputs.every(x=>!String(x.id).startsWith('virtual-')&&!String(x.id).startsWith('pending-')))commands.push({type:'start',machineId,opId:op.id,itemIds:inputs.map(x=>x.id)});
          const next={items:nextItems,machineTimes:times,free:current.free+inputs.length-1,commands,cost:current.cost+(op.cost??0),storage:current.storage+inputs.reduce((s,x)=>s+(start.storageFee?.[x.kind]??0)*Math.max(0,begin-x.readyAt),0)};
          const score=queueValue(next)-base-next.cost-next.storage-(penalty(next)-basePenalty);
          if(Number.isFinite(score)){candidates.push({next,score});if(score>bestScore&&commands.length){bestScore=score;best=next;}}
        }
      }
    }
    candidates.sort((a,b)=>b.score-a.score);beam=candidates.slice(0,maxWidth).map(x=>x.next);if(!beam.length)break;
  }
  return {commands:best.commands,exhausted,diagnostics:{nodes,score:bestScore,baseValue:base}};
}

export function planProduction({start,items,machines,freeSlots,t,horizon,buyers,inFlight=[],maxCandidates=1024,timeBudgetMs=5,now=()=>performance.now(),mode='queue'}) {
  const begin=now(),pending=inFlight.map(x=>({...x,finishTick:x.finishTick??horizon+1}));
  const result=plan({start:{...start,horizon},state:{storage:{items,free:freeSlots},machines},pending,beliefs:buyers,t,budget:{timeMs:Math.min(timeBudgetMs,1),maxNodes:Math.min(maxCandidates,64),now,mode}});
  if(result.commands.length)return result;
  const remaining=Math.max(0,timeBudgetMs-(now()-begin));
  const fallback=fallbackProduction({start,items,machines,freeSlots,t,horizon,buyers,inFlight,maxCandidates,timeBudgetMs:remaining,now});
  return {...fallback,exhausted:result.exhausted||fallback.exhausted,diagnostics:{...result.diagnostics,fallback:true}};
}
