import { planProduction } from './s04-planner.mjs';

const COLORS = ['red', 'green', 'blue'];
const ARCHETYPES = [
  { key: 'red:0', color: 'red', handles: false },
  { key: 'red:1', color: 'red', handles: true },
  { key: 'green:0', color: 'green', handles: false },
  { key: 'green:1', color: 'green', handles: true },
  { key: 'blue:0', color: 'blue', handles: false },
  { key: 'blue:1', color: 'blue', handles: true }
];

function archetypeKey(color, handles) {
  return `${color}:${handles ? 1 : 0}`;
}

function hammingDistance(a, b) {
  let dist = 0;
  if (a.color !== b.color) dist++;
  if (Boolean(a.handles) !== Boolean(b.handles)) dist++;
  return dist;
}

/**
 * Нормализация конфигурации станков из POST /start
 */
function parseMachinesConfig(rawMachines) {
  const cfg = {
    cut: { machineId: 'm-cut', opId: 'cut', duration: 2, cost: 1 },
    handles: { machineId: 'm-handles', opId: 'handles', duration: 2, cost: 2 },
    paint: {
      red: { machineId: 'm-paint', opId: 'paint_red', duration: 3, cost: 2 },
      green: { machineId: 'm-paint', opId: 'paint_green', duration: 3, cost: 2 },
      blue: { machineId: 'm-paint', opId: 'paint_blue', duration: 3, cost: 2 }
    },
    assemble: {
      machineId: 'm-assemble',
      opId: 'assemble',
      duration: 3,
      cost: 3,
      bodyFirst: true
    }
  };

  if (!rawMachines || typeof rawMachines !== 'object') return cfg;

  const entries = Array.isArray(rawMachines)
    ? rawMachines.map(m => [m.id || m.machineId, m])
    : Object.entries(rawMachines);

  for (const [mId, mDef] of entries) {
    if (!mDef || !mDef.ops) continue;
    const opsList = Array.isArray(mDef.ops)
      ? mDef.ops.map(o => [o.id || o.opId, o])
      : Object.entries(mDef.ops);

    for (const [opId, op] of opsList) {
      const inputs = op.inputs || [];
      const out = op.output || op.produces || {};
      const dur = op.duration ?? 2;
      const cost = op.cost ?? 1;

      if (mId === 'm-cut' || (inputs.length === 1 && inputs[0]?.kind === 'sheet')) {
        cfg.cut = { machineId: mId, opId, duration: dur, cost };
      } else if (mId === 'm-handles' || out.props?.handles === true || out.handles === true) {
        cfg.handles = { machineId: mId, opId, duration: dur, cost };
      } else if (mId === 'm-paint' || COLORS.includes(out.props?.color || out.color)) {
        const c = out.props?.color || out.color || COLORS.find(col => opId.toLowerCase().includes(col));
        if (c) {
          cfg.paint[c] = { machineId: mId, opId, duration: dur, cost };
        }
      } else if (mId === 'm-assemble' || out.kind === 'robot' || inputs.length === 2) {
        const bodyFirst = inputs.length >= 2 ? inputs[0]?.kind !== 'control' : true;
        cfg.assemble = { machineId: mId, opId, duration: dur, cost, bodyFirst };
      }
    }
  }

  return cfg;
}

/**
 * Модель знаний о скрытых параметрах покупателя (изолирована строго внутри одного runId)
 */
class BuyerBelief {
  constructor(buyerId, priceCeiling = 80) {
    this.buyerId = buyerId;
    this.priceCeiling = Number.isFinite(priceCeiling) && priceCeiling >= 0 ? priceCeiling : 80;
    // Диапазон v1 — априорное допущение; потолок из start ограничивает цены.
    this.priorHi = Math.min(75, (this.priceCeiling + 0.005) / 0.98);
    this.priorLo = this.priorHi < 45 ? 0 : 45;
    this.cooldownUntil = 0;
    this.salesCount = 0;
    this.offersCount = 0;
    this.hypotheses = ARCHETYPES.map(arch => ({
      ...arch,
      possible: true,
      pMaxLo: this.priorLo,
      pMaxHi: this.priorHi,
      fLo: 0.3,
      fHi: 0.6
    }));
  }

