import { FactoryBot as Baseline } from './baseline/bot.mjs';
import { JointBuyer, GridBuyer } from './buyer-model.mjs';

export class FactoryBot extends Baseline {
  constructor(start,options) {
    super(start,options);
    for(const id of this.buyers.keys()) this.buyers.set(id,new JointBuyer(id,this.priceCeiling));
  }
}
export class GridBot extends Baseline {
  constructor(start,options) {
    super(start,options);
    for(const id of this.buyers.keys()) this.buyers.set(id,new GridBuyer(id,this.priceCeiling));
  }
}
