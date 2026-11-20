// S11b: отложенный первый зонд пары.
// Подтверждённые пары (уже была продажа этого архетипа этому покупателю) получают
// предложение сразу; разведочная пара — только если робот пролежал probeDelay тактов,
// либо у конца смены / при переполнении склада. Так проверяется ценность ранней разведки.
import { FactoryBot as BaseFactoryBot } from '../../src/bot.mjs';

const keyOf = (props) => `${props?.color}:${Boolean(props?.handles)}`;

export class FactoryBot extends BaseFactoryBot {
  constructor(startParams = {}, plannerOptions = {}) {
    super(startParams, plannerOptions);
    this.probeDelay = plannerOptions.probeDelay ?? 6;
    this.firstSeen = new Map();
    this.confirmed = new Set();
  }

  handleEvent(payload) {
    if(payload?.seq !== undefined && this.seqCache.has(payload.seq)) return super.handleEvent(payload);
    const t = payload?.t ?? 0;
    const event = payload?.event || {};
    const type = event.type || event.event;
    const offerKey=`${event.buyerId}#${event.itemId}`;
    const failed=(payload?.report??[]).some(r=>r.ok===false&&this.previousCommands[r.cmd]?.type==='offer'&&this.previousCommands[r.cmd]?.buyerId===event.buyerId&&this.previousCommands[r.cmd]?.itemId===event.itemId);
    const soldItem=event.item??this.lastOfferItems.get(offerKey);
    if (type === 'sale_result' && event.outcome === 'sold' && soldItem?.props && !failed) {
      this.confirmed.add(`${event.buyerId}|${keyOf(soldItem.props)}`);
    }
    const items = payload?.state?.storage?.items || [];
    for (const item of items) if (!this.firstSeen.has(item.id)) this.firstSeen.set(item.id, t);
    const present = new Set(items.map(item => item.id));
    for (const id of this.firstSeen.keys()) if (!present.has(id)) this.firstSeen.delete(id);
    return super.handleEvent(payload);
  }

  planBestOffers(t, ticksLeft, freeSlots, robots, readyBuyers) {
    if (ticksLeft <= 18 || freeSlots <= 1) return super.planBestOffers(t,ticksLeft,freeSlots,robots,readyBuyers);
    return super.planBestOffers(t,ticksLeft,freeSlots,robots,readyBuyers,(robot,buyer) => {
      if (this.confirmed.has(`${buyer.buyerId}|${keyOf(robot.props)}`)) return true;
      const seenAt = this.firstSeen.get(robot.id) ?? t;
      return t - seenAt >= this.probeDelay;
    });
  }
}