  updateOnSaleResult(item, outcome, price, minPriceUsed) {
    if (!COLORS.includes(item?.props?.color) || typeof item?.props?.handles !== 'boolean') return;
    const robotArch = item.props;
    const sold = outcome === 'sold' && Number.isFinite(price) && price >= 0;
    const refused = outcome === 'refused' && Number.isFinite(minPriceUsed) && minPriceUsed > 0;
    if (!sold && !refused) return;

    // Интервалы округления консервативны: цена могла быть округлена до копеек.
    const lo = sold ? Math.max(0, price - 0.005) / 1.02 : 0;
    const hi = sold ? (price + 0.005) / 0.98 : (minPriceUsed + 0.005) / 0.98;
    const next = this.hypotheses.map(h => ({ ...h }));
    for (const h of next) {
      if (!h.possible) continue;
      const dist = hammingDistance(robotArch, h);
      if (dist === 2) {
        if (sold && price > 0.005) h.possible = false;
      } else if (dist === 0) {
        if (sold) h.pMaxLo = Math.max(h.pMaxLo, lo);
        h.pMaxHi = Math.min(h.pMaxHi, hi);
      } else {
        if (sold && lo > h.pMaxHi * h.fHi) h.possible = false;
        if (sold && hi < h.pMaxLo * h.fLo) h.possible = false;
        if (sold && h.pMaxHi > 0) h.fLo = Math.max(h.fLo, lo / h.pMaxHi);
        if (h.pMaxLo > 0) h.fHi = Math.min(h.fHi, hi / h.pMaxLo);
        if (sold && h.fHi > 0) h.pMaxLo = Math.max(h.pMaxLo, lo / h.fHi);
        if (h.fLo > 0) h.pMaxHi = Math.min(h.pMaxHi, hi / h.fLo);
      }
      if (h.pMaxLo > h.pMaxHi + 1e-9 || h.fLo > h.fHi + 1e-9) h.possible = false;
    }
    // Противоречие с моделью не доказывает, какое наблюдение неверно.
    if (next.some(h => h.possible)) {
      this.hypotheses = next;
      if (sold) this.salesCount++;
    } else {
      this.contradictions = (this.contradictions ?? 0) + 1;
    }
  }

  evaluateRobot(robotArch) {
    const valid = this.hypotheses.filter(h => h.possible);
    const weight = 1 / valid.length;

    let expectedPrice = 0;
    let prob2Match = 0;
    let prob1Match = 0;
    let min2MatchPrice = Infinity;
    let expected2MatchPrice = 0;
    let expected1MatchPrice = 0;

    for (const h of valid) {
      const dist = hammingDistance(robotArch, h);
      const midP = (h.pMaxLo + h.pMaxHi) * 0.5;
      const midF = (h.fLo + h.fHi) * 0.5;

      if (dist === 0) {
        prob2Match += weight;
        expectedPrice += weight * midP;
        expected2MatchPrice += weight * midP;
        min2MatchPrice = Math.min(min2MatchPrice, h.pMaxLo * 0.98);
      } else if (dist === 1) {
        prob1Match += weight;
        expectedPrice += weight * (midP * midF);
        expected1MatchPrice += weight * (midP * midF);
      }
    }

    if (prob2Match > 0) expected2MatchPrice /= prob2Match;
    if (prob1Match > 0) expected1MatchPrice /= prob1Match;

    return {
      expectedPrice: Math.min(this.priceCeiling, expectedPrice),
      prob2Match,
      prob1Match,
      min2MatchPrice: Math.min(this.priceCeiling, min2MatchPrice === Infinity ? this.priceCeiling : min2MatchPrice),
      expected2MatchPrice: Math.min(this.priceCeiling, expected2MatchPrice),
      expected1MatchPrice: Math.min(this.priceCeiling, expected1MatchPrice),
      uncertainty: valid.length
    };
  }
}

