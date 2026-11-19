function createMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_MACHINES = {
  'm-cut': {
    ops: {
      cut: {
        duration: 2,
        cost: 1,
        inputs: [{ kind: 'sheet' }],
        output: { kind: 'body', props: { color: null, handles: false } }
      }
    }
  },
  'm-handles': {
    ops: {
      'add-handles': {
        duration: 2,
        cost: 2,
        inputs: [{ kind: 'body', props: { color: null, handles: false } }],
        inherit: 0,
        output: { kind: 'body', props: { handles: true } }
      }
    }
  },
  'm-paint': {
    ops: {
      'paint-red': {
        duration: 3,
        cost: 2,
        inputs: [{ kind: 'body', props: { color: null } }],
        inherit: 0,
        output: { kind: 'body', props: { color: 'red' } }
      },
      'paint-green': {
        duration: 3,
        cost: 2,
        inputs: [{ kind: 'body', props: { color: null } }],
        inherit: 0,
        output: { kind: 'body', props: { color: 'green' } }
      },
      'paint-blue': {
        duration: 3,
        cost: 2,
        inputs: [{ kind: 'body', props: { color: null } }],
        inherit: 0,
        output: { kind: 'body', props: { color: 'blue' } }
      }
    }
  },
  'm-assemble': {
    ops: {
      assemble: {
        duration: 3,
        cost: 3,
        inputs: [{ kind: 'body', props: { color: '*' } }, { kind: 'control' }],
        inherit: 0,
        output: { kind: 'robot' }
      }
    }
  }
};

export class ArenaEmulator {
  constructor(options = {}) {
    this.seed = options.seed ?? 42;
    this.rng = createMulberry32(this.seed);
    this.horizon = options.horizon ?? 650;
    this.capacity = options.capacity ?? 12;
    this.idleEvery = options.idleEvery ?? 5;
    this.eventTimeoutMs = options.eventTimeoutMs ?? 2000;
    this.maxTimeouts = options.maxTimeouts ?? 20;
    this.now = options.now ?? (() => performance.now());
    this.consecutiveErrors = 0;
    this.stopReason = null;
    this.storageFee = { sheet: 0.1, control: 0.1, body: 0.2, robot: 0.5 };
    this.offerFee = 1;
    this.buyerCooldown = 8;
    this.priceCeiling = 80;
    this.machinesDef = structuredClone(DEFAULT_MACHINES);

    this.t = 0;
    this.seq = 0;
    this.idSeq = 1;

    this.money = 0;
    this.items = []; // { id, kind, props: { color, handles } }
    this.machines = {
      'm-cut': { busy: false, busyUntil: 0, currentOp: null, busyTicks: 0 },
      'm-handles': { busy: false, busyUntil: 0, currentOp: null, busyTicks: 0 },
      'm-paint': { busy: false, busyUntil: 0, currentOp: null, busyTicks: 0 },
      'm-assemble': { busy: false, busyUntil: 0, currentOp: null, busyTicks: 0 }
    };

    const colors = ['red', 'green', 'blue'];
    const archetypes = [];
    for (const c of colors) {
      for (const h of [false, true]) {
        archetypes.push({ color: c, handles: h });
      }
    }
    this.buyers = ['b1', 'b2', 'b3', 'b4'].map(id => ({
      id,
      // Выбор с возвращением: разные покупатели могут хотеть одного робота.
      sample: { ...archetypes[Math.floor(this.rng() * archetypes.length)] },
      pMax: Math.round((45 + this.rng() * 30) * 100) / 100,
      f: Math.round((0.3 + this.rng() * 0.3) * 1000) / 1000,
      cooldown: 0
    }));

    // Независимые генераторы сохраняют поток поставок при разных решениях ботов.
    this.supplyRng = {
      sheet: createMulberry32((this.seed ^ 0x51ee7) >>> 0),
      control: createMulberry32((this.seed ^ 0xc017201) >>> 0)
    };
    this.nextSupplyTick = Object.fromEntries(Object.entries(this.supplyRng)
      .map(([kind, rng]) => [kind, 2 + Math.floor(rng() * 3)]));
    this.currentSupply = null;
    this.previousReport = [];
    this.pendingSales = []; // { deliverTick, buyerId, item, minPrice }

    this.stats = {
      revenue: 0,
      purchases: 0,
      opCosts: 0,
      offerFees: 0,
      storageCosts: 0,
      penalties: 0,
      robotsSold: 0,
      robotsProduced: 0,
      robotsDiscarded: 0,
      timeouts: 0,
      errors: 0,
      failedEvents: [],
      invalidCommands: [],
      history: [] // для графиков веб-интерфейса
    };
  }

