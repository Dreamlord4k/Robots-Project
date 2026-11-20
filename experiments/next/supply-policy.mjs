const accepts=(req,item)=>item&&(!req.kind||req.kind===item.kind)&&Object.entries(req.props??{}).every(([k,v])=>v===null?item.props?.[k]==null:v==='*'?item.props?.[k]!=null:item.props?.[k]===v);
const output=(op,inputs)=>({kind:op.output.kind,props:{...(Number.isInteger(op.inherit)?inputs[op.inherit]?.props:{}),...(op.output.props??{})}});

// Оценка одного доступного маршрута; будущие непредсказанные поставки не читаются.
export function continuationEstimate({items,start,state,pending=[],beliefs=[],t,extraSupply=null,maxNodes=300,deadline=Infinity,now=()=>performance.now()}) {
  const horizon=start.horizon??650, ops=[];
  for(const m of (start.machines??[]).slice(0,32))for(const op of (m.ops??[]).slice(0,64))if(ops.length<64&&op?.id&&op.output?.kind&&Array.isArray(op.inputs)&&op.inputs.length>=1&&op.inputs.length<=2&&Number.isFinite(op.duration)&&op.duration>0)ops.push({id:m.id,op});
  const machineTimes=new Map((state.machines??[]).map(m=>[m.id,m.busyUntil==null?t:Math.max(t+1,m.busyUntil)]));
  const available=items.slice(0,32).map(i=>({...i,props:{...i.props},readyAt:i.readyAt??t}));
  for(const [idx,p] of pending.slice(0,32).entries())if(p.kind&&Number.isFinite(p.finishTick)&&p.finishTick<=horizon)available.push({id:`pending-${idx}`,kind:p.kind,props:{color:p.color??p.props?.color,handles:Boolean(p.handles??p.props?.handles)},readyAt:p.finishTick});
  if(extraSupply)available.push({...extraSupply,props:{...extraSupply.props},readyAt:extraSupply.readyAt,acquisitionCost:extraSupply.price});
  let count=0,best=0,truncated=false;
  const initialFree=(state.storage?.free??0)-(items.length-(state.storage?.items??[]).length)-(extraSupply?1:0);
  if(initialFree<0)return {value:0,nodes:0,truncated:false};
  function visit(inventory,times,depth,cost,storage,free) {
    if(count++>=maxNodes||now()>=deadline){truncated=true;return;}
    if(depth>=4)return;
    for(const {id,op} of ops) {
      if(!times.has(id))continue;
      for(const a of inventory.filter(i=>accepts(op.inputs[0],i)).slice(0,6)) {
        const seconds=op.inputs.length===1?[null]:inventory.filter(i=>i.id!==a.id&&accepts(op.inputs[1],i)).slice(0,4);
        for(const b of seconds){
          if(count>=maxNodes||now()>=deadline){truncated=true;return;}
          const input=b?[a,b]:[a],begin=Math.max(t,times.get(id)??t,...input.map(i=>i.readyAt)),done=begin+op.duration;
          if(done>horizon||free+input.length-1<0)continue;
          const nextCost=cost+(op.cost??0)+input.reduce((sum,i)=>sum+(i.acquisitionCost??0),0);
          const nextStorage=storage+input.reduce((sum,i)=>sum+(start.storageFee?.[i.kind]??0)*Math.max(0,begin-i.readyAt),0);
          const product={...output(op,input),id:`virtual-${depth}-${count}`,readyAt:done};
          if(product.kind==='robot') {
            const attempts=beliefs.slice(0,32).map(buyer=>{const at=Math.max(done,buyer.cooldownUntil??0),e=buyer.evaluateRobot?.(product.props);if(at>horizon||!e)return null;const high=e.prob2Match>0,low=!high&&horizon-at<=18&&e.prob1Match>0.3&&e.expected1MatchPrice>=15;if(!high&&!low)return null;return {at,p:high?e.prob2Match:e.prob1Match,price:high?e.expected2MatchPrice:e.expected1MatchPrice};}).filter(Boolean).sort((a,b)=>a.at-b.at||b.p*b.price-a.p*a.price);
            let survival=1,revenue=0,prior=done;
            for(const attempt of attempts){revenue+=survival*(attempt.p*attempt.price-(start.offerFee??1)-(start.storageFee?.robot??0.5)*(attempt.at-prior));survival*=1-attempt.p;prior=attempt.at;}
            best=Math.max(best,revenue-nextCost-nextStorage);
          } else {
            const next=inventory.filter(i=>!input.some(x=>x.id===i.id));next.push(product);
            const nextTimes=new Map(times);nextTimes.set(id,done);
            visit(next,nextTimes,depth+1,nextCost,nextStorage,free+input.length-1);
          }
        }
      }
    }
  }
  visit(available,machineTimes,0,0,0,initialFree);
  return {value:best,nodes:count,truncated};
}

