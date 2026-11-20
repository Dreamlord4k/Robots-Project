import { FactoryBot as Core } from './s10-core.mjs';
import { decideSupply, decideBridgeSupply, shouldLiquidate } from './supply-policy.mjs';

class SupplyBot extends Core {
  constructor(start,options){super(start,options);this.observedPrices=new Map();this.supplyStats={};}
  decideAcceptSupply(item,items,busyMachines,freeSlots,ticksLeft,context) {
    const {price,t}=context;
    if(Number.isFinite(price)&&price>=0)this.observedPrices.set(item.kind,price);
    const pending=[...this.machineInFlight.values()],state={...context.state,storage:{...context.state.storage,free:freeSlots,items}};
    const args={item,price,state,start:this.plannerStart,pending,beliefs:[...this.buyers.values()],t};
    let result;
    if(this.bridge) {
      const missing=item.kind==='sheet'?!items.some(x=>x.kind==='control'):item.kind==='control'?!items.some(x=>x.kind==='sheet'||x.kind==='body')&&!pending.some(x=>x.kind==='body'):false;
      const other=item.kind==='sheet'?'control':'sheet';
      result=missing?decideBridgeSupply({...args,complementPrice:this.observedPrices.get(other)}):decideSupply(args);
    } else result=decideSupply(args);
    this.supplyStats[result.reason]=(this.supplyStats[result.reason]??0)+1;
    return result.accept;
  }
}
export class DeterministicBot extends SupplyBot {}
export class BridgeBot extends SupplyBot { constructor(start,options){super(start,options);this.bridge=true;} }
export class DynamicLiquidationBot extends Core {
  planBestOffers(t,ticksLeft,freeSlots,robots,readyBuyers){
    const liquidate=shouldLiquidate({t,horizon:this.horizon,buyers:[...this.buyers.values()],robots,pending:[...this.machineInFlight.values()],buyerCooldown:this.buyerCooldown});
    return super.planBestOffers(t,liquidate?Math.min(ticksLeft,18):Math.max(ticksLeft,19),freeSlots,robots,readyBuyers);
  }
}
export class CombinedBot extends BridgeBot {
  planBestOffers(t,ticksLeft,freeSlots,robots,readyBuyers){
    const liquidate=shouldLiquidate({t,horizon:this.horizon,buyers:[...this.buyers.values()],robots,pending:[...this.machineInFlight.values()],buyerCooldown:this.buyerCooldown});
    return super.planBestOffers(t,liquidate?Math.min(ticksLeft,18):Math.max(ticksLeft,19),freeSlots,robots,readyBuyers);
  }
}