  getStartPayload() {
    return {
      runId: 'local-emulator',
      mode: 'practice',
      horizon: this.horizon,
      eventTimeoutMs: this.eventTimeoutMs,
      idleEvery: this.idleEvery,
      attributes: { color: ['red', 'green', 'blue'], handles: [true, false] },
      capacity: this.capacity,
      storageFee: this.storageFee,
      offerFee: this.offerFee,
      buyerCooldown: this.buyerCooldown,
      priceCeiling: this.priceCeiling,
      buyers: this.buyers.map(b => b.id),
      machines: Object.entries(this.machinesDef).map(([id, machine]) => ({ id, ops: Object.entries(machine.ops).map(([opId, op]) => ({ ...structuredClone(op), id: opId })) }))
    };
  }

  getPublicState() {
    const machines = Object.entries(this.machines).map(([id, m]) => ({ id, busyUntil: m.busy ? m.busyUntil : null }));
    const buyers = this.buyers.map(b => ({ id: b.id, cooldownUntil: b.cooldown > 0 ? this.t + b.cooldown : null }));
    return {
      cash: Math.round(this.money * 100) / 100,
      storage: { capacity: this.capacity, free: this.capacity - this.items.length - machines.filter(m => m.busyUntil !== null).length, items: structuredClone(this.items) },
      machines,
      buyers
    };
  }

  /**
   * Прогон полной смены [0 .. horizon] с переданным ботом
   */
  runFullShift(bot) {
    shift: for (let tick = 0; tick <= this.horizon; tick++) {
      this.t = tick;
      this.currentSupply = null;
      const seqAtStart = this.seq;

      // 1. Снижаем кулдауны покупателей
      for (const b of this.buyers) {
        if (b.cooldown > 0) b.cooldown--;
      }

      // 2. События machine_done
      for (const [mId, m] of Object.entries(this.machines)) {
        if (m.busy && m.busyUntil === tick && m.currentOp) {
          const produced = m.currentOp.outputItem;
          if (produced.kind === 'robot') this.stats.robotsProduced++;
          const opId = m.currentOp.opId;
          m.busy = false;
          m.currentOp = null;
          this.items.push(produced);

          this.dispatchEvent(bot, {
            type: 'machine_done',
            machineId: mId,
            opId,
            item: structuredClone(produced)
          });
          if (this.stopReason) break shift;
        }
      }

      // 3. Каждый вид приходит независимо с интервалом 2–4 такта.
      for (const kind of ['sheet', 'control']) {
        if (tick !== this.nextSupplyTick[kind]) continue;
        const price = kind === 'sheet' ? 4 : 3;
        const item = {
          id: `s-${this.idSeq++}`,
          kind,
          props: {}
        };
        this.currentSupply = { item, price, accepted: false };
        this.nextSupplyTick[kind] = tick + 2 + Math.floor(this.supplyRng[kind]() * 3);

        this.dispatchEvent(bot, {
          type: 'supply',
          item: structuredClone(item),
          price
        });
        if (this.stopReason) break shift;
        this.currentSupply = null;
      }

      // 4. Событие idle (раз в idleEvery тактов)
      if (tick % this.idleEvery === 0 && this.seq === seqAtStart) {
        this.dispatchEvent(bot, { type: 'idle' });
        if (this.stopReason) break shift;
      }

      // 6. Учёт загрузки станков и списание хранения в конце такта
      for (const m of Object.values(this.machines)) {
        if (m.busy) m.busyTicks++;
      }

      let tickStorage = 0;
      for (const it of this.items) {
        tickStorage += this.storageFee[it.kind] ?? 0.1;
      }
      this.money -= tickStorage;
      this.stats.storageCosts += tickStorage;

      this.stats.history.push({
        t: tick,
        money: Math.round(this.money * 100) / 100,
        itemsCount: this.items.length,
        busyCount: Object.values(this.machines).filter(m => m.busy).length
      });
    }

    return this.getReport();
  }