export class FactoryBot {
  constructor(startParams = {}, plannerOptions = {}) {
    this.plannerStats = { calls: 0, exhausted: 0 };
    this.plannerStart = startParams;
    this.eventTimeoutMs = startParams.eventTimeoutMs ?? 2000;
    this.plannerTimeMs = plannerOptions.timeBudgetMs ?? 5;
    this.plannerMaxCandidates = plannerOptions.maxCandidates ?? 1024;
    this.horizon = startParams.horizon ?? 650;
    this.capacity = startParams.capacity ?? 12;
    this.storageFee = startParams.storageFee ?? { sheet: 0.1, control: 0.1, body: 0.2, robot: 0.5 };
    this.offerFee = startParams.offerFee ?? 1;
    this.buyerCooldown = startParams.buyerCooldown ?? 8;
    this.priceCeiling = startParams.priceCeiling ?? 80;
    this.machinesCfg = parseMachinesConfig(startParams.machines);
    const rawBuyers = startParams.buyers || ['b1', 'b2', 'b3', 'b4'];
    this.buyers = new Map();
    for (const b of rawBuyers) {
      const id = typeof b === 'string' ? b : b.id;
      this.buyers.set(id, new BuyerBelief(id, this.priceCeiling));
    }

    this.lastOfferItems = new Map(); // копия предложенного робота для необязательного item
    this.lastOfferMinPrice = new Map(); // buyerId#itemId -> minPrice
    this.machineBusyUntil = new Map(); // machineId -> tick
    this.machineInFlight = new Map(); // machineId -> { opId, kind, color, handles, finishTick }
    this.seqCache = new Map(); // seq -> commands[] (идемпотентность)
    this.previousCommands = [];
  }

