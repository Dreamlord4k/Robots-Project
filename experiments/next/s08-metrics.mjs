// Диагностика использует только публичные предложения и ответы до завершения смены.
export function predictOffer(model,props,minPrice) {
  let scenarios;
  if(typeof model.priceScenarios==='function')scenarios=model.priceScenarios(props);
  else {
    const hypotheses=model.hypotheses.filter(h=>h.possible);
    scenarios=hypotheses.map(h=>{const d=Number(h.color!==props.color)+Number(Boolean(h.handles)!==Boolean(props.handles));return {price:(h.pMaxLo+h.pMaxHi)/2*(d===0?1:d===1?(h.fLo+h.fHi)/2:0),weight:1/hypotheses.length};});
  }
  if(!scenarios.length)return null;
  let probability=0,revenue=0;
  for(const {price,weight} of scenarios) {
    if(price===0){if(minPrice<=0)probability+=weight;continue;}
    const lo=price*0.98,hi=price*1.02,from=Math.max(lo,minPrice-0.005);
    if(from>hi)continue;
    probability+=weight*(hi-from)/(hi-lo);
    revenue+=weight*(hi*hi-from*from)/(2*(hi-lo));
  }
  return {saleProbability:probability,expectedSoldPrice:probability?revenue/probability:null};
}

export function coverage(buyers,secret) {
  const result={buyers:0,typeCovered:0,parametersCovered:0,productCovered:0};
  for(const s of secret??[]) {
    const h=buyers.get(s.id)?.hypotheses?.find(x=>x.color===s.sample?.color&&Boolean(x.handles)===Boolean(s.sample?.handles));
    if(!h)continue; result.buyers++;
    if(!h.possible)continue;result.typeCovered++;
    if(s.pMax>=h.pMaxLo-1e-9&&s.pMax<=h.pMaxHi+1e-9&&s.f>=h.fLo-1e-9&&s.f<=h.fHi+1e-9){result.parametersCovered++;const p=s.pMax*s.f;if((h.productLo??-Infinity)<=p+1e-9&&(h.productHi??Infinity)>=p-1e-9)result.productCovered++;}
  }
  return result;
}
