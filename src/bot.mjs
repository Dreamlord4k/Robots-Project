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
      } else if (mId === 'm-handles' || out.handles === true) {
        cfg.handles = { machineId: mId, opId, duration: dur, cost };
      } else if (mId === 'm-paint' || (out.color && COLORS.includes(out.color))) {
        const c = out.color || COLORS.find(col => opId.toLowerCase().includes(col));
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
  constructor(buyerId) {
    this.buyerId = buyerId;
    this.cooldownUntil = 0;
    this.salesCount = 0;
    this.offersCount = 0;
    this.hypotheses = ARCHETYPES.map(arch => ({
      ...arch,
      possible: true,
      pMaxLo: 45.0,
      pMaxHi: 75.0,
      fLo: 0.3,
      fHi: 0.6
    }));
  }

  updateOnSaleResult(item, outcome, price, minPriceUsed) {
    if (!item || !item.props || !item.props.color) return;
    const robotArch = { color: item.props.color, handles: Boolean(item.props.handles) };

    if (outcome === 'sold' && typeof price === 'number' && price > 0) {
      this.salesCount++;
      for (const h of this.hypotheses) {
        if (!h.possible) continue;
        const dist = hammingDistance(robotArch, h);
        if (dist === 2) {
          // 0 совпадений всегда дают цену 0
          h.possible = false;
        } else if (dist === 0) {
          // price = Pmax * (1 ± 0.02)
          h.pMaxLo = Math.max(h.pMaxLo, price / 1.02);
          h.pMaxHi = Math.min(h.pMaxHi, price / 0.98);
          if (h.pMaxLo > h.pMaxHi + 1e-4) {
            h.possible = false;
          }
        } else if (dist === 1) {
          // price = Pmax * f * (1 ± 0.02)
          const prodLo = price / 1.02;
          const prodHi = price / 0.98;
          if (prodLo > 75.0 * 0.6 + 1e-4 || prodHi < 45.0 * 0.3 - 1e-4) {
            h.possible = false;
          } else {
            h.fLo = Math.max(h.fLo, prodLo / h.pMaxHi);
            h.fHi = Math.min(h.fHi, prodHi / h.pMaxLo);
            h.pMaxLo = Math.max(h.pMaxLo, prodLo / h.fHi);
            h.pMaxHi = Math.min(h.pMaxHi, prodHi / h.fLo);
            if (h.fLo > h.fHi + 1e-4 || h.pMaxLo > h.pMaxHi + 1e-4) {
              h.possible = false;
            }
          }
        }
      }
    } else if (outcome === 'refused') {
      const threshold = typeof minPriceUsed === 'number' ? minPriceUsed : 44.0;
      for (const h of this.hypotheses) {
        if (!h.possible) continue;
        const dist = hammingDistance(robotArch, h);
        if (dist === 0) {
          // Отказ означает actualPrice < threshold => Pmax * 0.98 < threshold
          h.pMaxHi = Math.min(h.pMaxHi, threshold / 0.98);
          if (h.pMaxHi < 45.0 - 1e-4) {
            h.possible = false;
          }
        } else if (dist === 1) {
          // Pmax * f * 0.98 < threshold
          const maxProd = threshold / 0.98;
          h.fHi = Math.min(h.fHi, maxProd / h.pMaxLo);
          if (h.fHi < 0.3 - 1e-4) {
            h.possible = false;
          }
        }
      }
    }

    // Страховка от вырождения при экстремальных шумах
    if (!this.hypotheses.some(h => h.possible)) {
      for (const h of this.hypotheses) {
        h.possible = true;
        h.pMaxLo = 45.0;
        h.pMaxHi = 75.0;
        h.fLo = 0.3;
        h.fHi = 0.6;
      }
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
      expectedPrice,
      prob2Match,
      prob1Match,
      min2MatchPrice: min2MatchPrice === Infinity ? 44.0 : min2MatchPrice,
      expected2MatchPrice,
      expected1MatchPrice,
      uncertainty: valid.length
    };
  }
}

export class FactoryBot {
  constructor(startParams = {}) {
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
      this.buyers.set(id, new BuyerBelief(id));
    }