  dispatchEvent(bot, event) {
    let nextEvent = event;
    do {
      this.seq++;
      const payload = {
        seq: this.seq,
        t: this.t,
        event: nextEvent,
        state: this.getPublicState(),
        report: this.previousReport
      };
      const started = this.now();
      let commands;
      let failure = null;
      try {
        commands = bot.handleEvent(payload);
      } catch {
        failure = 'error';
      }
      const elapsedMs = this.now() - started;
      if (elapsedMs > this.eventTimeoutMs) failure = 'timeout';
      else if (!failure && !Array.isArray(commands)) failure = 'error';
      if (failure) {
        this.stats[failure === 'timeout' ? 'timeouts' : 'errors']++;
        this.stats.failedEvents.push({ seq: this.seq, t: this.t, reason: failure, elapsedMs });
        this.consecutiveErrors++;
        commands = [];
        // ТЗ неоднозначно о границе; используем формулировку «больше maxTimeouts».
        if (this.consecutiveErrors > this.maxTimeouts) this.stopReason = 'max_timeouts';
      } else {
        this.consecutiveErrors = 0;
      }
      this.previousReport = this.executeCommands(commands.slice(0, 50));
      // Поставка доступна только при обработке её собственного события.
      this.currentSupply = null;
      nextEvent = this.pendingSales.shift()?.event;
    } while (nextEvent && !this.stopReason);
  }

  executeCommands(commands) {
    const report = [];
    for (let index = 0; index < commands.length; index++) {
      const command = commands[index];
      const before = this.stats.invalidCommands.length;
      this.executeCommand(command);
      const failure = this.stats.invalidCommands[before];
      report.push(failure ? { cmd: index, ok: false, reason: failure.reason } : { cmd: index, ok: true });
    }
    return report;
  }

  executeCommand(command) {
    for (const cmd of [command && { ...command, type: command.cmd ?? command.type }]) {
      if (!cmd || !cmd.type) {
        this.recordInvalid(cmd, 'unknown_command');
        continue;
      }

      if (cmd.type === 'accept') {
        if (!this.currentSupply || this.currentSupply.accepted || this.currentSupply.item.id !== cmd.itemId) {
          this.recordInvalid(cmd, 'not_offered');
          continue;
        }
        const busyCount = Object.values(this.machines).filter(m => m.busy).length;
        if (this.items.length + busyCount >= this.capacity) {
          this.recordInvalid(cmd, 'storage_full');
          continue;
        }
        this.currentSupply.accepted = true;
        this.items.push(this.currentSupply.item);
        this.money -= this.currentSupply.price;
        this.stats.purchases += this.currentSupply.price;
      } else if (cmd.type === 'discard') {
        const idx = this.items.findIndex(i => i.id === cmd.itemId);
        if (idx === -1) {
          this.recordInvalid(cmd, 'no_such_item');
          continue;
        }
        const [removed] = this.items.splice(idx, 1);
        if (removed.kind === 'robot') this.stats.robotsDiscarded++;
      } else if (cmd.type === 'start') {
        const m = this.machines[cmd.machineId];
        const mDef = this.machinesDef[cmd.machineId];
        if (!m || !mDef) {
          this.recordInvalid(cmd, 'unknown_machine');
          continue;
        }
        const opDef = mDef.ops[cmd.opId];
        if (!opDef) {
          this.recordInvalid(cmd, 'unknown_op');
          continue;
        }
        if (m.busy) {
          this.recordInvalid(cmd, 'machine_busy');
          continue;
        }
        const itemIds = cmd.itemIds || [];
        if (itemIds.length !== opDef.inputs.length || new Set(itemIds).size !== itemIds.length) {
          this.recordInvalid(cmd, 'bad_inputs');
          continue;
        }

        const picked = itemIds.map(id => this.items.find(i => i.id === id));
        if (picked.some(p => !p)) {
          this.recordInvalid(cmd, 'bad_inputs');
          continue;
        }

        // Проверка шаблонов входов
        let validInputs = true;
        for (let i = 0; i < opDef.inputs.length; i++) {
          const req = opDef.inputs[i];
          const act = picked[i];
          if (req.kind && act.kind !== req.kind) validInputs = false;
          for (const [key, expected] of Object.entries(req.props || {})) {
            const actual = act.props?.[key];
            // В ТЗ null — «не задано»; отсутствие свойства трактуем так же.
            if (expected === null ? actual != null : expected === '*' ? actual == null : actual !== expected) validInputs = false;
          }
        }
        if (!validInputs) {
          this.recordInvalid(cmd, 'bad_inputs');
          continue;
        }

        // Проверяем место (потребляется N предметов, резервируется 1 под выход)
        const busyCount = Object.values(this.machines).filter(x => x.busy).length;
        const futureOccupied = this.items.length - picked.length + busyCount + 1;
        if (futureOccupied > this.capacity) {
          this.recordInvalid(cmd, 'storage_full');
          continue;
        }

        // Извлекаем входы со склада
        for (const id of itemIds) {
          const idx = this.items.findIndex(x => x.id === id);
          if (idx !== -1) this.items.splice(idx, 1);
        }

        // Формируем выходной предмет с наследованием свойств
        const baseProps = Number.isInteger(opDef.inherit) && picked[opDef.inherit] ? { ...picked[opDef.inherit].props } : {};
        const outProps = { ...baseProps, ...(opDef.output.props || {}) };
        const outputItem = {
          id: `o-${this.idSeq++}`,
          kind: opDef.output.kind,
          props: outProps
        };

        m.busy = true;
        m.busyUntil = this.t + opDef.duration;
        m.currentOp = { opId: cmd.opId, outputItem };
        this.money -= opDef.cost;
        this.stats.opCosts += opDef.cost;
      } else if (cmd.type === 'offer') {
        const buyer = this.buyers.find(b => b.id === cmd.buyerId);
        if (!buyer) {
          this.recordInvalid(cmd, 'unknown_buyer');
          continue;
        }
        const itemIdx = this.items.findIndex(i => i.id === cmd.itemId);
        if (itemIdx === -1) {
          this.recordInvalid(cmd, 'no_such_robot');
          continue;
        }
        const item = this.items[itemIdx];
        if (item.kind !== 'robot') {
          this.recordInvalid(cmd, 'no_such_robot');
          continue;
        }
        if (buyer.cooldown > 0) {
          // Комиссия списывается даже при попытке на кулдауне
          this.money -= this.offerFee;
          this.stats.offerFees += this.offerFee;
          this.pendingSales.push({
            deliverTick: this.t,
            event: {
              type: 'sale_result', buyerId: buyer.id, itemId: item.id,
              item: structuredClone(item), outcome: 'refused', reason: 'cooldown'
            }
          });
          continue;
        }

        this.money -= this.offerFee;
        this.stats.offerFees += this.offerFee;
        buyer.cooldown = this.buyerCooldown;

        const val = this.computeBuyerPrice(buyer, item);
        const minPrice = typeof cmd.minPrice === 'number' ? cmd.minPrice : 0;

        if (val >= minPrice) {
          this.items.splice(itemIdx, 1);
          this.money += val;
          this.stats.revenue += val;
          this.stats.robotsSold++;
          this.pendingSales.push({
            deliverTick: this.t, // ответ в фазе sale_result этого же такта
            event: {
              type: 'sale_result',
              buyerId: buyer.id,
              itemId: item.id,
              item: structuredClone(item),
              outcome: 'sold',
              price: val
            }
          });
        } else {
          this.pendingSales.push({
            deliverTick: this.t,
            event: {
              type: 'sale_result',
              buyerId: buyer.id,
              itemId: item.id,
              item: structuredClone(item),
              outcome: 'refused',
              reason: 'below_min_price'
            }
          });
        }
      } else {
        this.recordInvalid(cmd, 'unknown_command');
      }
    }
  }

