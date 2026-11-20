import { FactoryBot as Core } from './s09-core.mjs';
export class FactoryBot extends Core { constructor(start,options={}) { super(start,{...options,mode:'queue'}); } }
export class FixedPenaltyBot extends Core { constructor(start,options={}) { super(start,{...options,mode:'queue-fixed'}); } }