export function decideSupply({item,price,state,start,pending=[],beliefs=[],t,continuationValue,bridge=null,budget={}}) {
  if(!item?.id || !Number.isFinite(price) || price<0)return {accept:false,reason:'invalid_supply'};
  if((state.storage?.free??0)<=0)return {accept:false,reason:'no_space'};
  const items=state.storage?.items??[];
  const now=budget.now??(()=>performance.now()),deadline=budget.deadline??now()+Math.min(budget.timeMs??4,(start.eventTimeoutMs??2000)*0.1);
  const evaluate=xs=>continuationValue?{value:continuationValue({items:xs,start,state,pending,beliefs,t})}:continuationEstimate({items:xs,start,state,pending,beliefs,t,extraSupply:bridge,deadline,now,maxNodes:budget.maxNodes??300});
  const before=evaluate(items),after=evaluate([...items,item]);
  if(before.truncated||after.truncated)return {accept:false,reason:'budget_exhausted',before,after};
  if(!Number.isFinite(before.value)||!Number.isFinite(after.value))return {accept:false,reason:'unknown_value'};
  const delta=after.value-before.value-price;
  return {accept:delta>0,reason:delta>0?'positive_margin':'nonpositive_margin',delta,before:before.value,after:after.value};
}

// Экспериментальное допущение: следующая поставка другого вида приходит через 2, 3 или 4 такта с равной вероятностью.
export function decideBridgeSupply(args) {
  const now=args.budget?.now??(()=>performance.now()),deadline=args.budget?.deadline??now()+Math.min(args.budget?.timeMs??4,(args.start.eventTimeoutMs??2000)*0.1);
  const options={...args,budget:{...args.budget,deadline,now}};
  const direct=decideSupply(options);
  if(direct.accept||['invalid_supply','no_space','budget_exhausted'].includes(direct.reason))return direct;
  if(!Number.isFinite(args.complementPrice)||args.complementPrice<0)return {...direct,reason:'no_observed_complement_price'};
  const kind=args.item.kind==='sheet'?'control':args.item.kind==='control'?'sheet':null;
  if(!kind)return direct;
  const cases=[2,3,4].map(delay=>decideSupply({...options,bridge:{id:`anticipated-${kind}`,kind,props:{},readyAt:args.t+delay,price:args.complementPrice}}));
  if(cases.some(x=>x.reason==='budget_exhausted'))return {...direct,reason:'budget_exhausted'};
  const delta=cases.reduce((sum,x)=>sum+(x.delta??-args.price),0)/cases.length;
  return {accept:delta>0,reason:delta>0?'positive_expected_bridge':'nonpositive_expected_bridge',delta,assumption:'uniform_2_4_observed_price',cases:cases.map(x=>x.delta??null)};
}

export function shouldLiquidate({t,horizon,buyers,robots,pending=[],buyerCooldown}) {
  const count=robots.length+pending.filter(p=>p.kind==='robot'&&p.finishTick<=horizon).length;
  if(!count)return false;
  const cooldown=Math.max(1,buyerCooldown??8);
  const windows=buyers.reduce((s,b)=>{const at=Math.max(t,b.cooldownUntil??t);return s+(at<=horizon?1+Math.floor((horizon-at)/cooldown):0);},0);
  return windows>0&&count>=windows;
}