  computeBuyerPrice(buyer, item) {
    let matches = 0;
    if (item.props.color === buyer.sample.color) matches++;
    if (Boolean(item.props.handles) === Boolean(buyer.sample.handles)) matches++;

    let base = 0;
    if (matches === 2) base = buyer.pMax;
    else if (matches === 1) base = buyer.pMax * buyer.f;
    else return 0;

    const jitter = 1 + (this.rng() * 0.04 - 0.02); // ±2%
    return Math.round(base * jitter * 100) / 100;
  }

  recordInvalid(cmd, reason) {
    this.stats.invalidCommands.push({ t: this.t, cmd, reason });
  }

  getReportSummary() {
    return {
      profit: Math.round(this.money * 100) / 100,
      robotsSold: this.stats.robotsSold,
      robotsProduced: this.stats.robotsProduced,
      invalidCount: this.stats.invalidCommands.length
    };
  }

  getReport() {
    const totalTicks = this.horizon + 1;
    const utilization = {};
    for (const [mId, m] of Object.entries(this.machines)) {
      utilization[mId] = Math.round((m.busyTicks / totalTicks) * 1000) / 10;
    }
    return {
      seed: this.seed,
      profit: Math.round(this.money * 100) / 100,
      revenue: Math.round(this.stats.revenue * 100) / 100,
      purchases: Math.round(this.stats.purchases * 100) / 100,
      opCosts: Math.round(this.stats.opCosts * 100) / 100,
      offerFees: Math.round(this.stats.offerFees * 100) / 100,
      storageCosts: Math.round(this.stats.storageCosts * 100) / 100,
      robotsSold: this.stats.robotsSold,
      robotsProduced: this.stats.robotsProduced,
      robotsDiscarded: this.stats.robotsDiscarded,
      timeouts: this.stats.timeouts,
      errors: this.stats.errors,
      failedEvents: this.stats.failedEvents,
      stopReason: this.stopReason,
      invalidCommands: this.stats.invalidCommands,
      utilization,
      buyersSecret: this.buyers,
      history: this.stats.history
    };
  }
}
