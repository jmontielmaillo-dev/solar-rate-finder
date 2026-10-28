// Reads an Enphase (Enlighten) report CSV and turns it into monthly inputs
// for the calculator. Works with daily rows ("08/10/2026") and with interval
// rows that carry a time ("08/10/2026 13:15"). Everything runs in the browser;
// the file is never uploaded.
(function (root) {
  // National fixed-date holidays: P3 (valle) all day under the 2.0TD tariff
  const FIXED_HOLIDAYS = ['01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'];

  // Approximate daily PV yield by month for central Spain, kWh per kWp per day
  // (tilted panels). Used only to project months with no data yet.
  const PV_YIELD = [3.6, 4.4, 5.3, 5.6, 6.1, 6.6, 7.0, 6.6, 5.8, 4.7, 3.8, 3.3];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const pad = (n) => String(n).padStart(2, '0');

  function isValleDay(y, m, d) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return wd === 0 || wd === 6 || FIXED_HOLIDAYS.includes(`${pad(m)}-${pad(d)}`);
  }

  // 2.0TD period for a weekday hour (0-23)
  function periodOfHour(hour) {
    if ((hour >= 10 && hour < 14) || (hour >= 18 && hour < 22)) return 0; // P1 punta
    if (hour < 8) return 2; // P3 valle
    return 1; // P2 llano
  }

  function splitCsvLine(line, sep) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === sep && !q) {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  function findCol(headers, re) {
    return headers.findIndex((h) => re.test(h));
  }

  // -> { rows: [{y,m,d,hour|null, prod, cons, exp, imp}], interval: bool, warnings: [] }
  function parseEnphaseCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('The file has no data rows.');
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const headers = splitCsvLine(lines[0], sep);
    const cDate = findCol(headers, /date|time|fecha/i);
    const cols = {
      prod: findCol(headers, /produc|generat/i),
      cons: findCol(headers, /consum/i),
      exp: findCol(headers, /export|vertid|to grid/i),
      imp: findCol(headers, /import|from grid/i),
    };
    if (cDate < 0) throw new Error('No date column found (expected a header like "Date/Time").');
    if (cols.imp < 0 || cols.exp < 0) {
      throw new Error('This file has no grid import/export columns. In Enlighten, include "Imported from Grid" and "Exported to Grid" in the report (needs consumption meters).');
    }
    const unitFactor = (h) => (/\(kwh\)/i.test(h) ? 1 : /\(wh\)/i.test(h) ? 0.001 : null);
    const factors = {};
    const warnings = [];
    for (const [k, i] of Object.entries(cols)) {
      if (i < 0) continue;
      let f = unitFactor(headers[i]);
      if (f == null) {
        f = 0.001;
        warnings.push(`Unit of "${headers[i]}" not stated; assuming Wh.`);
      }
      factors[k] = f;
    }

    // Date format: Enphase exports MM/DD/YYYY; switch to DD/MM if a first field > 12 appears
    const raw = lines.slice(1).map((l) => splitCsvLine(l, sep));
    let dayFirst = false;
    for (const r of raw) {
      const m = (r[cDate] || '').match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
      if (m && +m[1] > 12) dayFirst = true;
    }
    const num = (s) => {
      if (s == null || s === '') return 0;
      const t = String(s).replace(/\s/g, '');
      const n = parseFloat(/,\d{1,3}$/.test(t) && !/\.\d/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const rows = [];
    let interval = false;
    for (const r of raw) {
      const s = r[cDate] || '';
      let y, m, d, hour = null;
      let mm = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
      if (mm) {
        [y, m, d] = [+mm[1], +mm[2], +mm[3]];
        if (mm[4] != null) hour = +mm[4];
      } else if ((mm = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i))) {
        y = +mm[3];
        m = dayFirst ? +mm[2] : +mm[1];
        d = dayFirst ? +mm[1] : +mm[2];
        if (mm[4] != null) {
          const ap = mm[6] ? mm[6].toUpperCase() : null;
          hour = ap ? (+mm[4] % 12) + (ap === 'PM' ? 12 : 0) : +mm[4];
        }
      } else continue;
      if (hour != null) interval = true;
      const v = (k) => (cols[k] >= 0 ? num(r[cols[k]]) * factors[k] : null);
      rows.push({ y, m, d, hour, prod: v('prod'), cons: v('cons'), exp: v('exp'), imp: v('imp') });
    }
    if (!rows.length) throw new Error('No rows with a readable date.');
    return { rows, interval, warnings, dayFirst };
  }

  // weekdaySplit: % of weekday grid import in P1/P2/P3 (only used for daily rows)
  function addToPeriods(acc, row, weekdaySplit) {
    const imp = row.imp || 0;
    if (isValleDay(row.y, row.m, row.d)) acc[2] += imp;
    else if (row.hour != null) acc[periodOfHour(row.hour)] += imp;
    else {
      const s = weekdaySplit[0] + weekdaySplit[1] + weekdaySplit[2] || 1;
      for (let i = 0; i < 3; i++) acc[i] += (imp * weekdaySplit[i]) / s;
    }
  }

  function summarize(key, list, weekdaySplit, extra) {
    const days = new Set(list.map((r) => `${r.y}-${r.m}-${r.d}`)).size;
    const kwh = [0, 0, 0];
    const t = { prod: 0, cons: 0, exp: 0, imp: 0 };
    let valleDayImp = 0;
    for (const r of list) {
      addToPeriods(kwh, r, weekdaySplit);
      for (const k of Object.keys(t)) t[k] += r[k] || 0;
      if (isValleDay(r.y, r.m, r.d)) valleDayImp += r.imp || 0;
    }
    const [y, m] = key.split('-').map(Number);
    const first = list[0];
    const last = list[list.length - 1];
    return {
      key,
      year: y,
      month: m,
      label: `${MON[m - 1]} ${y}`,
      range: `${first.d} ${MON[first.m - 1]}–${last.d} ${MON[last.m - 1]}`,
      days,
      full: days >= new Date(Date.UTC(y, m, 0)).getUTCDate(),
      ...t,
      self: Math.max(0, t.prod - t.exp),
      kwh,
      valleDayImp,
      ...(extra || {}),
    };
  }

  function monthlyTotals(rows, weekdaySplit) {
    const by = new Map();
    for (const r of rows) {
      const k = `${r.y}-${pad(r.m)}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    return [...by.keys()].sort().map((k) => summarize(k, by.get(k), weekdaySplit));
  }

  // Project a month with no data from a measured one, day by day:
  // production scales by the PV-yield ratio (or prodFactor), home use by consFactor.
  // Daytime load stays as measured, so self-consumption can't exceed what it was.
  function projectMonth(rows, sourceKey, targetMonth, opts, weekdaySplit) {
    const [sy, sm] = sourceKey.split('-').map(Number);
    const src = rows.filter((r) => r.y === sy && r.m === sm);
    if (!src.length) return null;
    const prodFactor = opts.prodFactor ?? PV_YIELD[targetMonth - 1] / PV_YIELD[sm - 1];
    const consFactor = opts.consFactor ?? 1;
    const ty = targetMonth < sm ? sy + 1 : sy;
    const projected = src.map((r) => {
      const prod = (r.prod || 0) * prodFactor;
      const selfOrig = Math.max(0, (r.prod || 0) - (r.exp || 0));
      const cons = (r.cons || 0) * consFactor;
      // daytime load scales with home use, but can't use more solar than is produced
      const self = Math.min(prod, selfOrig * consFactor, cons);
      // keep the weekday/weekend pattern of the source day by mapping onto the same day number
      const dim = new Date(Date.UTC(ty, targetMonth, 0)).getUTCDate();
      return { y: ty, m: targetMonth, d: Math.min(r.d, dim), hour: r.hour, prod, cons, exp: prod - self, imp: Math.max(0, cons - self) };
    });
    // Weekday/weekend status of the projected days follows the target calendar;
    // to keep the source's weekend load pattern instead, use the source dates for the split.
    const kwh = [0, 0, 0];
    src.forEach((r, i) => addToPeriods(kwh, { ...r, imp: projected[i].imp }, weekdaySplit));
    const s = summarize(`${ty}-${pad(targetMonth)}`, projected, weekdaySplit, { projected: true, source: sourceKey, prodFactor, consFactor });
    s.kwh = kwh;
    s.days = src.length;
    s.label = `${MON[targetMonth - 1]} ${ty} (estimate)`;
    s.range = `from ${MON[sm - 1]} ${sy} data`;
    return s;
  }

  // Approximate daylight hours (local time) by month in central Spain, [first hour, end hour)
  const SUN_HOURS = [[9, 18], [8, 18], [8, 19], [8, 20], [7, 21], [7, 21], [7, 21], [8, 21], [8, 20], [9, 19], [8, 18], [9, 18]];

  // Hourly consumption CSV from the distributor (i-DE "consumo_periodo_...csv", also Datadis):
  // CUPS;Fecha;Hora;Consumo_kWh;Metodo_obtencion  with Fecha = DD/MM/YYYY and Hora = 1..24 (hour ending).
  // -> { months: { "2025-01": { kwh, p: [p1, p2, p3], days, hours } }, first, last, hours, exportKwh }
  function parseHourlyConsumptionCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 25) throw new Error('The file has fewer than 24 hourly rows.');
    const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
    const headers = splitCsvLine(lines[0], sep);
    const cDate = findCol(headers, /fecha|date/i);
    const cHour = findCol(headers, /^hora$|hour|periodo/i);
    const cKwh = findCol(headers, /consumo|ae_kwh|^ae$|energ.a.*(activa|consum)|import/i);
    const cExp = findCol(headers, /vertid|as_kwh|^as$|export|excedent/i);
    if (cDate < 0 || cHour < 0 || cKwh < 0) throw new Error('Expected columns Fecha, Hora and Consumo_kWh (hourly file from your distributor).');
    const num = (t) => {
      t = String(t || '').trim();
      if (!t) return 0;
      const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
      return Number.isFinite(n) ? n : 0;
    };
    const months = {};
    const daySet = new Set();
    let first = null;
    let last = null;
    let hours = 0;
    let exportKwh = 0;
    for (const line of lines.slice(1)) {
      const r = splitCsvLine(line, sep);
      const m = (r[cDate] || '').match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/) || (r[cDate] || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) continue;
      let y, mo, d;
      if (m[1].length === 4) [y, mo, d] = [+m[1], +m[2], +m[3]];
      else [d, mo, y] = [+m[1], +m[2], +m[3]];
      const hEnd = parseInt(r[cHour], 10);
      if (!(hEnd >= 1 && hEnd <= 25)) continue;
      const hour = Math.min(23, hEnd - 1); // hour starting
      const kwh = num(r[cKwh]);
      if (cExp >= 0) exportKwh += num(r[cExp]);
      const key = `${y}-${pad(mo)}`;
      const a = (months[key] = months[key] || { kwh: 0, p: [0, 0, 0], pd: [0, 0, 0], days: 0, hours: 0 });
      const per = isValleDay(y, mo, d) ? 2 : periodOfHour(hour);
      a.kwh += kwh;
      a.p[per] += kwh;
      const [sun0, sun1] = SUN_HOURS[mo - 1];
      if (hour >= sun0 && hour < sun1) a.pd[per] += kwh; // use during daylight, which solar can cover
      a.hours++;
      hours++;
      const dk = `${y}-${mo}-${d}`;
      if (!daySet.has(dk)) {
        daySet.add(dk);
        a.days++;
      }
      const t = Date.UTC(y, mo - 1, d);
      if (first == null || t < first) first = t;
      if (last == null || t > last) last = t;
    }
    if (!hours) throw new Error('No hourly rows with a readable date.');
    return { months, first, last, hours, days: daySet.size, exportKwh };
  }

  const api = { parseHourlyConsumptionCsv, parseEnphaseCsv, monthlyTotals, projectMonth, isValleDay, periodOfHour, PV_YIELD, MONTHS, MON };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EnphaseImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