  handleEvent(payload) {
    const eventStarted = performance.now();
    const seq = payload?.seq;
    if (seq !== undefined && this.seqCache.has(seq)) {
      return this.seqCache.get(seq);
    }

    const t = payload?.t ?? 0;
    const event = payload?.event || {};
    const state = payload?.state || {};
    const commands = [];

    for (const entry of Array.isArray(payload?.report) ? payload.report : []) {
      if (entry?.ok !== false || !Number.isInteger(entry.cmd)) continue;
      const previous = this.previousCommands[entry.cmd];
      if (previous?.type === 'start') {
        this.machineBusyUntil.delete(previous.machineId);
        this.machineInFlight.delete(previous.machineId);
      } else if (previous?.type === 'offer') {
        this.lastOfferMinPrice.delete(`${previous.buyerId}#${previous.itemId}`);
        this.lastOfferItems.delete(`${previous.buyerId}#${previous.itemId}`);
        const buyer = this.buyers.get(previous.buyerId);
        const buyerState = Array.isArray(state.buyers) ? state.buyers.find(b => b.id === previous.buyerId) : state.buyers?.[previous.buyerId];
        if (buyer) {
          buyer.cooldownUntil = typeof buyerState?.cooldownUntil === 'number' ? buyerState.cooldownUntil : t;
          buyer.offersCount = Math.max(0, buyer.offersCount - 1);
        }
      }
    }

    // 1. Обработка входящего события для обновления внутренних знаний
    const evType = event.type || event.event;
    if (evType === 'machine_done') {
      if (event.machineId) {
        this.machineBusyUntil.delete(event.machineId);
        this.machineInFlight.delete(event.machineId);
      }
    } else if (evType === 'sale_result') {
      const buyer = this.buyers.get(event.buyerId);
      if (buyer) {
        if (event.reason !== 'cooldown') buyer.cooldownUntil = t + this.buyerCooldown;
        const key = `${event.buyerId}#${event.itemId}`;
        const minUsed = this.lastOfferMinPrice.get(key);
        const offeredItem = this.lastOfferItems.get(key);
        this.lastOfferMinPrice.delete(key);
        this.lastOfferItems.delete(key);
        const item = event.item ?? offeredItem;
        if (event.outcome === 'sold' || (event.outcome === 'refused' && event.reason === 'below_min_price')) {
          buyer.updateOnSaleResult(item, event.outcome, event.price, minUsed);
        }
      }
    }

    // Синхронизация кулдаунов покупателей со state (если арена передаёт их явно)
    if (state.buyers) {
      const bEntries = Array.isArray(state.buyers)
        ? state.buyers.map(b => [b.id, b])
        : Object.entries(state.buyers);
      for (const [bId, bState] of bEntries) {
        const belief = this.buyers.get(bId);
        if (!belief) continue;
        if (typeof bState.cooldownUntil === 'number') {
          belief.cooldownUntil = Math.max(belief.cooldownUntil, bState.cooldownUntil);
        } else if (typeof bState.cooldown === 'number' && bState.cooldown > 0) {
          belief.cooldownUntil = Math.max(belief.cooldownUntil, t + bState.cooldown);
        } else if (typeof bState.availableAt === 'number') {
          belief.cooldownUntil = Math.max(belief.cooldownUntil, bState.availableAt);
        }
      }
    }

    // 2. Снимок текущего склада и занятости станков
    const rawItems = state.storage?.items || state.items || state.inventory || [];
    const items = (rawItems || []).map(it => ({
      id: it.id,
      kind: it.kind || it.type,
      props: it.props || { color: it.color ?? null, handles: Boolean(it.handles) }
    }));

    const busyMachines = new Set();
    if (state.machines) {
      const mEntries = Array.isArray(state.machines)
        ? state.machines.map(m => [m.id || m.machineId, m])
        : Object.entries(state.machines);
      for (const [mId, mState] of mEntries) {
        const isBusy =
          Boolean(mState.busy) ||
          Boolean(mState.currentOp) ||
          (typeof mState.busyUntil === 'number' && mState.busyUntil >= t && mState.busy !== false) ||
          (typeof mState.remaining === 'number' && mState.remaining > 0);
        if (isBusy) {
          busyMachines.add(mId);
        } else {
          this.machineBusyUntil.delete(mId);
          this.machineInFlight.delete(mId);
        }
      }
    }
    for (const [mId, until] of this.machineBusyUntil.entries()) {
      if (until > t) busyMachines.add(mId);
    }

    let freeSlots = state.storage?.free ?? (this.capacity - items.length - busyMachines.size);
    const reservedItemIds = new Set();
    const ticksLeft = Math.max(0, this.horizon - t);

    // 4. Обработка поставки (supply)
    if (evType === 'supply' && event.item) {
      const supItem = {
        id: event.item.id || event.itemId,
        kind: event.item.kind || event.item.type,
        props: event.item.props || {}
      };

      const shouldAccept = this.decideAcceptSupply(supItem, items, busyMachines, freeSlots, ticksLeft);
      if (shouldAccept && supItem.id) {
        commands.push({ type: 'accept', itemId: supItem.id });
        items.push(supItem);
        freeSlots -= 1;
      }
    }

    // 5. Ограниченный прогноз; при нехватке бюджета — без производственных команд.
    const states = (Array.isArray(state.machines) ? state.machines : []).map(m => {
      if (!busyMachines.has(m.id)) return { id: m.id, busyUntil: null };
      return { id: m.id, busyUntil: Math.max(t, m.busyUntil ?? this.machineBusyUntil.get(m.id) ?? t + 1) };
    });
    for (const id of busyMachines) {
      if (!states.some(m => m.id === id)) states.push({ id, busyUntil: this.machineBusyUntil.get(id) ?? t + 1 });
    }
    const remainingTime = Math.max(0, this.eventTimeoutMs * 0.5 - (performance.now() - eventStarted));
    const plan = planProduction({ start: this.plannerStart, items, machines: states, freeSlots, t,
      horizon: this.horizon, buyers: [...this.buyers.values()], inFlight: [...this.machineInFlight.values()].map(inf => ({ kind: inf.kind, props: { color: inf.color, handles: inf.handles } })), maxCandidates: this.plannerMaxCandidates,
      timeBudgetMs: Math.min(this.plannerTimeMs, remainingTime) });
    this.plannerStats.calls++;
    if (plan.exhausted) this.plannerStats.exhausted++;
    for (const command of plan.commands) {
      const machine = this.plannerStart.machines?.find(m => m.id === command.machineId);
      const op = machine?.ops?.find(o => o.id === command.opId);
      if (!op) continue;
      const inputs = command.itemIds.map(id => items.find(item => item.id === id));
      const inherited = Number.isInteger(op.inherit) ? inputs[op.inherit]?.props : null;
      const props = { ...(inherited || {}), ...(op.output?.props || {}) };
      commands.push(command);
      for (const id of command.itemIds) reservedItemIds.add(id);
      busyMachines.add(command.machineId);
      this.machineBusyUntil.set(command.machineId, t + op.duration);
      this.machineInFlight.set(command.machineId, { opId: op.id, kind: op.output.kind,
        color: props.color ?? null, handles: Boolean(props.handles), finishTick: t + op.duration });
      freeSlots += command.itemIds.length - 1;
    }

    // 6. Продажи роботов (оптимальное паросочетание buyer <-> robot)
    const robots = items.filter(i => i.kind === 'robot' && !reservedItemIds.has(i.id));
    const readyBuyers = [...this.buyers.values()].filter(b => b.cooldownUntil <= t);

    if (robots.length > 0 && readyBuyers.length > 0) {
      const offers = this.planBestOffers(t, ticksLeft, freeSlots, robots, readyBuyers);
      for (const off of offers) {
        commands.push({
          type: 'offer',
          buyerId: off.buyerId,
          itemId: off.itemId,
          minPrice: off.minPrice
        });
        reservedItemIds.add(off.itemId);
        const offerKey = `${off.buyerId}#${off.itemId}`;
        this.lastOfferMinPrice.set(offerKey, off.minPrice);
        const offeredRobot = robots.find(robot => robot.id === off.itemId);
        if (offeredRobot) this.lastOfferItems.set(offerKey, { id: offeredRobot.id, kind: offeredRobot.kind, props: { ...offeredRobot.props } });
        const b = this.buyers.get(off.buyerId);
        if (b) {
          b.cooldownUntil = t + this.buyerCooldown;
          b.offersCount++;
        }
      }
    }

    // 7. Очистка склада (discard неликвидных роботов или затоваривания)
    const remainingRobots = items.filter(i => i.kind === 'robot' && !reservedItemIds.has(i.id));
    for (const rob of remainingRobots) {
      const arch = { color: rob.props.color, handles: Boolean(rob.props.handles) };
      let anyBuyerWants = false;
      let maxExp = 0;
      for (const b of this.buyers.values()) {
        const ev = b.evaluateRobot(arch);
        if (ev.expectedPrice > 1.0) anyBuyerWants = true;
        if (ev.expectedPrice > maxExp) maxExp = ev.expectedPrice;
      }

      // Если ни один покупатель не купит этот тип даже за >1 — выбрасываем сразу (экономим 0.5/такт и место)
      if (!anyBuyerWants) {
        commands.push({ type: 'discard', itemId: rob.id });
        reservedItemIds.add(rob.id);
        freeSlots += 1;
      } else if (freeSlots <= 0 && remainingRobots.length >= 3 && maxExp < 25) {
        // Экстренное освобождение места под приток сырья
        commands.push({ type: 'discard', itemId: rob.id });
        reservedItemIds.add(rob.id);
        freeSlots += 1;
      }
    }

    const finalCommands = commands.slice(0, 50);
    this.previousCommands = finalCommands;
    if (seq !== undefined) {
      this.seqCache.set(seq, finalCommands);
    }
    return finalCommands;
  }

