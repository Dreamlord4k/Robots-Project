import { FactoryBot as Baseline } from './baseline/bot.mjs';

// Повторно используем обновление интервалов S06; все экземпляры принадлежат одному runId.
const LegacyBuyer = new Baseline({buyers:['prototype']}).buyers.get('prototype').constructor;
const distance=(a,b)=>Number(a.color!==b.color)+Number(Boolean(a.handles)!==Boolean(b.handles));
const midpoint=(a,b)=>(a+b)/2;

export class JointBuyer extends LegacyBuyer {
  constructor(id, ceiling=80) {
    super(id,ceiling);
    for (const h of this.hypotheses) {h.productLo=h.pMaxLo*h.fLo;h.productHi=h.pMaxHi*h.fHi;}
    this.history=[];
  }
  observe({item,outcome,price,minPrice,reason}) {
    if(reason==='cooldown'||outcome==='refused'&&(reason!=='below_min_price'||!Number.isFinite(minPrice)))return;
    this.updateOnSaleResult(item,outcome,price,minPrice);
  }
  updateOnSaleResult(item,outcome,price,minPrice) {
    if (!item?.props || !['red','green','blue'].includes(item.props.color) || typeof item.props.handles!=='boolean') return;
    const sold=outcome==='sold'&&Number.isFinite(price)&&price>=0;
    const refused=outcome==='refused'&&Number.isFinite(minPrice)&&minPrice>0;
    if(!sold&&!refused)return;
    const previous=structuredClone(this.hypotheses),sales=this.salesCount,contradictions=this.contradictions??0;
    super.updateOnSaleResult(item,outcome,price,minPrice);
    // Если базовая модель отвергла наблюдение, не меняем совместные ограничения.
    if((this.contradictions??0)>contradictions)return;
    const lo=sold?Math.max(0,price-0.005)/1.02:0;
    const hi=sold?(price+0.005)/0.98:(minPrice+0.005)/0.98;
    for(const h of this.hypotheses) {
      if(!h.possible)continue;
      if(distance(item.props,h)===1){h.productLo=Math.max(h.productLo,lo);h.productHi=Math.min(h.productHi,hi);}
      h.productLo=Math.max(h.productLo,h.pMaxLo*h.fLo);
      h.productHi=Math.min(h.productHi,h.pMaxHi*h.fHi);
      if(h.productLo>h.productHi+1e-9)h.possible=false;
      else {
        if(h.fHi>0)h.pMaxLo=Math.max(h.pMaxLo,h.productLo/h.fHi);
        if(h.fLo>0)h.pMaxHi=Math.min(h.pMaxHi,h.productHi/h.fLo);
        if(h.pMaxHi>0)h.fLo=Math.max(h.fLo,h.productLo/h.pMaxHi);
        if(h.pMaxLo>0)h.fHi=Math.min(h.fHi,h.productHi/h.pMaxLo);
        if(h.pMaxLo>h.pMaxHi+1e-9||h.fLo>h.fHi+1e-9)h.possible=false;
      }
    }
    if(!this.hypotheses.some(h=>h.possible)){this.hypotheses=previous;this.salesCount=sales;this.contradictions=(this.contradictions??0)+1;return;}
    this.history.push({props:{...item.props},outcome,price,minPrice});
    this._cache=null;
  }
  points(h) {
    const p=midpoint(h.pMaxLo,h.pMaxHi);
    const lo=Math.max(h.productLo,p*h.fLo),hi=Math.min(h.productHi,p*h.fHi);
    if(lo>hi+1e-8)return [];
    return [{p,product:midpoint(lo,hi),weight:1}];
  }
  priceScenarios(props) {
    const valid=this.hypotheses.filter(h=>h.possible), result=[];
    for(const h of valid)for(const point of this.points(h)){
      const d=distance(props,h),price=d===0?point.p:d===1?point.product:0;
      // Потолок трактуется как ограничение допустимости, а не правило обрезания цены.
      if(price<=this.priceCeiling+1e-9)result.push({price,weight:point.weight/valid.length,match:2-d,key:h.key});
    }
    const total=result.reduce((s,x)=>s+x.weight,0);
    return total?result.map(x=>({...x,weight:x.weight/total})):[];
  }
  evaluateRobot(props) {
    const scenarios=this.priceScenarios(props);
    let prob2Match=0,prob1Match=0,expected2MatchPrice=0,expected1MatchPrice=0,expectedPrice=0,min2MatchPrice=Infinity;
    for(const x of scenarios){expectedPrice+=x.weight*x.price;if(x.match===2){prob2Match+=x.weight;expected2MatchPrice+=x.weight*x.price;const h=this.hypotheses.find(h=>h.key===x.key);min2MatchPrice=Math.min(min2MatchPrice,h.pMaxLo*0.98);}else if(x.match===1){prob1Match+=x.weight;expected1MatchPrice+=x.weight*x.price;}}
    return {expectedPrice,prob2Match,prob1Match,expected2MatchPrice:prob2Match?expected2MatchPrice/prob2Match:0,expected1MatchPrice:prob1Match?expected1MatchPrice/prob1Match:0,min2MatchPrice:Math.min(this.priceCeiling,min2MatchPrice===Infinity?this.priceCeiling:min2MatchPrice),uncertainty:this.hypotheses.filter(h=>h.possible).length};
  }
}

export class GridBuyer extends JointBuyer {
  points(h) {
    this._cache??=new Map(); if(this._cache.has(h.key))return this._cache.get(h.key);
    const points=[],size=5;
    for(let i=0;i<size;i++)for(let j=0;j<size;j++){
      const p=h.pMaxLo+(h.pMaxHi-h.pMaxLo)*i/(size-1),f=h.fLo+(h.fHi-h.fLo)*j/(size-1),product=p*f;
      if(product<h.productLo-1e-9||product>h.productHi+1e-9)continue;
      let weight=1;
      for(const o of this.history){const d=distance(o.props,h),base=d===0?p:d===1?product:0;
        if(o.outcome==='sold') {if(base===0)weight*=o.price===0?1:0;else weight*=o.price>=base*0.98-0.005&&o.price<=base*1.02+0.005?1/base:0;}
        else if(o.outcome==='refused') {if(base===0)weight*=o.minPrice>0?1:0;else weight*=Math.max(0,Math.min(1,(o.minPrice+0.005-base*0.98)/(base*0.04)));}
      }
      if(weight>0)points.push({p,product,weight});
    }
    const total=points.reduce((s,x)=>s+x.weight,0);const result=total?points.map(x=>({...x,weight:x.weight/total})):super.points(h);
    this._cache.set(h.key,result);return result;
  }
}
