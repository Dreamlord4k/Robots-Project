import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'experiments/next/manifest.json'), 'utf8'));
const sha256 = (rel) => createHash('sha256').update(readFileSync(path.join(root, rel))).digest('hex');

test('замороженная база S06 совпадает с manifest.json', () => {
  for (const rel of ['experiments/next/baseline/bot.mjs', 'experiments/next/baseline/s04-planner.mjs']) {
    assert.equal(sha256(rel), manifest.hashes[rel], `${rel} разошёлся с манифестом S06`);
  }
});

test('манифест S06 описывает движок и наборы', () => {
  assert.equal(manifest.horizon, 600);
  assert.equal(manifest.sets.tune.length, 300);
  assert.equal(manifest.sets.check.length, 200);
  assert.equal(manifest.sets.final.length, 500);
  assert.equal(typeof manifest.hashes['src/engine.mjs'], 'string');
});