  /**
   * Вычисляет приоритет каждого из 6 архетипов с учётом:
   * - ожидаемой цены у всех покупателей,
   * - бонуса за разведку неизвестных покупателей,
   * - штрафа за уже имеющиеся в инвентаре/работе копии этого архетипа.
   */
  computeArchetypeDemands(t, items) {
    const inPipeline = new Map();
    for (const a of ARCHETYPES) inPipeline.set(a.key, 0);

    for (const it of items) {
      if ((it.kind === 'robot' || it.kind === 'body') && it.props.color) {
        const k = archetypeKey(it.props.color, it.props.handles);
        inPipeline.set(k, (inPipeline.get(k) || 0) + 1);
      }
    }
    for (const inf of this.machineInFlight.values()) {
      if ((inf.kind === 'robot' || inf.kind === 'body') && inf.color) {
        const k = archetypeKey(inf.color, inf.handles);
        inPipeline.set(k, (inPipeline.get(k) || 0) + 1);
      }
    }

    const result = new Map();
    for (const arch of ARCHETYPES) {
      let totalWeightedPrice = 0;
      let immediateSaleScore = 0;
      let maxPossiblePrice = 0;
      let explorationBonus = 0;

      for (const buyer of this.buyers.values()) {
        const ev = buyer.evaluateRobot(arch);
        const cdPenalty = buyer.cooldownUntil <= t ? 1.0 : Math.max(0.45, 1 - (buyer.cooldownUntil - t) * 0.06);
        totalWeightedPrice += ev.expectedPrice * cdPenalty;

        if (buyer.cooldownUntil <= t && ev.prob2Match >= 0.45) {
          immediateSaleScore = Math.max(immediateSaleScore, ev.expected2MatchPrice);
        }
        if (ev.prob2Match > 0 || ev.prob1Match > 0) {
          maxPossiblePrice = Math.max(maxPossiblePrice, ev.expected2MatchPrice || ev.expected1MatchPrice);
        }
        // Бонус за разведку неизученного покупателя
        if (buyer.uncertainty > 1 && ev.prob2Match > 0) {
          explorationBonus += (14.0 / buyer.uncertainty) * cdPenalty;
        }
      }

      const existingCount = inPipeline.get(arch.key) || 0;
      // Диверсификация: снижаем приоритет, если такой тип уже лежит на складе или в сборке
      const congestionPenalty = existingCount * 24.0;
      const score = totalWeightedPrice + explorationBonus - congestionPenalty;

      result.set(arch.key, {
        score,
        immediateSaleScore,
        maxPossiblePrice,
        existingCount
      });
    }

    return result;
  }

