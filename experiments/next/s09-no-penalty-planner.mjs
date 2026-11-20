// Короткий прогноз одного производственного маршрута; не использует будущие поставки.
const accepts = (template, item) => item && (!template.kind || template.kind === item.kind) &&
  Object.entries(template.props || {}).every(([key, value]) => value === null ? item.props?.[key] == null : value === '*' ? item.props?.[key] != null : item.props?.[key] === value);

function outputOf(op, inputs) {
  const inherited = Number.isInteger(op.inherit) ? inputs[op.inherit]?.props : null;
  return { kind: op.output?.kind, props: { ...(inherited || {}), ...(op.output?.props || {}) } };
}

export function planProduction({ start, items, machines, freeSlots, t, horizon, buyers, inFlight = [], maxCandidates = 1024, timeBudgetMs = 5, now = () => performance.now() }) {
  const fallback = { commands: [], exhausted: true };
  if (maxCandidates <= 0 || timeBudgetMs <= 0) return fallback;
  const deadline = now() + timeBudgetMs;
  let count = 0, exhausted = false;
  const budget = () => {
    if (++count > maxCandidates || now() >= deadline) exhausted = true;
    return !exhausted;
  };
  const ops = [];
  for (const machine of (Array.isArray(start?.machines) ? start.machines : []).slice(0, 32)) {
    for (const op of (Array.isArray(machine?.ops) ? machine.ops : []).slice(0, 64)) {
      if (ops.length >= 64) break;
      if (!op?.id || !Array.isArray(op.inputs) || !Number.isFinite(op.duration) || op.duration <= 0 || !op.output?.kind) continue;
      let type;
      if (op.output.kind === 'robot' && op.inputs.length === 2) type = 'assemble';
      else if (op.output.kind === 'body' && op.inputs.length === 1 && op.inputs[0].kind === 'sheet') type = 'cut';
      else if (op.output.kind === 'body' && op.inputs.length === 1 && op.output.props?.handles === true) type = 'handles';
      else if (op.output.kind === 'body' && op.inputs.length === 1 && typeof op.output.props?.color === 'string') type = 'paint';
      if (type) ops.push({ machineId: machine.id, op, type });
    }
  }
  const availableAt = new Map((Array.isArray(machines) ? machines : []).map(m => [m.id, m.busyUntil == null ? t : Math.max(t, m.busyUntil)]));
  const busyNow = new Set((Array.isArray(machines) ? machines : []).filter(m => m.busy || (typeof m.busyUntil === 'number' && m.busyUntil >= t)).map(m=>m.id));
  const remaining = items.slice(0, 64).map(item => ({ ...item, props: { ...item.props } }));
  const commands = [];
  const pipeline = inFlight.slice(0, 64);
  let slots = freeSlots;
  let excludedIds = new Set();
  const storageFee = start?.storageFee?.robot ?? 0.5;
  const offerFee = start?.offerFee ?? 1;

  function forecast(item, readyAt, controls, machineTimes, depth, cost, skipHandles = false) {
    if (!budget()) return -Infinity;
    if (readyAt > horizon || depth > 4) return -Infinity;
    if (item.kind === 'robot') {
      let best = -Infinity;
      const duplicateCount = [...remaining, ...pipeline].filter(other =>
        !excludedIds.has(other.id) && (other.kind === 'robot' || other.kind === 'body') && other.props?.color === item.props.color &&
        Boolean(other.props?.handles) === Boolean(item.props.handles)).length;
      for (const buyer of buyers.slice(0, 32)) {
        const saleAt = Math.max(readyAt, buyer.cooldownUntil ?? 0);
        if (saleAt > horizon) continue;
        const estimate = buyer.evaluateRobot(item.props);
        let value = estimate?.expectedPrice;
        if (Number.isFinite(estimate?.prob2Match) && Number.isFinite(estimate?.expected2MatchPrice)) {
          value = estimate.prob2Match * estimate.expected2MatchPrice;
          if (estimate.prob2Match === 0 && horizon - saleAt <= 18 && estimate.prob1Match > 0.3 && estimate.expected1MatchPrice >= 15) {
            value = estimate.prob1Match * estimate.expected1MatchPrice;
          }
        }
        if (Number.isFinite(value)) best = Math.max(best, value - cost - offerFee - storageFee * (saleAt - readyAt));
      }
      return best;
    }
    let best = -Infinity;
    for (const { machineId, op, type } of ops) {
      if (type === 'cut' || (skipHandles && type === 'handles')) continue;
      const itemIndex = op.inputs.findIndex(input => accepts(input, item));
      if (itemIndex < 0) continue;
      const otherIndex = itemIndex === 0 ? 1 : 0;
      const matches = op.inputs.length === 1 ? [null] : controls.filter(c => accepts(op.inputs[otherIndex], c));
      for (const control of matches.slice(0, 4)) {
        const nextInputs = control ? (itemIndex === 0 ? [item, control] : [control, item]) : [item];
        const begin = Math.max(readyAt, machineTimes.get(machineId) ?? t);
        const done = begin + op.duration;
        if (done > horizon) continue;
        const nextTimes = new Map(machineTimes); nextTimes.set(machineId, done);
        const nextControls = control ? controls.filter(c => c.id !== control.id) : controls;
        best = Math.max(best, forecast(outputOf(op, nextInputs), done, nextControls, nextTimes, depth + 1, cost + (op.cost ?? 0)));
        if (exhausted) return -Infinity;
      }
    }
    return best;
  }

  for (const type of ['assemble', 'handles', 'paint', 'cut']) {
    let best = null;
    for (const entry of ops.filter(e => e.type === type && !busyNow.has(e.machineId))) {
      const { op, machineId } = entry;
      const firstItems = remaining.filter(item => accepts(op.inputs[0], item)).slice(0, 8);
      for (const first of firstItems) {
        const secondItems = op.inputs.length === 1 ? [null] : remaining.filter(item => item.id !== first.id && accepts(op.inputs[1], item)).slice(0, 4);
        for (const second of secondItems) {
          if (!budget()) return fallback;
          const inputs = second ? [first, second] : [first];
          if (slots + inputs.length - 1 < 0) continue;
          const done = t + op.duration;
          if (done > horizon) continue;
          excludedIds = new Set(inputs.map(item => item.id));
          const times = new Map(availableAt); times.set(machineId, done);
          const controls = remaining.filter(item => item.kind === 'control' && !inputs.some(x=>x.id === item.id));
          let score = forecast(outputOf(op, inputs), done, controls, times, 0, op.cost ?? 0);
          if (exhausted) return fallback;
          // Частичная резка разгружает лист; это не прогноз неизвестной поставки.
          if (type === 'cut' && !Number.isFinite(score) && controls.length === 0 &&
              remaining.filter(item => item.kind === 'body').length < 2 && buyers.slice(0, 32).some(b => (b.cooldownUntil ?? 0) <= horizon)) {
            const paints = ops.filter(x => x.type === 'paint').map(x => x.op.duration);
            const assemblies = ops.filter(x => x.type === 'assemble').map(x => x.op.duration);
            if (paints.length && assemblies.length && done + Math.min(...paints) + Math.min(...assemblies) <= horizon) score = 0.01;
          }
          // Можно окрасить ограниченный буфер корпуса; будущий control не прогнозируется.
          if (type === 'paint' && !Number.isFinite(score) && controls.length === 0 &&
              !remaining.some(item => item.kind === 'body' && item.props?.color) && buyers.length > 0) {
            const assemblies = ops.filter(x => x.type === 'assemble').map(x => x.op.duration);
            if (assemblies.length && done + Math.min(...assemblies) <= horizon) {
              const props = outputOf(op, inputs).props;
              const values = buyers.slice(0, 32).filter(b => (b.cooldownUntil ?? 0) <= horizon)
                .map(b => b.evaluateRobot(props)?.expectedPrice ?? 0);
              if (values.length && Math.max(...values) > 0) score = 0.01 + Math.max(...values) * 0.0001;
            }
          }
          if (type === 'handles') {
            const direct = forecast(first, t, controls, availableAt, 0, 0, true);
            if (exhausted) return fallback;
            if (score <= direct) continue;
          }
          if (score > 0 && (!best || score > best.score)) best = { entry, inputs, score, done };
        }
      }
    }
    if (best) {
      const { entry, inputs, done } = best;
      commands.push({ type:'start', machineId:entry.machineId, opId:entry.op.id, itemIds:inputs.map(x=>x.id) });
      for (const item of inputs) remaining.splice(remaining.findIndex(x=>x.id===item.id),1);
      slots += inputs.length - 1;
      pipeline.push(outputOf(entry.op, inputs));
      busyNow.add(entry.machineId); availableAt.set(entry.machineId,done);
    }
  }
  return { commands, exhausted:false };
}
