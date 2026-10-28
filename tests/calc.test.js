const test = require('node:test');
const assert = require('node:assert');
const { monthBill, rankRates, caeAllows } = require('../calc.js');
const { normalize } = require('../scripts/parse.js');

// Sample Octopus 3 bill, 14-09-2026 to 15-10-2026: total 98,01 €
const billRate = {
  comparable: true,
  power: { p1: 0.097, p2: 0.027 },
  energy: { e1: 0.195, e2: 0.116, e3: 0.085 },
  socialBond: 0.77 / 31,
  monthlyFee: null,
  surplus: { price: 0, compensates: 'Consumo' },
  virtualBattery: null,
};
const billMonth = { days: 31, kwP1: 7.7, kwP2: 7.7, kwh: [54, 41, 362], surplusKWh: 0, weight: 12 };

test('reproduces the sample bill within rounding of the printed unit prices', () => {
  const b = monthBill(billRate, billMonth, { meterRentPerDay: 0.83 / 31 });
  assert.ok(Math.abs(b.power - 29.59) < 0.05, `power ${b.power}`);
  assert.ok(Math.abs(b.energy - 45.95) < 0.2, `energy ${b.energy}`);
  assert.ok(Math.abs(b.total - 98.01) < 0.4, `total ${b.total}`);
});

test('surplus compensation is capped at energy cost when no virtual battery', () => {
  const r = { ...billRate, surplus: { price: 0.5, compensates: 'Consumo' } };
  const b = monthBill(r, { ...billMonth, surplusKWh: 1000 });
  assert.ok(Math.abs(b.compensation - b.energy) < 1e-9);
  assert.ok(b.lostSurplus > 0);
  assert.strictEqual(b.bvCredit, 0);
});

test('virtual battery keeps the excess and offsets other months', () => {
  const r = { ...billRate, surplus: { price: 0.5, compensates: 'Consumo' }, virtualBattery: { beforeTax: false } };
  const summer = { ...billMonth, surplusKWh: 1000, weight: 6 };
  const winter = { ...billMonth, surplusKWh: 0, weight: 6 };
  const { ranked } = rankRates([r], [summer, winter]);
  assert.ok(ranked[0].bvCreditGenerated > 0);
  assert.ok(ranked[0].annual < ranked[0].gross);
  assert.ok(ranked[0].annual >= 0);
});

test('CAE limits', () => {
  assert.ok(caeAllows('CAE < 4 MWh', 3000));
  assert.ok(!caeAllows('CAE < 4 MWh', 4500));
  assert.ok(caeAllows('CAE ≥ 4 MWh', 4500));
});

test('2.0A rates use the single price for all periods', () => {
  const r = normalize({ provider: 'X', plan: 'Y', accessTariff: '2.0A', schedule: 'Horario estándar 2.0A', tags: ['FV'], p1: '0,1', p2: '0,05', e1: '0,123000', surplus: '0,06', compensates: 'Consumo' });
  assert.deepStrictEqual(r.energy, { e1: 0.123, e2: 0.123, e3: 0.123 });
  assert.strictEqual(r.comparable, true);
});

test('initial rates.json is well formed', () => {
  const data = require('../data/rates.json');
  assert.ok(data.rates.length >= 10);
  for (const r of data.rates.filter((x) => x.comparable)) {
    assert.ok(r.power.p1 > 0 && r.power.p2 > 0, r.id);
    assert.ok(r.energy.e1 > 0 && r.energy.e2 > 0 && r.energy.e3 > 0, r.id);
    assert.ok(r.surplus.price >= 0, r.id);
  }
});