  /**
   * Решение о приёме поставки sheet / control
   */
  decideAcceptSupply(supItem, items, busyMachines, freeSlots, ticksLeft) {
    if (freeSlots <= 0) return false;

    const kind = supItem.kind;
    const configured = cfg => !Array.isArray(this.plannerStart.machines) || this.plannerStart.machines.some(m => m?.id === cfg.machineId && m.ops?.some(op => op.id === cfg.opId));
    if (kind === 'sheet' && (!configured(this.machinesCfg.cut) || !configured(this.machinesCfg.assemble) || !COLORS.some(color => configured(this.machinesCfg.paint[color])))) return false;
    if (kind === 'control' && !configured(this.machinesCfg.assemble)) return false;
    if (kind === 'control' && !items.some(i => i.kind === 'body' && (i.props?.color || COLORS.some(color => configured(this.machinesCfg.paint[color])))) &&
        !(configured(this.machinesCfg.cut) && COLORS.some(color => configured(this.machinesCfg.paint[color])))) return false;
    const minPaint = Math.min(...COLORS.filter(color => configured(this.machinesCfg.paint[color])).map(color => this.machinesCfg.paint[color].duration));
    if (kind === 'sheet' && ticksLeft < this.machinesCfg.cut.duration + minPaint + this.machinesCfg.assemble.duration) return false;
    if (kind === 'control' && ticksLeft < this.machinesCfg.assemble.duration) return false;

    // Подсчёт баланса sheet-ветки и control-ветки в системе
    let sheetSide = items.filter(i => i.kind === 'sheet' || i.kind === 'body').length;
    let controlSide = items.filter(i => i.kind === 'control').length;

    for (const inf of this.machineInFlight.values()) {
      if (inf.kind === 'body') sheetSide += 1;
    }

    // Если свободное место всего 1:
    // Принимаем control ТОЛЬКО если сразу сможем запустить сборку (освободит место!)
    if (freeSlots === 1) {
      if (kind === 'control') {
        const hasColoredBody = items.some(i => i.kind === 'body' && i.props.color);
        const asmIdle = !busyMachines.has(this.machinesCfg.assemble.machineId);
        return hasColoredBody && asmIdle;
      }
      return false;
    }

    // Если свободных мест >= 2: контролируем перекос между sheet и control
    if (kind === 'sheet') {
      if (sheetSide - controlSide >= 3 && freeSlots <= 4) return false;
      return true;
    }

    if (kind === 'control') {
      if (controlSide - sheetSide >= 3 && freeSlots <= 4) return false;
      return true;
    }

    return freeSlots >= 2;
  }