    this.lastOfferMinPrice = new Map(); // buyerId#itemId -> minPrice
    this.machineBusyUntil = new Map(); // machineId -> tick
    this.machineInFlight = new Map(); // machineId -> { opId, kind, color, handles, finishTick }
    this.seqCache = new Map(); // seq -> commands[] (идемпотентность)
  }

  handleEvent(payload) {
    const seq = payload?.seq;
    if (seq !== undefined && this.seqCache.has(seq)) {
      return this.seqCache.get(seq);
    }

    const t = payload?.t ?? 0;
    const event = payload?.event || {};
    const state = payload?.state || {};
    const commands = [];

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
        buyer.cooldownUntil = t + this.buyerCooldown;
        const key = `${event.buyerId}#${event.itemId}`;
        const minUsed = this.lastOfferMinPrice.get(key) ?? 44.0;
        this.lastOfferMinPrice.delete(key);
        buyer.updateOnSaleResult(event.item, event.outcome, event.price, minUsed);
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
        if (typeof bState.cooldown === 'number' && bState.cooldown > 0) {
          belief.cooldownUntil = Math.max(belief.cooldownUntil, t + bState.cooldown);
        } else if (typeof bState.availableAt === 'number') {
          belief.cooldownUntil = Math.max(belief.cooldownUntil, bState.availableAt);
        }
      }
    }

    // 2. Снимок текущего склада и занятости станков
    const rawItems = state.items || state.inventory || [];
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
          (typeof mState.busyUntil === 'number' && mState.busyUntil > t) ||
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

    let freeSlots = this.capacity - items.length - busyMachines.size;
    const reservedItemIds = new Set();
    const ticksLeft = Math.max(0, this.horizon - t);

    // 3. Оценка спроса на каждый из 6 архетипов роботов
    const demandMap = this.computeArchetypeDemands(t, items);

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

    // 5. Планирование станков (от финиша к старту для разгрузки склада)

    // 5A. m-assemble: [body(colored), control] -> robot
    const asmCfg = this.machinesCfg.assemble;
    if (!busyMachines.has(asmCfg.machineId) && ticksLeft >= asmCfg.duration) {
      const availControls = items.filter(i => i.kind === 'control' && !reservedItemIds.has(i.id));
      const availBodies = items.filter(
        i => i.kind === 'body' && i.props.color && !reservedItemIds.has(i.id)
      );

      if (availControls.length > 0 && availBodies.length > 0) {
        // Выбираем тело, которое нужно прямо сейчас и готово к сборке
        let bestBody = null;
        let bestScore = -Infinity;

        for (const body of availBodies) {
          const archKey = archetypeKey(body.props.color, body.props.handles);
          const demand = demandMap.get(archKey);
          const needsHandlesLater =
            !body.props.handles &&
            (demandMap.get(archetypeKey(body.props.color, true))?.score ?? 0) >
              (demand?.score ?? 0) * 1.25;

          // Если телу лучше сначала приделать ручки, и станок ручек свободен (или есть время) — ждём
          if (needsHandlesLater && ticksLeft >= asmCfg.duration + this.machinesCfg.handles.duration + 1) {
            continue;
          }

          const score = (demand?.immediateSaleScore ?? 0) * 2 + (demand?.score ?? 0);
          if (score > bestScore && (demand?.maxPossiblePrice ?? 0) > 0) {
            bestScore = score;
            bestBody = body;
          }
        }

        // Если подходящего не нашлось, но склад забит или конец смены — собираем лучшее доступное
        if (!bestBody && (freeSlots <= 1 || ticksLeft <= asmCfg.duration + 2)) {
          availBodies.sort((a, b) => {
            const sa = demandMap.get(archetypeKey(a.props.color, a.props.handles))?.score ?? 0;
            const sb = demandMap.get(archetypeKey(b.props.color, b.props.handles))?.score ?? 0;
            return sb - sa;
          });
          if ((demandMap.get(archetypeKey(availBodies[0].props.color, availBodies[0].props.handles))?.maxPossiblePrice ?? 0) > 0) {
            bestBody = availBodies[0];
          }
        }

        if (bestBody) {
          const ctrl = availControls[0];
          const itemIds = asmCfg.bodyFirst ? [bestBody.id, ctrl.id] : [ctrl.id, bestBody.id];
          commands.push({
            type: 'start',
            machineId: asmCfg.machineId,
            opId: asmCfg.opId,
            itemIds
          });
          reservedItemIds.add(bestBody.id);
          reservedItemIds.add(ctrl.id);
          busyMachines.add(asmCfg.machineId);
          this.machineBusyUntil.set(asmCfg.machineId, t + asmCfg.duration);
          this.machineInFlight.set(asmCfg.machineId, {
            opId: asmCfg.opId,
            kind: 'robot',
            color: bestBody.props.color,
            handles: Boolean(bestBody.props.handles),
            finishTick: t + asmCfg.duration
          });
          // 2 предмета ушли со склада, 1 место зарезервировано под результат => +1 свободное место
          freeSlots += 1;
        }
      }
    }

    // 5B. m-handles: body(handles: false) -> body(handles: true, inherit color)
    const hndCfg = this.machinesCfg.handles;
    if (!busyMachines.has(hndCfg.machineId) && ticksLeft >= hndCfg.duration + asmCfg.duration) {
      const noHandleBodies = items.filter(
        i => i.kind === 'body' && !i.props.handles && !reservedItemIds.has(i.id)
      );

      let targetBody = null;
      let bestGain = 0;

      for (const body of noHandleBodies) {
        if (body.props.color) {
          // Окрашенное тело без ручек: проверяем, выгоднее ли добавить ручки
          const withoutH = demandMap.get(archetypeKey(body.props.color, false))?.score ?? 0;
          const withH = demandMap.get(archetypeKey(body.props.color, true))?.score ?? 0;
          const gain = withH - withoutH;
          if (gain > 2.5 && gain > bestGain) {
            bestGain = gain;
            targetBody = body;
          }
        } else {
          // Неокрашенное тело: ставим ручки заранее, если m-paint занят и ручки нужны для топ-архетипа
          const paintBusy = busyMachines.has(this.machinesCfg.paint.red.machineId);
          const bestWithH = Math.max(
            ...COLORS.map(c => demandMap.get(archetypeKey(c, true))?.score ?? 0)
          );
          const bestNoH = Math.max(
            ...COLORS.map(c => demandMap.get(archetypeKey(c, false))?.score ?? 0)
          );
          if ((paintBusy || noHandleBodies.length >= 2) && bestWithH >= bestNoH * 0.9 && bestWithH > 10) {
            const gain = bestWithH * 0.5;
            if (gain > bestGain) {
              bestGain = gain;
              targetBody = body;
            }
          }
        }
      }

      if (targetBody) {
        commands.push({
          type: 'start',
          machineId: hndCfg.machineId,
          opId: hndCfg.opId,
          itemIds: [targetBody.id]
        });
        reservedItemIds.add(targetBody.id);
        busyMachines.add(hndCfg.machineId);
        this.machineBusyUntil.set(hndCfg.machineId, t + hndCfg.duration);
        this.machineInFlight.set(hndCfg.machineId, {
          opId: hndCfg.opId,
          kind: 'body',
          color: targetBody.props.color ?? null,
          handles: true,
          finishTick: t + hndCfg.duration
        });
      }
    }

    // 5C. m-paint: body(color: null) -> body(color: c, inherit handles)
    const anyPaintMachineId = this.machinesCfg.paint.red.machineId;
    if (!busyMachines.has(anyPaintMachineId) && ticksLeft >= 3 + asmCfg.duration) {
      const unpaintedBodies = items.filter(
        i => i.kind === 'body' && !i.props.color && !reservedItemIds.has(i.id)
      );
      const paintedBodiesCount = items.filter(i => i.kind === 'body' && i.props.color).length;
      const assembleBusy = busyMachines.has(asmCfg.machineId);

      // Буфер-контроль (Level 3): не красим, если сборка занята и склад уже забит окрашенными телами
      const bufferBlocked = assembleBusy && (paintedBodiesCount >= 2 || freeSlots <= 1);

      if (unpaintedBodies.length > 0 && !bufferBlocked) {
        // Предпочитаем тело, у которого уже есть нужные handles, или выбираем лучший цвет под тело
        let bestChoice = null;
        let bestScore = -Infinity;

        for (const body of unpaintedBodies) {
          const hasH = Boolean(body.props.handles);
          for (const color of COLORS) {
            const directScore = demandMap.get(archetypeKey(color, hasH))?.score ?? 0;
            const withHandlesLaterScore = !hasH
              ? (demandMap.get(archetypeKey(color, true))?.score ?? 0) - 2.0
              : -Infinity;
            const effectiveScore = Math.max(directScore, withHandlesLaterScore);

            if (effectiveScore > bestScore) {
              bestScore = effectiveScore;
              bestChoice = { body, color };
            }
          }
        }

        if (bestChoice && bestScore > 0) {
          const pCfg = this.machinesCfg.paint[bestChoice.color];
          commands.push({
            type: 'start',
            machineId: pCfg.machineId,
            opId: pCfg.opId,
            itemIds: [bestChoice.body.id]
          });
          reservedItemIds.add(bestChoice.body.id);
          busyMachines.add(pCfg.machineId);
          this.machineBusyUntil.set(pCfg.machineId, t + pCfg.duration);
          this.machineInFlight.set(pCfg.machineId, {
            opId: pCfg.opId,
            kind: 'body',
            color: bestChoice.color,
            handles: Boolean(bestChoice.body.props.handles),
            finishTick: t + pCfg.duration
          });
        }
      }
    }

    // 5D. m-cut: sheet -> body(null, false)
    const cutCfg = this.machinesCfg.cut;
    if (!busyMachines.has(cutCfg.machineId) && ticksLeft >= cutCfg.duration + 6) {
      const availSheets = items.filter(i => i.kind === 'sheet' && !reservedItemIds.has(i.id));
      if (availSheets.length > 0) {
        commands.push({
          type: 'start',
          machineId: cutCfg.machineId,
          opId: cutCfg.opId,
          itemIds: [availSheets[0].id]
        });
        reservedItemIds.add(availSheets[0].id);
        busyMachines.add(cutCfg.machineId);
        this.machineBusyUntil.set(cutCfg.machineId, t + cutCfg.duration);
        this.machineInFlight.set(cutCfg.machineId, {
          opId: cutCfg.opId,
          kind: 'body',
          color: null,
          handles: false,
          finishTick: t + cutCfg.duration
        });
      }
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
        this.lastOfferMinPrice.set(`${off.buyerId}#${off.itemId}`, off.minPrice);
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
    if (kind === 'sheet' && ticksLeft < 9) return false;
    if (kind === 'control' && ticksLeft < 4) return false;

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
          const reserve = Math.max(43.5, Math.min(73.0, Math.floor(ev.min2MatchPrice * 10) / 10));
          // Приоритет: подтверждённые продажи выше разведки
          const utility =
            ev.prob2Match * ev.expected2MatchPrice -
            this.offerFee +
            (buyer.uncertainty > 1 ? 6.0 : 12.0);
          return { utility, minPrice: reserve };
        }

        // 2. В конце смены или при переполнении склада — продаём 1-совпадение по Pmax*f
        if ((endGame || warehouseCrowded) && ev.prob1Match > 0.3 && ev.expected1MatchPrice >= 15.0) {
          const reserve = 13.0;
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

    const items = ((state.items || state.inventory || []) || []).map(it => ({
      id: it.id,
      kind: it.kind || it.type,
      props: it.props || { color: it.color ?? null, handles: Boolean(it.handles) }
    }));

    const busy = new Set();
    if (state.machines) {
      for (const [mId, mState] of Object.entries(state.machines)) {
        if (mState.busy || mState.currentOp || (mState.busyUntil && mState.busyUntil > t)) {
          busy.add(mId);
        }
      }
    }

    const free = this.capacity - items.length - busy.size;
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
