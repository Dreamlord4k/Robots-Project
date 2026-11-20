import { FactoryBot as S03Bot } from './s03-bot.mjs';
export class FactoryBot extends S03Bot {
  constructor(startParams = {}) { super(startParams, { informationWeight: 0 }); }
}
export { NaiveBot } from './s02-bot.mjs';