  /**
   * Поиск максимального по ожидаемой прибыли паросочетания роботов и свободных покупателей
   */
  planBestOffers(t, ticksLeft, freeSlots, robots, readyBuyers) {
    const endGame = ticksLeft <= 18;
    const warehouseCrowded = freeSlots <= 1 && robots.length >= 2;

    // Строим матрицу кандидатов (robotIdx, buyerIdx) -> { utility, minPrice }
    const candidates = robots.map(rob => {
      const arch = { color: rob.props.color, handles: Boolean(rob.props.handles) };
      return readyBuyers.map(buyer => {
        const ev = buyer.evaluateRobot(arch);

        // 1. Точное или высоковероятное 2-совпадение (или разведка возможного 2-совпадения)
        if (ev.prob2Match > 0) {
          const reserve = Math.min(this.priceCeiling, Math.max(43.5, Math.min(73.0, Math.floor(ev.min2MatchPrice * 10) / 10)));
          // Приоритет: подтверждённые продажи выше разведки
          const utility =
            ev.prob2Match * ev.expected2MatchPrice -
            this.offerFee +
            (buyer.uncertainty > 1 ? 6.0 : 12.0);
          return { utility, minPrice: reserve };
        }

        // 2. В конце смены или при переполнении склада — продаём 1-совпадение по Pmax*f
        if ((endGame || warehouseCrowded) && ev.prob1Match > 0.3 && ev.expected1MatchPrice >= 15.0) {
          const reserve = Math.min(this.priceCeiling, 13.0);
          const utility = ev.prob1Match * ev.expected1MatchPrice - this.offerFee - 5.0;
          return { utility, minPrice: reserve };
        }

        return null;
      });
    });

    // Перебор паросочетаний (<= 4 покупателей => максимум P(12, 4) небольшое, ограничиваем топ-6 роботов)
    const topRobotIndices = robots
      .map((_, idx) => idx)
      .slice(0, 6);

    let bestTotalUtility = 0;
    let bestPairs = [];

    const usedBuyers = new Set();
    const currentPairs = [];

    const dfs = (rPos, accUtility) => {
      if (accUtility > bestTotalUtility) {
        bestTotalUtility = accUtility;
        bestPairs = [...currentPairs];
      }
      if (rPos >= topRobotIndices.length) return;

      const rIdx = topRobotIndices[rPos];

      // Вариант 1: предложить этого робота одному из свободных покупателей
      for (let bIdx = 0; bIdx < readyBuyers.length; bIdx++) {
        if (usedBuyers.has(bIdx)) continue;
        const edge = candidates[rIdx][bIdx];
        if (!edge || edge.utility <= 0) continue;

        usedBuyers.add(bIdx);
        currentPairs.push({
          buyerId: readyBuyers[bIdx].buyerId,
          itemId: robots[rIdx].id,
          minPrice: edge.minPrice
        });
        dfs(rPos + 1, accUtility + edge.utility);
        currentPairs.pop();
        usedBuyers.delete(bIdx);
      }

      // Вариант 2: пока не предлагать этого робота
      dfs(rPos + 1, accUtility);
    };

    dfs(0, 0);
    return bestPairs;
  }
}

/**
 * Уровень 1 (Наивный бот) — для сравнения в бенчмарке
 */
export class NaiveBot {
  constructor(startParams = {}) {
    this.capacity = startParams.capacity ?? 12;
    this.buyerCooldown = startParams.buyerCooldown ?? 8;
    this.machinesCfg = parseMachinesConfig(startParams.machines);
    const rawBuyers = startParams.buyers || ['b1', 'b2', 'b3', 'b4'];
    this.buyerIds = rawBuyers.map(b => (typeof b === 'string' ? b : b.id));
    this.cooldowns = new Map(this.buyerIds.map(id => [id, 0]));
    this.colorIdx = 0;
  }

