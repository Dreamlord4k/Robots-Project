// Локальная гипотеза: равные веса типов, середины интервалов Pmax/f и равномерный шум.
// priceCeiling здесь ограничивает рассматриваемые цены; интерпретация зависит от арены.
export function evaluateOffer({belief,props,minPrice=0,t=0,horizon=Infinity,offerFee=0,noise=0.02}) {
  const assumptions={weights:'equal',parameters:'interval-midpoints',noise:'uniform',priceCeiling:'price-cap'};
  if ((belief.cooldownUntil ?? 0)>t || t>horizon) return {available:false,saleProbability:0,expectedRevenue:0,immediateNet:0,assumptions};
  const hypotheses=(belief.hypotheses??[]).filter(h=>h.possible);
  if(!hypotheses.length) return {available:true,saleProbability:0,expectedRevenue:0,immediateNet:-offerFee,assumptions};
  let probability=0,revenue=0;
  for(const h of hypotheses) {
    const distance=Number(h.color!==props.color)+Number(Boolean(h.handles)!==Boolean(props.handles));
    const base=(h.pMaxLo+h.pMaxHi)/2*(distance===0?1:distance===1?(h.fLo+h.fHi)/2:0);
    const ceiling=belief.priceCeiling??Infinity;
    const threshold=Math.max(0,minPrice-0.005);
    if(!Number.isFinite(base)||base<0) continue;
    if(base===0||noise<=0){const price=Math.min(ceiling,base);if(price>=minPrice){probability++;revenue+=price;}continue;}
    const lo=base*(1-noise),hi=base*(1+noise), width=hi-lo;
    if(minPrice>ceiling || threshold>hi) continue;
    const from=Math.max(lo,threshold);
    const p=(hi-from)/width;
    const split=Math.max(from,Math.min(hi,ceiling));
    probability+=p;
    revenue+=((split*split-from*from)/2 + Math.max(0,hi-split)*ceiling)/width;
  }
  probability/=hypotheses.length;revenue/=hypotheses.length;
  return {available:true,saleProbability:probability,expectedRevenue:revenue,immediateNet:revenue-offerFee,assumptions};
}

export function candidateThresholds(buyer,props,ceiling) {
  const ev=buyer.evaluateRobot?.(props);
  const limits=[];
  for(const h of (buyer.hypotheses??[]).filter(h=>h.possible)) {
    const d=Number(h.color!==props.color)+Number(Boolean(h.handles)!==Boolean(props.handles));
    if(d===0) limits.push(h.pMaxLo*0.98,h.pMaxHi*1.02);
    else if(d===1) limits.push(h.pMaxLo*h.fLo*0.98,h.pMaxHi*h.fHi*1.02);
  }
  const valid=limits.filter(Number.isFinite);
  const boundaries=valid.length?[Math.min(...valid),Math.max(...valid)].map(n=>Math.max(0,Math.min(ceiling,Math.floor(n*100)/100))):[];
  return [...new Set([Math.min(ceiling,Math.max(43.5,Math.min(73,Math.floor((ev?.min2MatchPrice??44.1)*10)/10))),Math.min(ceiling,13),Math.min(ceiling,2),...boundaries])].filter(n=>Number.isFinite(n)&&n>=0);
}

export function rankSaleActions({items,buyers,start,t,pending=[],budget={}}) {
  const horizon=start.horizon??650, fee=start.offerFee??1, storage=start.storageFee?.robot??0.5, ceiling=start.priceCeiling??80;
  const current=buyers.filter(b=>(b.cooldownUntil??0)<=t).slice(0,Math.min(8,budget.maxBuyers??8));
  const all=buyers.slice(0,Math.min(32,budget.maxBuyers??32));
  const bestOffer=(item,b,at)=>candidateThresholds(b,item.props,ceiling).map(minPrice=>({minPrice,...evaluateOffer({belief:b,props:item.props,minPrice,t:at,horizon,offerFee:fee})})).filter(x=>x.available).sort((a,b)=>b.immediateNet-a.immediateNet)[0];
  const edges=[];
  for(const item of items) {
    let future=0;
    for(const b of all) {const at=Math.max(t+1,b.cooldownUntil??0);if(at>horizon)continue;const x=bestOffer(item,b,at);future=Math.max(future,(x?.immediateNet??0)-storage*(at-t));}
    for(const b of current) {
      const offer=bestOffer(item,b,t);if(!offer)continue;
      let retry=0;
      for(const other of all) {const at=Math.max(t+1,other===b?t+(start.buyerCooldown??8):other.cooldownUntil??0);if(at>horizon)continue;const x=bestOffer(item,other,at);retry=Math.max(retry,(x?.immediateNet??0)-storage*(at-t));}
      // Для будущих роботов учитываем лучшую вытесняемую сделку один раз.
      let displaced=0;
      for(const inflight of pending.slice(0,16)) {
        if(inflight.kind!=='robot'||!inflight.color||inflight.finishTick>t+(start.buyerCooldown??8))continue;
        const futureItem={id:'pending',props:{color:inflight.color,handles:Boolean(inflight.handles)}};
        const at=Math.max(t+1,inflight.finishTick??t+1); const wanted=bestOffer(futureItem,b,at)?.immediateNet??0;
        let alternative=0;for(const other of all)if(other!==b){const when=Math.max(at,other.cooldownUntil??0);if(when<=horizon)alternative=Math.max(alternative,(bestOffer(futureItem,other,when)?.immediateNet??0)-storage*(when-at));}
        displaced=Math.max(displaced,wanted-alternative);
      }
      const gain=offer.immediateNet+(1-offer.saleProbability)*Math.max(0,retry)-future;
      if(gain>0) edges.push({buyerId:b.buyerId,itemId:item.id,minPrice:offer.minPrice,gain,net:offer.immediateNet,displaced:Math.max(0,displaced)});
    }
  }
  const bestByItem=new Map();for(const e of edges){const old=bestByItem.get(e.itemId);if(!old||e.gain>old.gain+1e-9||Math.abs(e.gain-old.gain)<=1e-9&&e.net>old.net)bestByItem.set(e.itemId,e);}
  const ids=[...bestByItem].sort((a,b)=>Math.abs(b[1].gain-a[1].gain)>1e-9?b[1].gain-a[1].gain:b[1].net-a[1].net||String(a[0]).localeCompare(String(b[0]))).slice(0,Math.min(6,budget.maxItems??6)).map(x=>x[0]);
  let best=0,bestNet=0, result=[];const used=new Set();let steps=0;const limit=budget.maxNodes??4096;
  function search(i,total,net,displaced,selected){if(++steps>limit)return;const score=total-displaced;if(score>best+1e-9||Math.abs(score-best)<=1e-9&&net>bestNet){best=score;bestNet=net;result=[...selected];}if(i===ids.length)return;search(i+1,total,net,displaced,selected);for(const e of edges)if(e.itemId===ids[i]&&!used.has(e.buyerId)){used.add(e.buyerId);selected.push(e);search(i+1,total+e.gain,net+e.net,Math.max(displaced,e.displaced),selected);selected.pop();used.delete(e.buyerId);}}
  search(0,0,0,0,[]);
  return result.map(({buyerId,itemId,minPrice})=>({buyerId,itemId,minPrice}));
}
