import { FactoryBot as S02Bot } from './s02-bot.mjs';

// Эксперимент: эвристическая стоимость наблюдения и одномоментная выгода.
export class FactoryBot extends S02Bot {
  constructor(startParams = {}, options = {}) {
    super(startParams);
    this.informationWeight = Number.isFinite(options.informationWeight) ? Math.max(0, options.informationWeight) : 6;
  }

  scoreOffer(robot, buyer, minPrice, ticksLeft) {
    const ev = buyer.evaluateRobot(robot.props);
    // Равномерный шум вокруг средних уровней — приближение, не точный posterior.
    const levels = [
      [ev.prob2Match, ev.expected2MatchPrice],
      [ev.prob1Match, ev.expected1MatchPrice],
      [Math.max(0, 1 - ev.prob2Match - ev.prob1Match), 0]
    ];
    let saleProbability = 0, revenue = 0;
    for (const [weight, price] of levels) {
      if (!weight) continue;
      if (price <= 0) {
        if (minPrice <= 0) saleProbability += weight;
        continue;
      }
      const lo = price * 0.98, hi = price * 1.02;
      const cutoff = Math.max(lo, minPrice);
      const fraction = Math.max(0, Math.min(1, (hi - cutoff) / (hi - lo)));
      saleProbability += weight * fraction;
      revenue += weight * fraction * Math.min(this.priceCeiling, (Math.max(lo, Math.min(hi, cutoff)) + hi) / 2);
    }
    const remaining = Math.max(0, ticksLeft);
    const waitingCost = (1 - saleProbability) * (this.storageFee.robot ?? 0.5) * Math.min(this.buyerCooldown, remaining);
    // Упущенная возможность покупателя в паузе: слабый ограниченный штраф.
    const cooldownCost = ev.expectedPrice * Math.min(this.buyerCooldown, remaining) / Math.max(1, remaining) * 0.1;
    const information = this.informationWeight * 4 * saleProbability * (1 - saleProbability)
      * Math.min(1, remaining / 40) * Math.max(0, ev.uncertainty - 1) / 5;
    return { minPrice, saleProbability, revenue, waitingCost, cooldownCost, information,
      utility: revenue - this.offerFee - waitingCost - cooldownCost + information };
  }

  planBestOffers(t, ticksLeft, freeSlots, robots, readyBuyers) {
    const selectedRobots = robots.slice(0, 6);
    const distinct = [...new Map(readyBuyers.filter(b => b.cooldownUntil <= t).map(b => [b.buyerId, b])).values()];
    const options = distinct.map(buyer => {
      const edges = selectedRobots.map(robot => {
        const ev = buyer.evaluateRobot(robot.props);
        const high = Math.min(this.priceCeiling, Math.max(43.5, Math.min(73, Math.floor(ev.min2MatchPrice * 10) / 10)));
        const low = Math.min(this.priceCeiling, 13);
        return [high, low].map(price => this.scoreOffer(robot, buyer, price, ticksLeft))
          .sort((a, b) => b.utility - a.utility)[0];
      });
      return { buyer, edges, best: Math.max(0, ...edges.map(edge => edge.utility)) };
    }).sort((a, b) => b.best - a.best).slice(0, 4);
    let best = 0, bestPairs = [];
    const used = new Set(), current = [];
    const search = (index, total) => {
      if (total > best) { best = total; bestPairs = [...current]; }
      if (index === selectedRobots.length) return;
      search(index + 1, total);
      options.forEach(({ buyer, edges }, i) => {
        const edge = edges[index];
        if (used.has(i) || edge.utility <= 0) return;
        used.add(i);
        current.push({ buyerId: buyer.buyerId, itemId: selectedRobots[index].id, minPrice: edge.minPrice });
        search(index + 1, total + edge.utility);
        current.pop();
        used.delete(i);
      });
    };
    search(0, 0);
    return bestPairs;
  }
}

// HTTP-оболочка импортирует обе стратегии из одного модуля.
export { NaiveBot } from './s02-bot.mjs';
