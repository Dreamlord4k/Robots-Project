// Наблюдатель получает только публичные события, команды и состояние после такта.
// Секреты передаются лишь после завершения смены в finish().
export class WorldMetrics {
  constructor(start = {}) {
    this.start = start;
    this.costByThird = Array.from({length:3}, () => ({purchases:0,operations:0,offers:0,storage:0}));
    this.decisionSignals = {fullStorage:0,robotsAllBuyersBusy:0,searchExhausted:0,noProductionCommand:0};
    this.itemInvestment = new Map();
    this.pendingInvestment = new Map();
    this.offers = { submitted: 0, accepted: 0, invalid: 0, sold: 0, refusedPrice: 0, refusedCooldown: 0, other: 0 };
    this.idleTicks = { 'm-paint': 0, 'm-assemble': 0 };
    this.robotWaitingTicks = 0;
    this.latencies = [];
    this.results = [];
    this.beliefs = new Map();
    this.supplies = { accepted: 0, skipped: 0, acceptedCost: 0, skippedCost: 0 };
    this.idleReasons = { 'm-paint': { noBody: 0 }, 'm-assemble': { noBody: 0, noControl: 0 } };
    this.currentEvent = null;
  }
  onCommands(commands, report) {
    const event = this.currentEvent;
    const costs = this.costByThird[this.third(this.currentTick ?? 0)];
    if (event?.type === 'supply') {
      const accepted = commands.some((c,i) => c.type === 'accept' && c.itemId === event.item?.id && report[i]?.ok);
      const key = accepted ? 'accepted' : 'skipped';
      this.supplies[key]++;
      this.supplies[`${key}Cost`] += typeof event.price === 'number' ? event.price : 0;
      if (accepted && Number.isFinite(event.price)) costs.purchases += event.price;
    }
    commands.forEach((command, i) => {
      if (report[i]?.ok && command?.type === 'accept' && command.itemId === event?.item?.id) this.itemInvestment.set(command.itemId, Number.isFinite(event.price) ? event.price : null);
      if (report[i]?.ok && command?.type === 'discard') this.itemInvestment.delete(command.itemId);
      if (report[i]?.ok && command?.type === 'start') {
        const op = this.start.machines?.find(m => m.id === command.machineId)?.ops?.find(o => o.id === command.opId);
        if (Number.isFinite(op?.cost)) costs.operations += op.cost;
        const inputs = (command.itemIds ?? []).map(id => this.itemInvestment.get(id));
        this.pendingInvestment.set(command.machineId, Number.isFinite(op?.cost) && inputs.every(Number.isFinite) ? op.cost + inputs.reduce((a,b)=>a+b,0) : null);
        for (const id of command.itemIds ?? []) this.itemInvestment.delete(id);
      }
      if (report[i]?.ok && (command?.cmd ?? command?.type) === 'offer' && Number.isFinite(this.start.offerFee)) costs.offers += this.start.offerFee;
      if ((command?.cmd ?? command?.type) !== 'offer') return;
      this.offers.submitted++;
      if (report[i]?.ok) this.offers.accepted++;
      else this.offers.invalid++;
    });
    if (!commands.some((command,i) => command?.type === 'start' && report[i]?.ok)) this.decisionSignals.noProductionCommand++;
  }
  third(t) { return Math.min(2,Math.max(0,Math.floor(t * 3 / ((this.start.horizon ?? 0) + 1)))); }
  onDecision({exhausted=false} = {}) { if (exhausted) this.decisionSignals.searchExhausted++; }
  onEvent(payload, elapsedMs) {
    this.latencies.push(elapsedMs);
    const event = payload.event;
    this.currentEvent = event;
    if (event?.type === 'machine_done' && event.item?.id) {
      this.itemInvestment.set(event.item.id, this.pendingInvestment.get(event.machineId) ?? null);
      this.pendingInvestment.delete(event.machineId);
    }
    if (event?.type === 'sale_result' && event.outcome === 'sold') this.itemInvestment.delete(event.itemId);
    this.currentTick = payload.t ?? 0;
    const storage = payload.state?.storage;
    if (storage?.free <= 0) this.decisionSignals.fullStorage++;
    const buyers = payload.state?.buyers;
    if (storage?.items?.some(i => i.kind === 'robot') && Array.isArray(buyers) && buyers.length && buyers.every(b => typeof b.cooldownUntil === 'number' && b.cooldownUntil > this.currentTick)) this.decisionSignals.robotsAllBuyersBusy++;
    if (event?.type !== 'sale_result') return;
    if (event.outcome === 'sold') this.offers.sold++;
    else if (event.outcome === 'refused' && event.reason === 'below_min_price') this.offers.refusedPrice++;
    else if (event.outcome === 'refused' && event.reason === 'cooldown') this.offers.refusedCooldown++;
    else this.offers.other++;
    this.results.push({ buyerId: event.buyerId, item: event.item, outcome: event.outcome });
  }
  onBeliefs(t, beliefs) {
    for (const { id, possible } of beliefs) {
      if (!Array.isArray(possible)) continue;
      const list = [...possible].sort();
      const history = this.beliefs.get(id) ?? [];
      if (!history.length || JSON.stringify(history.at(-1).possible) !== JSON.stringify(list)) history.push({ t, possible: list });
      this.beliefs.set(id, history);
    }
  }
  onTick({ t = 0, items, machines }) {
    for (const id of Object.keys(this.idleTicks)) if (machines[id] && !machines[id].busy) this.idleTicks[id]++;
    if (machines['m-paint'] && !machines['m-paint'].busy && !items.some(i => i.kind === 'body' && !i.props?.color)) this.idleReasons['m-paint'].noBody++;
    if (machines['m-assemble'] && !machines['m-assemble'].busy) {
      if (!items.some(i => i.kind === 'body' && i.props?.color)) this.idleReasons['m-assemble'].noBody++;
      if (!items.some(i => i.kind === 'control')) this.idleReasons['m-assemble'].noControl++;
    }
    this.robotWaitingTicks += items.filter(item => item.kind === 'robot').length;
    for (const item of items) this.costByThird[this.third(t)].storage += this.start.storageFee?.[item.kind] ?? 0;
  }
  finish(report, items, machines = {}) {
    const times = [...this.latencies].sort((a, b) => a - b);
    const quantile = p => times.length ? times[Math.ceil(p * times.length) - 1] : null;
    const remaining = {};
    const remainingInvestment = {storage:0,inFlight:0,unknownStorage:0,unknownInFlight:0};
    for (const item of items) remaining[item.kind] = (remaining[item.kind] ?? 0) + 1;
    for (const item of items) { const value=this.itemInvestment.get(item.id); if(Number.isFinite(value)) remainingInvestment.storage+=value; else remainingInvestment.unknownStorage++; }
    for (const [id,m] of Object.entries(machines)) if(m.busy) {const value=this.pendingInvestment.get(id); if(Number.isFinite(value)) remainingInvestment.inFlight+=value; else remainingInvestment.unknownInFlight++;}
    let preferenceMatches = null, salesByMatch = null;
    if (Array.isArray(report.buyersSecret)) {
      const buyers = new Map(report.buyersSecret.map(b => [b.id, b]));
      const counts = { total: 0, zero: 0, one: 0, two: 0, unavailable: 0 };
      salesByMatch = { zero:0, one:0, two:0, unavailable:0 };
      for (const result of this.results) {
        const sample = buyers.get(result.buyerId)?.sample;
        const props = result.item?.props;
        if (!sample || !props || typeof props.color !== 'string' || typeof props.handles !== 'boolean') { counts.unavailable++; if(result.outcome==='sold') salesByMatch.unavailable++; continue; }
        const matches = Number(props.color === sample.color) + Number(props.handles === sample.handles);
        counts[['zero', 'one', 'two'][matches]]++;
        counts.total++;
        if(result.outcome==='sold') salesByMatch[['zero','one','two'][matches]]++;
      }
      preferenceMatches = { offers: counts };
    }
    let learningAccuracy = null, learningTime = null;
    if (Array.isArray(report.buyersSecret) && this.beliefs.size) {
      learningAccuracy = { evaluated: 0, trueTypePossible: 0, uniqueCorrect: 0, uniqueIncorrect: 0 };
      learningTime = { firstCorrectUniqueTicks: [], neverCorrectUnique: 0 };
      for (const buyer of report.buyersSecret) {
        const history = this.beliefs.get(buyer.id);
        if (!history?.length || !buyer.sample || typeof buyer.sample.handles !== 'boolean') continue;
        const key = `${buyer.sample.color}:${buyer.sample.handles ? 1 : 0}`;
        const last = history.at(-1).possible;
        learningAccuracy.evaluated++;
        if (last.includes(key)) learningAccuracy.trueTypePossible++;
        if (last.length === 1) learningAccuracy[last[0] === key ? 'uniqueCorrect' : 'uniqueIncorrect']++;
        const first = history.find(entry => entry.possible.length === 1 && entry.possible[0] === key);
        if (first) learningTime.firstCorrectUniqueTicks.push(first.t);
        else learningTime.neverCorrectUnique++;
      }
    }
    return { offers: { ...this.offers }, idleTicks: { ...this.idleTicks }, idleReasons: structuredClone(this.idleReasons), supplies: { ...this.supplies }, inFlight: Object.values(machines).filter(m => m.busy).length, inFlightDetails: Object.entries(machines).filter(([,m])=>m.busy).map(([id,m])=>({machineId:id,opId:m.currentOp?.opId??null,output:m.currentOp?.outputItem??null,finishAt:m.busyUntil??null})), remainingInvestment, costByThird: this.costByThird, decisionSignals: this.decisionSignals, salesByMatch, robotWaitingTicks: this.robotWaitingTicks, remaining,
      latency: { count: times.length, meanMs: times.length ? times.reduce((a,b) => a+b, 0) / times.length : null,
        p95Ms: quantile(0.95), p99Ms: quantile(0.99), maxMs: times.at(-1) ?? null },
      preferenceMatches, learningAccuracy, learningTime };
  }
}
