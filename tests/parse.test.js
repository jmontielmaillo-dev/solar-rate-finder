const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseHTML } = require('linkedom');
const { parseRates } = require('../scripts/parse.js');

test('parses household FV rates only', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.html'), 'utf8');
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const rates = parseRates(document);
  assert.strictEqual(rates.length, 1);
  const r = rates[0];
  assert.strictEqual(r.provider, 'Niba');
  assert.strictEqual(r.comparable, true);
  assert.deepStrictEqual(r.power, { p1: 0.077, p2: 0.077 });
  assert.deepStrictEqual(r.energy, { e1: 0.197, e2: 0.147, e3: 0.087 });
  assert.strictEqual(r.surplus.price, 0.06);
  assert.strictEqual(r.virtualBattery.beforeTax, true);
  assert.strictEqual(r.maxKw, 10);
  assert.strictEqual(r.updated, '5 Oct 2026');
});

test('plans with a minimum annual consumption are treated as large-consumer plans', () => {
  const { isLargeConsumerRate } = require('../scripts/parse.js');
  assert.strictEqual(isLargeConsumerRate({ cae: 'CAE ≥ 4 MWh' }), true);
  assert.strictEqual(isLargeConsumerRate({ cae: 'CAE < 10 MWh' }), false);
  assert.strictEqual(isLargeConsumerRate({ cae: null }), false);
});