  handleEvent(payload) {
    const t = payload?.t ?? 0;
    const event = payload?.event || {};
    const state = payload?.state || {};
    const commands = [];
    const evType = event.type || event.event;

    if (evType === 'sale_result' && event.buyerId) {
      this.cooldowns.set(event.buyerId, t + this.buyerCooldown);
    }

    const items = ((state.storage?.items || state.items || state.inventory || []) || []).map(it => ({
      id: it.id,
      kind: it.kind || it.type,
      props: it.props || { color: it.color ?? null, handles: Boolean(it.handles) }
    }));

    const busy = new Set();
    if (state.machines) {
      const entries = Array.isArray(state.machines) ? state.machines.map(m => [m.id, m]) : Object.entries(state.machines);
      for (const [mId, mState] of entries) {
        if (mState.busy || mState.currentOp || (mState.busyUntil != null && mState.busyUntil >= t && mState.busy !== false)) {
          busy.add(mId);
        }
      }
    }

    const free = state.storage?.free ?? (this.capacity - items.length - busy.size);
    if (evType === 'supply' && event.item && free >= 1) {
      const id = event.item.id || event.itemId;
      commands.push({ type: 'accept', itemId: id });
      items.push({ id, kind: event.item.kind || event.item.type, props: event.item.props || {} });
    }

    const used = new Set();
    const sheet = items.find(i => i.kind === 'sheet');
    if (sheet && !busy.has(this.machinesCfg.cut.machineId)) {
      commands.push({ type: 'start', machineId: this.machinesCfg.cut.machineId, opId: this.machinesCfg.cut.opId, itemIds: [sheet.id] });
      used.add(sheet.id);
    }

    const rawBody = items.find(i => i.kind === 'body' && !i.props.color && !used.has(i.id));
    if (rawBody && !busy.has(this.machinesCfg.paint.red.machineId)) {
      const c = COLORS[this.colorIdx++ % 3];
      const p = this.machinesCfg.paint[c];
      commands.push({ type: 'start', machineId: p.machineId, opId: p.opId, itemIds: [rawBody.id] });
      used.add(rawBody.id);
    }

    const coloredBody = items.find(i => i.kind === 'body' && i.props.color && !used.has(i.id));
    const ctrl = items.find(i => i.kind === 'control' && !used.has(i.id));
    if (coloredBody && ctrl && !busy.has(this.machinesCfg.assemble.machineId)) {
      commands.push({
        type: 'start',
        machineId: this.machinesCfg.assemble.machineId,
        opId: this.machinesCfg.assemble.opId,
        itemIds: [coloredBody.id, ctrl.id]
      });
      used.add(coloredBody.id);
      used.add(ctrl.id);
    }

    const robot = items.find(i => i.kind === 'robot' && !used.has(i.id));
    if (robot) {
      const freeBuyer = this.buyerIds.find(id => (this.cooldowns.get(id) ?? 0) <= t);
      if (freeBuyer) {
        commands.push({ type: 'offer', buyerId: freeBuyer, itemId: robot.id, minPrice: 0 });
        this.cooldowns.set(freeBuyer, t + this.buyerCooldown);
      }
    }

    return commands;
  }
}

// ===== Совместимость с тестами и CLI: createBot / createNaiveBot =====

function wrapHandle(bot) {
  return (payload) => {
    if (!payload || typeof payload !== 'object') return { commands: [] };
    const commands = bot.handleEvent(payload) || [];
    return { commands: commands.map((c) => ({ ...c, cmd: c.type })) };
  };
}

export function createBot(config = {}) {
  const bot = new FactoryBot({
    horizon: config.horizon ?? 650,
    capacity: config.capacity ?? 12,
    storageFee: config.storageFee,
    offerFee: config.offerFee,
    buyerCooldown: config.buyerCooldown ?? 8,
    buyers: config.buyers,
    machines: config.machines,
  });
  bot.world = config;
  bot.handle = wrapHandle(bot);
  bot.belief = () => bot.buyers;
  return bot;
}

export function createNaiveBot(config = {}) {
  const bot = new NaiveBot({
    capacity: config.capacity ?? 12,
    buyerCooldown: config.buyerCooldown ?? 8,
    buyers: config.buyers,
    machines: config.machines,
  });
  bot.world = config;
  bot.handle = wrapHandle(bot);
  return bot;
}
