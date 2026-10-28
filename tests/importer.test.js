const test = require('node:test');
const assert = require('node:assert');
const I = require('../importer.js');

const csv = `Date/Time,Energy Produced (Wh),Energy Consumed (Wh),Exported to Grid (Wh),Imported from Grid (Wh)
10/09/2026,20000,15000,10000,5000
10/10/2026,18000,30000,4000,16000
10/12/2026,15000,20000,5000,10000
11/02/2026,10000,12000,3000,5000
`;

test('parses Enphase daily CSV in Wh, MM/DD/YYYY', () => {
  const p = I.parseEnphaseCsv(csv);
  assert.strictEqual(p.rows.length, 4);
  assert.strictEqual(p.interval, false);
  assert.deepStrictEqual([p.rows[0].y, p.rows[0].m, p.rows[0].d], [2026, 10, 9]);
  assert.strictEqual(p.rows[0].imp, 5);
});

test('weekends and national holidays go to P3; weekdays use the split', () => {
  const p = I.parseEnphaseCsv(csv);
  const [oct, nov] = I.monthlyTotals(p.rows, [20, 20, 60]);
  // Oct 9 = Friday (weekday, 5 kWh), Oct 10 = Saturday (16), Oct 12 = national holiday (10)
  assert.deepStrictEqual(oct.kwh.map((x) => +x.toFixed(3)), [1, 1, 29]);
  assert.strictEqual(oct.self, 53 - 19);
  assert.strictEqual(nov.days, 1);
});

test('interval rows are classified by hour', () => {
  const p = I.parseEnphaseCsv(`Date/Time,Energy Produced (kWh),Energy Consumed (kWh),Exported to Grid (kWh),Imported from Grid (kWh)
2026-10-09 11:00,0,1,0,1
2026-10-09 09:00,0,1,0,2
2026-10-09 03:00,0,1,0,4`);
  assert.strictEqual(p.interval, true);
  const [m] = I.monthlyTotals(p.rows, [0, 0, 0]);
  assert.deepStrictEqual(m.kwh, [1, 2, 4]);
});

test('projection scales production and keeps self-consumption bounded', () => {
  const p = I.parseEnphaseCsv(csv);
  const j = I.projectMonth(p.rows, '2026-10', 1, { prodFactor: 0.5 }, [20, 20, 60]);
  assert.ok(Math.abs(j.prod - 26.5) < 1e-9);
  assert.ok(j.self <= j.prod + 1e-9);
  assert.ok(Math.abs(j.imp - (65 - j.self)) < 1e-9);
});

test('rejects a file without grid columns', () => {
  assert.throws(() => I.parseEnphaseCsv('Date/Time,Energy Produced (Wh)\n10/09/2026,100'), /grid/);
});

test('reads the hourly distributor CSV (i-DE format)', () => {
  const lines = ['CUPS;Fecha;Hora;Consumo_kWh;Metodo_obtencion'];
  // Friday 10/10/2025 (weekday) and Saturday 11/10/2025 (valle all day): 1 kWh every hour
  for (const d of ['10/10/2025', '11/10/2025']) for (let h = 1; h <= 24; h++) lines.push(`ES00XX;${d};${h};1,000;R`);
  const r = I.parseHourlyConsumptionCsv(lines.join('\n'));
  const m = r.months['2025-10'];
  assert.strictEqual(r.hours, 48);
  assert.strictEqual(m.days, 2);
  assert.strictEqual(m.kwh, 48);
  // weekday: P1 8 h (10-14, 18-22), P2 8 h, P3 8 h; Saturday: 24 h P3
  assert.deepStrictEqual(m.p, [8, 8, 32]);
  // October daylight 9-19h: weekday P1 10-14h + 18h (5), P2 9h + 14-18h (5); Saturday 10 h P3
  assert.deepStrictEqual(m.pd, [5, 5, 10]);
});
