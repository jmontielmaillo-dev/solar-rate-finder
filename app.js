/* global Chart, SolarCalc */
(function () {
  const { rankRates, DEFAULT_SETTINGS } = SolarCalc;
  const STORE_KEY = 'solar-rate-finder-v1';
  // Elements of features that are not on the page resolve to a detached stub, so their code is a harmless no-op.
  const stubs = {};
  const $ = (id) => document.getElementById(id) || (stubs[id] = stubs[id] || document.createElement('div'));
  const onPage = (id) => !!document.getElementById(id);
  const eur = (x, d = 2) => (x == null || !isFinite(x) ? '–' : x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €');
  const fmt = (x, d = 3) => (x == null || !isFinite(x) ? '–' : x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- default state (from the sample Octopus bill, 14-09 to 15-10-2026) ----------
  const BILL_STATE = () => ({
    kw1: 7.7,
    kw2: 7.7,
    meter: +(0.83 / 31).toFixed(6),
    iee: +(DEFAULT_SETTINGS.ieeRate * 100).toFixed(6),
    vat: 21,
    useBV: true,
    fvOnly: true,
    months: [
      { on: true, name: 'Sep–Oct (my bill)', days: 31, weight: 12, mode: 'periods', kwh: [54, 41, 362], total: 457, split: [12, 9, 79], surplus: 0 },
      { on: false, name: 'Summer (July)', days: 31, weight: 4, mode: 'periods', kwh: [0, 0, 0], total: 0, split: [12, 9, 79], surplus: 0 },
      { on: false, name: 'Winter (January)', days: 31, weight: 4, mode: 'periods', kwh: [0, 0, 0], total: 0, split: [12, 9, 79], surplus: 0 },
    ],
    custom: [
      { name: 'Octopus 3 (my contract)', p1: 0.097, p2: 0.027, e1: 0.195, e2: 0.116, e3: 0.085, surplus: 0, bv: false, fee: 0, current: true },
    ],
  });
  const EXAMPLE_MONTHS = () => [
    { on: true, name: 'Summer (July) · example', days: 31, weight: 4, mode: 'solar', home: 600, production: 800, surplus: 420, kwh: [0, 0, 0], total: 0, split: [12, 10, 78] },
    { on: true, name: 'Mid-season (April) · example', days: 30, weight: 4, mode: 'solar', home: 620, production: 520, surplus: 260, kwh: [0, 0, 0], total: 0, split: [14, 11, 75] },
    { on: true, name: 'Winter (January) · example', days: 31, weight: 4, mode: 'solar', home: 760, production: 230, surplus: 45, kwh: [0, 0, 0], total: 0, split: [18, 14, 68] },
  ];

  let state;
  try {
    state = JSON.parse(localStorage.getItem(STORE_KEY)) || BILL_STATE();
  } catch (e) {
    state = BILL_STATE();
  }
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable: keep working in memory */
    }
  };

  let DATA = { rates: [] };
  let charts = {};
  if (typeof Chart !== 'undefined') {
    // tap or hover anywhere in a column, so tooltips work with touch on iPad
    Chart.defaults.interaction.mode = 'index';
    Chart.defaults.interaction.intersect = false;
    Chart.defaults.events = ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'];
    Chart.defaults.maintainAspectRatio = false;
  }

  // ---------- month cards ----------
  // Grid import for a month. In "solar" mode it is derived:
  // grid = home consumption - self-consumption, self-consumption = production - surplus
  function solarFlows(m) {
    const home = +m.home || 0;
    const prod = +m.production || 0;
    const sur = +m.surplus || 0;
    const self = Math.max(0, Math.min(prod - sur, home));
    return { home, prod, sur, self, grid: Math.max(0, home - self), bad: sur > prod || prod - sur > home };
  }
  function monthKwh(m) {
    if (m.mode === 'solar') {
      const s = m.split[0] + m.split[1] + m.split[2] || 1;
      const g = solarFlows(m).grid;
      return m.split.map((p) => (g * p) / s);
    }
    if (m.mode === 'total') {
      const s = m.split[0] + m.split[1] + m.split[2] || 1;
      return m.split.map((p) => (m.total * p) / s);
    }
    return m.kwh.map(Number);
  }

  function derivedText(m) {
    const f = solarFlows(m);
    if (f.bad) return `<span class="pos">Check the figures: surplus can't exceed production, and production minus surplus can't exceed home consumption.</span>`;
    const pctProd = f.prod ? Math.round((f.self / f.prod) * 100) : 0;
    const pctHome = f.home ? Math.round((f.self / f.home) * 100) : 0;
    return `Self-consumed ${fmt(f.self, 0)} kWh (${pctProd}% of production) · <b>bought from grid ${fmt(f.grid, 0)} kWh</b> · solar covers ${pctHome}% of home use`;
  }

  function renderMonths() {
    $('months').innerHTML = state.months
      .map((m, i) => {
        const id = (k) => `m${i}-${k}`;
        const splitRow = (lbl) => `<div class="row">
              <label class="f"><span class="ptag p1">P1 %</span><input type="number" id="${id('s0')}" data-m="${i}" data-k="split0" min="0" step="1" value="${m.split[0]}"></label>
              <label class="f"><span class="ptag p2">P2 %</span><input type="number" id="${id('s1')}" data-m="${i}" data-k="split1" min="0" step="1" value="${m.split[1]}"></label>
              <label class="f"><span class="ptag p3">P3 %</span><input type="number" id="${id('s2')}" data-m="${i}" data-k="split2" min="0" step="1" value="${m.split[2]}"></label>
            </div>
            <span class="tot">${lbl}</span>`;
        const periods =
          m.mode === 'solar'
            ? `<div class="row">
              <label class="f">Home use <span class="u">kWh, all sources</span><input type="number" id="${id('home')}" data-m="${i}" data-k="home" min="0" step="1" value="${m.home ?? 0}"></label>
              <label class="f surplus">Solar production <span class="u">kWh</span><input type="number" id="${id('prod')}" data-m="${i}" data-k="production" min="0" step="1" value="${m.production ?? 0}"></label>
              <label class="f surplus">Surplus exported <span class="u">kWh</span><input type="number" id="${id('sur')}" data-m="${i}" data-k="surplus" min="0" step="1" value="${m.surplus}"></label>
            </div>
            <div class="derived small num" data-derived="${i}">${derivedText(m)}</div>
            <span class="eyebrow">When the grid import happens</span>
            ${splitRow('Share of the grid import in each period. Self-consumption happens in daylight, so most of what you still buy usually falls in P3 valle (nights, weekends).')}`
            : m.mode === 'periods'
            ? `<div class="row">
              <label class="f"><span class="ptag p1">P1 punta</span><input type="number" id="${id('k0')}" data-m="${i}" data-k="kwh0" min="0" step="1" value="${m.kwh[0]}"></label>
              <label class="f"><span class="ptag p2">P2 llano</span><input type="number" id="${id('k1')}" data-m="${i}" data-k="kwh1" min="0" step="1" value="${m.kwh[1]}"></label>
              <label class="f"><span class="ptag p3">P3 valle</span><input type="number" id="${id('k2')}" data-m="${i}" data-k="kwh2" min="0" step="1" value="${m.kwh[2]}"></label>
            </div>
            <span class="tot num">Total ${fmt(m.kwh.reduce((a, b) => a + Number(b), 0), 0)} kWh</span>
            ${m.src ? `<span class="src-note">${esc(m.src)}</span>` : ''}`
            : `<label class="f">Total consumed <span class="u">kWh</span><input type="number" id="${id('tot')}" data-m="${i}" data-k="total" min="0" step="1" value="${m.total}"></label>
            <div class="row">
              <label class="f"><span class="ptag p1">P1 %</span><input type="number" id="${id('s0')}" data-m="${i}" data-k="split0" min="0" step="1" value="${m.split[0]}"></label>
              <label class="f"><span class="ptag p2">P2 %</span><input type="number" id="${id('s1')}" data-m="${i}" data-k="split1" min="0" step="1" value="${m.split[1]}"></label>
              <label class="f"><span class="ptag p3">P3 %</span><input type="number" id="${id('s2')}" data-m="${i}" data-k="split2" min="0" step="1" value="${m.split[2]}"></label>
            </div>
            <span class="tot">The split is only used by three-period rates. Single-price rates use the total.</span>`;
        return `<div class="month ${m.on ? '' : 'off'}">
          <div class="month-head">
            <input type="text" id="${id('name')}" data-m="${i}" data-k="name" value="${esc(m.name)}" aria-label="Month name">
            <label class="switch"><input type="checkbox" id="${id('on')}" data-m="${i}" data-k="on" ${m.on ? 'checked' : ''} ${i === 0 ? 'disabled title="At least one month is needed"' : ''}> Use</label>
          </div>
          <div class="fields">
            <div class="row two">
              <label class="f">Days billed<input type="number" id="${id('days')}" data-m="${i}" data-k="days" min="1" max="62" step="1" value="${m.days}"></label>
              <label class="f">Months of the year it represents<input type="number" id="${id('w')}" data-m="${i}" data-k="weight" min="0" max="12" step="0.5" value="${m.weight}"></label>
            </div>
            <div class="bar" style="justify-content:space-between">
              <span class="eyebrow">${m.mode === 'solar' ? 'Consumption and production' : 'Energy bought from the grid'}</span>
              <span class="seg" role="group" aria-label="Input mode">
                <button type="button" data-m="${i}" data-mode="periods" aria-pressed="${m.mode === 'periods'}">3 periods</button>
                <button type="button" data-m="${i}" data-mode="total" aria-pressed="${m.mode === 'total'}">Total</button>
                <button type="button" data-m="${i}" data-mode="solar" aria-pressed="${m.mode === 'solar'}">From production</button>
              </span>
            </div>
            ${periods}
            ${m.mode === 'solar' ? '' : `<label class="f surplus">Solar surplus exported <span class="u">kWh (excedentes)</span><input type="number" id="${id('sur')}" data-m="${i}" data-k="surplus" min="0" step="1" value="${m.surplus}"></label>`}
          </div>
        </div>`;
      })
      .join('');
  }

  $('months').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.m == null || !t.dataset.k) return;
    const m = state.months[+t.dataset.m];
    const k = t.dataset.k;
    if (k === 'name') m.name = t.value;
    else if (k === 'on') {
      m.on = t.checked;
      const active = state.months.filter((x) => x.on);
      active.forEach((x) => (x.weight = +(12 / active.length).toFixed(1)));
      renderMonths();
    } else if (k.startsWith('kwh')) {
      m.kwh[+k.slice(3)] = Math.max(0, +t.value || 0);
      const tot = t.closest('.fields').querySelector('.tot');
      if (tot) tot.textContent = `Total ${fmt(m.kwh.reduce((a, b) => a + b, 0), 0)} kWh`;
    } else if (k.startsWith('split')) m.split[+k.slice(5)] = Math.max(0, +t.value || 0);
    else m[k] = Math.max(0, +t.value || 0);
    const d = $('months').querySelector(`[data-derived="${t.dataset.m}"]`);
    if (d) d.innerHTML = derivedText(m);
    update();
  });
  $('months').addEventListener('change', (e) => {
    if (e.target.dataset.k === 'on') return; // handled on input
  });
  $('months').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    const m = state.months[+b.dataset.m];
    if (m.mode === b.dataset.mode) return;
    if (b.dataset.mode === 'solar') {
      // start from the same grid import: home = grid + whatever was self-consumed (0 if unknown)
      const grid = monthKwh(m).reduce((a, x) => a + x, 0);
      if (!(m.production > 0)) m.production = m.surplus || 0;
      const self = Math.max(0, m.production - (m.surplus || 0));
      if (!(m.home > 0)) m.home = Math.round(grid + self);
      if (m.mode === 'periods' && grid > 0) m.split = m.kwh.map((x) => Math.round((x / grid) * 100));
    } else if (b.dataset.mode === 'total') {
      const grid = monthKwh(m).reduce((a, x) => a + x, 0);
      if (m.mode === 'solar') m.total = Math.round(grid);
      const t = m.mode === 'solar' ? 0 : m.kwh.reduce((a, x) => a + x, 0);
      if (t > 0) {
        m.total = t;
        m.split = m.kwh.map((x) => Math.round((x / t) * 100));
      }
    } else {
      m.kwh = monthKwh(m).map((x) => Math.round(x));
    }
    m.mode = b.dataset.mode;
    renderMonths();
    update();
  });

  // ---------- settings ----------
  function renderSettings() {
    $('kw1').value = state.kw1;
    $('kw2').value = state.kw2;
    $('meter').value = state.meter;
    $('iee').value = state.iee;
    $('vat').value = state.vat;
    $('use-bv').checked = state.useBV;
    $('fvonly').checked = state.fvOnly;
  }
  ['kw1', 'kw2', 'meter', 'iee', 'vat'].forEach((k) =>
    $(k).addEventListener('input', (e) => {
      state[k] = Math.max(0, +e.target.value || 0);
      update();
    }),
  );
  $('use-bv').addEventListener('change', (e) => {
    state.useBV = e.target.checked;
    update();
  });
  $('fvonly').addEventListener('change', (e) => {
    state.fvOnly = e.target.checked;
    update();
  });

  // ---------- custom rates ----------
  const CUSTOM_COLS = [
    ['name', 'Name', 'text'],
    ['p1', 'P1 €/kW·day', 'number'],
    ['p2', 'P2 €/kW·day', 'number'],
    ['e1', 'P1 €/kWh', 'number'],
    ['e2', 'P2 €/kWh', 'number'],
    ['e3', 'P3 €/kWh', 'number'],
    ['surplus', 'Surplus €/kWh', 'number'],
    ['fee', 'Fee €/month', 'number'],
  ];
  function renderCustom() {
    const head = `<tr>${CUSTOM_COLS.map((c) => `<th>${c[1]}</th>`).join('')}<th>Virtual battery</th><th>Current</th><th></th></tr>`;
    const rows = state.custom
      .map(
        (r, i) => `<tr>${CUSTOM_COLS.map(
          ([k, , type]) =>
            `<td><input class="${type === 'text' ? 'plain' : ''}" type="${type}" id="c${i}-${k}" data-c="${i}" data-k="${k}" ${type === 'number' ? 'step="0.000001" min="0" style="width:96px"' : 'style="width:240px"'} value="${esc(r[k])}" aria-label="${k}"></td>`,
        ).join('')}
        <td><input type="checkbox" id="c${i}-bv" data-c="${i}" data-k="bv" ${r.bv ? 'checked' : ''} aria-label="Virtual battery"></td>
        <td><input type="radio" name="current" id="c${i}-cur" data-c="${i}" data-k="current" ${r.current ? 'checked' : ''} aria-label="My current rate"></td>
        <td><button class="btn" type="button" data-del="${i}">Remove</button></td></tr>`,
      )
      .join('');
    const none = `<tr><td colspan="11" style="text-align:left"><input type="radio" name="current" id="c-none" data-c="-1" data-k="current" ${state.custom.some((r) => r.current) ? '' : 'checked'}> <label for="c-none">No current rate to compare against</label></td></tr>`;
    $('custom-table').innerHTML = head + rows + none;
  }
  $('custom-table').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.c == null) return;
    const i = +t.dataset.c;
    const k = t.dataset.k;
    if (k === 'current') state.custom.forEach((r, j) => (r.current = j === i));
    else if (k === 'bv') state.custom[i].bv = t.checked;
    else if (k === 'name') state.custom[i].name = t.value;
    else state.custom[i][k] = Math.max(0, +t.value || 0);
    update();
  });
  $('custom-table').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-del]');
    if (!b) return;
    state.custom.splice(+b.dataset.del, 1);
    renderCustom();
    update();
  });
  $('btn-add').addEventListener('click', () => {
    state.custom.push({ name: 'New rate', p1: 0.1, p2: 0.03, e1: 0.15, e2: 0.15, e3: 0.15, surplus: 0.05, bv: false, fee: 0, current: false });
    renderCustom();
    update();
  });

  function customToRate(c, i) {
    return {
      id: `custom-${i}`,
      custom: true,
      current: !!c.current,
      provider: 'My rate',
      plan: c.name || 'My current rate',
      url: null,
      accessTariff: c.e1 === c.e2 && c.e2 === c.e3 ? '2.0A' : '2.0TD',
      tags: c.bv ? ['FV', 'BV'] : ['FV'],
      comparable: true,
      maxKw: null,
      cae: null,
      power: { p1: +c.p1, p2: +c.p2 },
      energy: { e1: +c.e1, e2: +c.e2, e3: +c.e3 },
      monthlyFee: +c.fee || null,
      socialBond: 0.024688,
      surplus: { price: +c.surplus, priceText: String(c.surplus), compensates: 'Consumo' },
      virtualBattery: c.bv ? { beforeTax: false, text: 'Custom', appliesTo: 'Total factura' } : null,
    };
  }

  // ---------- calculation + rendering ----------
  const yearOn = () => !!state.imp;
  function yrOpts() {
    state.yr = state.yr || { winter: 1, prod: 1, minDays: 7 };
    return state.yr;
  }

  // ---------- monthly grid consumption from the energy provider ----------
  const ES_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function provider() {
    if (!state.provider) state.provider = window.DEFAULT_PROVIDER ? JSON.parse(JSON.stringify(window.DEFAULT_PROVIDER)) : {};
    return state.provider; // { "2026-01": 950.25, ... }
  }
  function parseKwh(t) {
    t = t.trim();
    if (/,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }
  // "enero 2026   950,250 kWh" (one per line, as copied from the provider's portal)
  function parseProviderText(text) {
    const out = {};
    const re = new RegExp(`(${ES_MONTHS.concat(EN_MONTHS).join('|')})\\s+(?:de\\s+)?(\\d{4})[^\\d]+([\\d.,]+)\\s*kwh`, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const name = m[1].toLowerCase();
      const mi = (ES_MONTHS.indexOf(name) + 1) || (EN_MONTHS.indexOf(name) + 1);
      const v = parseKwh(m[3]);
      if (mi && v != null) out[`${m[2]}-${String(mi).padStart(2, '0')}`] = v;
    }
    return out;
  }
  // ---------- hourly consumption file from the distributor ----------
  function hourly() {
    if (state.hourly === undefined && window.DEFAULT_HOURLY) state.hourly = JSON.parse(JSON.stringify(window.DEFAULT_HOURLY));
    return state.hourly || null;
  }
  // share of home use in P1/P2/P3 for a calendar month (latest year in the file), or null
  function hourlyMonth(m) {
    const H = hourly();
    if (!H) return null;
    const keys = Object.keys(H.months).filter((k) => +k.slice(5) === m).sort();
    const v = keys.length ? H.months[keys[keys.length - 1]] : null;
    return v && v.kwh ? v : null;
  }
  function periodShares(m) {
    const v = hourlyMonth(m);
    return v ? v.p.map((x) => x / v.kwh) : null;
  }
  // share of home use that happens in daylight, per period (what solar can offset)
  function daylightShares(m) {
    const v = hourlyMonth(m);
    return v && v.pd ? v.pd.map((x) => x / v.kwh) : null;
  }

  // first day with Enphase data = solar installation date
  function installDate() {
    const r = impRows();
    if (!r.length) return null;
    const f = r.reduce((a, x) => (Date.UTC(x.y, x.m - 1, x.d) < Date.UTC(a.y, a.m - 1, a.d) ? x : a));
    return Date.UTC(f.y, f.m - 1, f.d);
  }
  // Provider months fully before the installation: grid consumption = home use.
  function providerHomeUse() {
    const inst = installDate();
    const byMonth = new Map();
    const entries = []; // typed readings are no longer used: home use comes from files only
    const H = hourly();
    if (H) for (const [k, v] of Object.entries(H.months)) entries.push([k, v.kwh * (new Date(Date.UTC(+k.slice(0, 4), +k.slice(5), 0)).getUTCDate() / v.days), 'file']);
    for (const [k, v, kind] of entries) {
      const [y, m] = k.split('-').map(Number);
      if (inst != null && Date.UTC(y, m, 0) >= inst) continue; // after solar: grid ≠ home use
      const prev = byMonth.get(m);
      // the hourly file wins over typed readings; among the same kind, the most recent year wins
      const better = !prev || (kind === 'file' && prev.kind !== 'file') || (kind === prev.kind && prev.y < y);
      if (better) byMonth.set(m, { y, m, kwh: v, kind });
    }
    return byMonth;
  }

  // ---------- consumption profile (shape of home use over the year) ----------
  const PROFILES = {
    both: { label: 'More in winter and summer (heating + cooling)', w: [1.25, 1.2, 1.02, 0.85, 0.88, 1.02, 1.2, 1.15, 0.95, 0.85, 0.98, 1.2] },
    winter: { label: 'More in winter (heating)', w: [1.35, 1.3, 1.12, 0.95, 0.85, 0.8, 0.8, 0.8, 0.85, 0.95, 1.12, 1.3] },
    summer: { label: 'More in summer (air conditioning)', w: [0.85, 0.85, 0.9, 0.95, 1.05, 1.2, 1.35, 1.3, 1.1, 0.95, 0.85, 0.85] },
    flat: { label: 'Flat all year', w: Array(12).fill(1) },
  };
  let lastProfile = null;
  let lastYear = null;
  const norm = (a) => {
    const mean = a.reduce((x, y) => x + y, 0) / a.length || 1;
    return a.map((v) => v / mean);
  };
  function profState() {
    state.profile = state.profile || { preset: 'both', auto: true, custom: null, ignore: {} };
    state.profile.ignore = state.profile.ignore || {};
    return state.profile;
  }
  const profileUsesData = (m) => !profState().ignore[m];
  // Effective weights, average 1. Custom edits win; otherwise the preset shape, and in auto mode
  // months with data take their real level and the rest follow the preset scaled to fit them.
  function profileWeights(known) {
    const ps = profState();
    if (ps.custom) return norm(ps.custom);
    const P = norm(PROFILES[ps.preset]?.w || PROFILES.flat.w);
    const ks = Object.keys(known || {}).map(Number);
    if (!ps.auto || !ks.length) return P;
    const sc = ks.reduce((a, m) => a + known[m], 0) / ks.reduce((a, m) => a + P[m - 1], 0);
    return norm(P.map((p, i) => (known[i + 1] != null ? known[i + 1] : p * sc)));
  }

  function renderProfile() {
    if (!lastProfile) return;
    const ps = profState();
    const { W, known, knownSrc, level, prov } = lastProfile;
    $('prof-preset').innerHTML = Object.entries(PROFILES).map(([k, v]) => `<option value="${k}" ${!ps.custom && ps.preset === k ? 'selected' : ''}>${v.label}</option>`).join('') + (ps.custom ? '<option value="custom" selected>Custom (edited by you)</option>' : '');
    $('prof-auto').checked = !!ps.auto && !ps.custom;
    $('prof-auto').disabled = !!ps.custom;
    const nData = Object.keys(known).length;
    $('learn-box').classList.toggle('on', !!ps.auto && !ps.custom);
    $('learn-state').textContent = ps.custom
      ? 'Off: you edited the profile by hand. Reset the profile to learn from your data again.'
      : ps.auto
        ? `On: ${nData} month${nData === 1 ? '' : 's'} of real data set the level and shape; the other ${12 - nData} follow the profile.`
        : 'Off: all months without data follow the preset shape as it is.';
    const max = Math.max(...W);
    $('prof-grid').innerHTML = W.map((w, i) => {
      const m = i + 1;
      const fromData = known[m] != null;
      const hasProv = prov.has(m) && knownSrc[m] !== 'Enphase';
      const kwh = Math.round((fromData ? known[m] : level * w) * new Date(Date.UTC(2027, m, 0)).getUTCDate());
      return `<div class="pm ${fromData ? 'data' : ''}">
        <div class="pm-bar" style="height:${Math.round((w / max) * 100)}%"></div>
        <span class="pm-m">${EI.MON[i]}</span>
        <input type="number" id="pw-${m}" data-m="${m}" min="0" step="5" value="${Math.round(w * 100)}" aria-label="${EI.MONTHS[i]} profile, percent of average" ${fromData ? 'disabled' : ''}>
        <span class="pm-k num">${fmt(kwh, 0)} kWh</span>
        <span class="pm-s">${fromData ? (knownSrc[m] === 'Enphase' ? 'Enphase' : 'provider') : 'profile'}</span>
        ${hasProv ? `<label class="pm-use"><input type="checkbox" data-use="${m}" ${profileUsesData(m) ? 'checked' : ''}> use reading</label>` : ''}
      </div>`;
    }).join('');
  }
  $('prof-preset').addEventListener('change', (e) => {
    const ps = profState();
    if (e.target.value === 'custom') return;
    ps.preset = e.target.value;
    ps.custom = null;
    update();
  });
  $('prof-auto').addEventListener('change', (e) => {
    profState().auto = e.target.checked;
    update();
  });
  $('prof-reset').addEventListener('click', () => {
    const ps = profState();
    ps.custom = null;
    ps.auto = true;
    ps.ignore = {};
    update();
  });
  $('prof-grid').addEventListener('change', (e) => {
    const ps = profState();
    if (e.target.dataset.use) {
      if (e.target.checked) delete ps.ignore[e.target.dataset.use];
      else ps.ignore[e.target.dataset.use] = true;
      update();
      return;
    }
    const m = +e.target.dataset.m;
    if (!m || !lastProfile) return;
    const w = lastProfile.W.slice();
    w[m - 1] = Math.max(0, +e.target.value || 0) / 100;
    ps.custom = w;
    update();
  });

  // Relative daily solar output by month: A + B·cos(2π(day − 172)/365), peak on 21 June.
  // winterRatio = output in late December vs late June (about 0.47 for tilted panels in central Spain).
  let lastSolarCurve = null;
  function solarShape(winterRatio) {
    const r = Math.min(0.95, Math.max(0.05, winterRatio));
    const B = (1 - r) / (1 + r); // with A = 1: (1 − B) / (1 + B) = r
    const out = [];
    let doy = 0;
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(Date.UTC(2027, m, 0)).getUTCDate();
      let sum = 0;
      for (let d = 1; d <= dim; d++) sum += 1 + B * Math.cos((2 * Math.PI * (doy + d - 172)) / 365);
      doy += dim;
      out.push(sum / dim);
    }
    return out;
  }

  // Twelve calendar months: measured where the Enphase file has enough days, estimated otherwise.
  // Home use for estimated months comes, in order of preference, from:
  // the provider's pre-solar readings, then interpolation between known months.
  // Keep only complete days: any value for daily reports, at least 22 distinct hours for interval reports.
  function completeRows(rows) {
    const by = new Map();
    for (const r of rows) {
      const k = `${r.y}-${r.m}-${r.d}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    const out = [];
    for (const list of by.values()) {
      const interval = list.some((r) => r.hour != null);
      const ok = interval ? new Set(list.map((r) => r.hour)).size >= 22 : list.some((r) => (r.prod || 0) > 0 || (r.cons || 0) > 0);
      if (ok) out.push(...list);
    }
    return out;
  }

  function buildYear() {
    const rows = completeRows(impRows());
    const split = state.imp.split;
    const o = yrOpts();
    const all = EI.monthlyTotals(rows, split);
    const measured = new Map();
    for (const x of all) if (x.days >= 1) measured.set(x.month, x); // any measured day counts; latest year wins
    const allRefs = [...measured.values()];
    if (!allRefs.length) return [];
    // months with at least a week of data give more reliable daily patterns
    const refs = allRefs.filter((x) => x.days >= 7).length ? allRefs.filter((x) => x.days >= 7) : allRefs;
    // reference months for daily patterns: prefer fully measured ones
    const AVG = SolarCalc.AVG_MONTH_DAYS;
    const dimOf = (m) => new Date(Date.UTC(2027, m, 0)).getUTCDate();
    const prov = providerHomeUse();

    // real home use per day where we have it: Enphase measured months, then provider readings from before solar
    const known = {};
    const knownSrc = {};
    for (let m = 1; m <= 12; m++) {
      const x = measured.get(m);
      if (x) {
        known[m] = x.cons / x.days;
        knownSrc[m] = 'Enphase';
      } else if (prov.has(m) && profileUsesData(m)) {
        known[m] = prov.get(m).kwh / dimOf(m);
        knownSrc[m] = prov.get(m).kind === 'file' ? `provider file, ${EI.MON[m - 1]} ${prov.get(m).y}` : `provider, ${EI.MON[m - 1]} ${prov.get(m).y}`;
      }
    }
    // months without data follow the consumption profile, scaled to the level of the months with data
    const W = profileWeights(known);
    const dataMonths = Object.keys(known).map(Number);
    const level = dataMonths.length ? dataMonths.reduce((a, m) => a + known[m], 0) / dataMonths.reduce((a, m) => a + W[m - 1], 0) : 0;
    const home = {};
    const homeSrc = {};
    for (let m = 1; m <= 12; m++) {
      if (known[m] != null) {
        home[m] = known[m] * dimOf(m);
        homeSrc[m] = knownSrc[m];
      } else {
        home[m] = level * W[m - 1] * dimOf(m);
        homeSrc[m] = `profile, ${Math.round(W[m - 1] * 100)}% of average`;
      }
    }
    lastProfile = { W, known, knownSrc, level, prov };

    // Solar production follows one smooth seasonal curve peaking at the June solstice,
    // scaled so it matches the months Enphase measured (weighted by days of data).
    const shape = solarShape(o.winterRatio ?? 0.47);
    const mList = [...measured.values()];
    // monthly totals follow the bell (an average-length month each), so June is always the peak
    const AVGM = SolarCalc.AVG_MONTH_DAYS;
    const kMonth = mList.reduce((a, x) => a + x.prod, 0) / (mList.reduce((a, x) => a + (shape[x.month - 1] * x.days) / AVGM, 0) || 1);
    const prodPerDay = (m) => (kMonth * shape[m - 1] * (o.prod ?? 1)) / dimOf(m);
    lastSolarCurve = { shape, kMonth };

    const out = [];
    for (let m = 1; m <= 12; m++) {
      const dim = dimOf(m);
      let x = measured.get(m);
      let source = 'measured';
      let note = '';
      let prodMeas = 0;
      let measDays = 0;
      if (x) {
        prodMeas = x.prod;
        measDays = x.days;
        const md = dim - x.days;
        if (md > 0) {
          // missing days: solar from the seasonal curve, home use at the measured daily average,
          // self-use share and grid split as on the measured days
          source = 'partial';
          const pE = prodPerDay(m) * md;
          const hE = (x.cons / x.days) * md;
          const sE = Math.min(hE, pE * (x.prod > 0 ? x.self / x.prod : 0));
          const iE = hE - sE;
          const eE = pE - sE;
          const impT = x.imp + iE;
          const kw = x.imp > 0 ? x.kwh.map((k) => (k * impT) / x.imp) : [0, 0, impT];
          x = { ...x, prod: x.prod + pE, cons: x.cons + hE, self: x.self + sE, imp: impT, exp: x.exp + eE, kwh: kw, days: dim };
          note = `${measDays} of ${dim} days measured, ${md} estimated`;
        } else note = `${dim} days measured`;
      } else {
        // production: from the measured month with the most similar typical solar yield
        // daily usage pattern from the measured month with the most similar sunshine
        const ref = refs.slice().sort((a, b) => Math.abs(shape[a.month - 1] - shape[m - 1]) - Math.abs(shape[b.month - 1] - shape[m - 1]) || b.days - a.days)[0];
        const prodFactor = ref.prod > 0 ? (prodPerDay(m) * ref.days) / ref.prod : 1;
        const refHomeFull = (ref.cons * dim) / ref.days;
        const consFactor = refHomeFull > 0 ? home[m] / refHomeFull : 1;
        x = EI.projectMonth(rows, ref.key, m, { prodFactor, consFactor }, split);
        source = 'estimated';
        note = `solar curve ${fmt(prodPerDay(m), 1)} kWh/day · usage pattern from ${ref.label}`;
      }
      const f = dim / x.days;
      let kwhSplit = x.kwh.map((k) => k * f);
      const sh = periodShares(m);
      if (sh && source === 'estimated') {
        // home use split by your real hourly pattern, minus solar used directly (daylight: P1/P2 on weekdays, P3 on weekends)
        const vs = valleShare(m);
        const self = x.self * f;
        const home = x.cons * f;
        const homeK = sh.map((p) => p * home);
        const dl = daylightShares(m);
        let selfK;
        if (dl) {
          // solar offsets the daylight part of each period, in proportion to how much you use then
          const dK = dl.map((p) => p * home);
          const dT = dK.reduce((a, b) => a + b, 0) || 1;
          selfK = dK.map((d) => Math.min(d, (self * d) / dT));
        } else selfK = [self * (1 - vs) * SELF_WEEKDAY_SPLIT[0], self * (1 - vs) * SELF_WEEKDAY_SPLIT[1], self * vs];
        const raw = homeK.map((h, i) => Math.max(0, h - selfK[i]));
        const rt = raw.reduce((a, b) => a + b, 0) || 1;
        kwhSplit = raw.map((r) => (r / rt) * x.imp * f);
      }
      out.push({
        m,
        label: EI.MONTHS[m - 1],
        short: EI.MON[m - 1],
        source,
        note,
        measDays,
        prodMeas,
        homeSrc: homeSrc[m],
        homeKnown: !/^profile/.test(homeSrc[m]),
        days: dim,
        home: x.cons * f,
        prod: x.prod * f,
        self: x.self * f,
        exp: x.exp * f,
        imp: x.imp * f,
        kwh: kwhSplit,
        weight: dim / AVG,
      });
    }
    return out;
  }

  function activeMonths() {
    if (yearOn()) {
      const y = buildYear();
      if (y.length) return y.map((x) => ({ name: x.label, source: x.source, days: x.days, weight: x.weight, kwP1: state.kw1, kwP2: state.kw2, kwh: x.kwh, surplusKWh: x.exp, year: x }));
    }
    return []; // no manual mode: an Enphase report is needed to build the year
  }

  function settings() {
    return { ...DEFAULT_SETTINGS, ieeRate: state.iee / 100, vatRate: state.vat / 100, meterRentPerDay: state.meter, useVirtualBattery: state.useBV };
  }

  function css(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }

  let lastResult = null;
  function update() {
    save();
    const months = activeMonths();
    applyYearMode();
    renderMode();
    renderConsumptionBasics();
    const ready = months.length > 0;
    $('rf-empty').hidden = ready;
    $('rf-body').hidden = !ready;
    $('cons-year-card').hidden = !ready;
    $('grid-period-card').hidden = !ready;
    if (!ready) {
      lastResult = null;
      return;
    }

    let rates = DATA.rates.slice();
    if (!state.fvOnly) rates = rates.filter((r) => !r.fvOnly);
    // your current rate: one from the list, or prices typed in by you
    const cs = curState();
    let list = rates.map((r) => (cs.mode === 'list' && r.id === cs.id ? { ...r, current: true } : r));
    if (cs.mode === 'manual' && manualValid(cs.manual)) list = list.concat([{ ...customToRate({ ...cs.manual, current: true }, 0), id: 'my-current' }]);
    const res = rankRates(list, months, settings());
    lastResult = { ...res, months };
    renderVerdict(res, months);
    renderBreakdownSelect(months);
    renderTable();
    renderCharts(res, months);
    renderYear(res, months);
    renderSavings(res, months);
  }

  function applyYearMode() {
    const has = !!state.imp;
    const yr = yearOn();
    // in full-year mode the per-month bill chart lives in the year panel, so this one is redundant
    $('months-chart-card').hidden = yr;
    $('rank-charts').classList.toggle('single', yr);
    $('year-mode-seg').hidden = !has;
    $('ym-year').setAttribute('aria-pressed', yr);
    $('ym-cards').setAttribute('aria-pressed', !yr);
    $('year-panel').hidden = !yr;
    $('months').hidden = yr;
    $('import-body').hidden = !has || yr;
    $('split-box').hidden = !has || !!(state.imp && state.imp.interval);
    $('btn-example').hidden = yr;
    $('btn-reset').hidden = yr;
    if (yr) {

      const o = yrOpts();
      $('yr-prod').value = o.prod;
      $('yr-winter-ratio').value = Math.round((o.winterRatio ?? 0.47) * 100);
      $('yr-mindays').value = o.minDays;
    }
  }

  function renderYear(res, months) {
    if (!yearOn() || !months.length || !months[0].year) return;
    const Y = months.map((m) => m.year);
    lastYear = Y;
    renderProfile();
    const best = res.ranked[0];
    const cur = currentOf(res);
    // solar status per month, and consumption status (home use + grid purchases)
    const sStat = (y) => y.source; // measured | partial | estimated
    // grid purchases: measured for every month when the i-DE file covers a full year, else follow Enphase
    const ideFull = hourlyFullYear();
    const gStat = (y) => (ideFull ? 'measured' : sStat(y));
    const LBL = { measured: 'Measured', partial: 'Partly measured', estimated: 'Estimated' };
    const CLS = { measured: 'meas', partial: 'part', estimated: 'est' };
    const count = (fn, v) => Y.filter((y) => fn(y) === v).length;
    const mC = css('--m-color');
    const eC = css('--e-color');
    const solarC = css('--s4');
    const gridC = css('--grid-color');
    const expC = css('--s3');
    const ink = css('--ink');
    const ink2 = css('--ink-2');
    const line = css('--line');
    const T = (k) => Y.reduce((a, y) => a + y[k], 0);
    const nFile = Y.filter((y) => /provider file/.test(y.homeSrc || '')).length;
    const nProf = Y.filter((y) => /^profile/.test(y.homeSrc || '')).length;
    const nE = Y.filter((y) => y.source !== 'estimated').length;
    $('year-sub').textContent = `Above the line: home use, split into solar you used directly and energy bought from the grid. Below the line: solar you exported. Amber + teal together is everything your panels produced. Home use: ${nE} month${nE === 1 ? '' : 's'} from Enphase${nFile ? `, ${nFile} from your i-DE file` : ''}${nProf ? `, ${nProf} from the consumption profile` : ''}.`;
    $('year-legend').innerHTML = `<span><i style="background:${solarC}"></i>Solar used at home</span><span><i style="background:${gridC}"></i>Bought from grid</span><span><i style="background:${expC}"></i>Exported</span><span><i class="band-key"></i>Measured</span><span><i class="band-key bk-part"></i>Partly measured</span>`;

    // month-by-month table, including what each rate pays for the solar you export
    const money = (x, i, k) => (x ? eur(x.perMonth[i][k]) : '–');
    const credit = (x, i) => (x ? (x.perMonth[i].compensation > 0 ? '−' + eur(x.perMonth[i].compensation) : eur(0)) : '–');
    const bn = best ? esc(rateName(best.rate)) : 'best rate';
    const cn = cur ? esc(cur.rate.custom ? cur.rate.plan : rateName(cur.rate)) : null;
    $('year-table').innerHTML = `<thead><tr><th>Month</th><th>Status</th><th>Home use<br>kWh</th><th>Production<br>kWh</th><th>Used at home<br>kWh</th><th>Exported<br>kWh</th><th>Bought from grid<br>P1 / P2 / P3</th>
      <th>${bn}<br>surplus paid</th><th>${bn}<br>bill</th>${cn ? `<th>${cn}<br>surplus paid</th><th>${cn}<br>bill</th>` : ''}</tr></thead>
      <tbody>${Y.map(
        (y, i) => `<tr class="${y.source === 'estimated' ? 'est-row' : ''}"><td><b>${y.label}</b><br><span class="small muted">${esc(y.note)}</span></td>
        <td><span class="src ${CLS[sStat(y)]}">${LBL[sStat(y)]}</span></td>
        <td class="num">${fmt(y.home, 0)}<br><span class="small muted">${esc(y.homeSrc)}</span></td><td class="num">${fmt(y.prod, 0)}</td><td class="num">${fmt(y.self, 0)}</td><td class="num">${fmt(y.exp, 0)}</td>
        <td class="num">${fmt(y.imp, 0)}<br><span class="small muted">${y.kwh.map((k) => fmt(k, 0)).join(' / ')}</span></td>
        <td class="num neg">${credit(best, i)}</td><td class="num"><b>${money(best, i, 'total')}</b></td>${cn ? `<td class="num neg">${credit(cur, i)}</td><td class="num"><b>${money(cur, i, 'total')}</b></td>` : ''}</tr>`,
      ).join('')}</tbody>
      <tfoot><tr><td>Year</td><td></td><td class="num">${fmt(T('home'), 0)}</td><td class="num">${fmt(T('prod'), 0)}</td><td class="num">${fmt(T('self'), 0)}</td><td class="num">${fmt(T('exp'), 0)}</td><td class="num">${fmt(T('imp'), 0)}</td>
      <td class="num neg">${best ? '−' + eur(best.perMonth.reduce((a, b) => a + b.compensation, 0), 0) : '–'}</td>
      <td class="num">${best ? eur(best.annual, 0) : '–'}${best && best.bvCreditUsed > 0 ? `<br><span class="small muted">after ${eur(best.bvCreditUsed, 0)} battery credit</span>` : ''}</td>
      ${cn ? `<td class="num neg">−${eur(cur.perMonth.reduce((a, b) => a + b.compensation, 0), 0)}</td><td class="num">${eur(cur.annual, 0)}</td>` : ''}</tr></tfoot>`;

    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = ink2;
    Chart.defaults.font = { family: css('--f-body'), size: 13 };
    const labels = Y.map((y) => y.short);
    // per-month band: strong for measured, light for partly measured
    const bandFor = (statFn) => ({
      id: 'statusBand',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales } = chart;
        const x = scales.x;
        const step = x.width / labels.length;
        ctx.save();
        Y.forEach((y, i) => {
          const st = statFn(y);
          if (st === 'estimated') return;
          const cx = x.getPixelForValue(i);
          ctx.globalAlpha = st === 'measured' ? 0.16 : 0.07;
          ctx.fillStyle = mC;
          ctx.fillRect(cx - step / 2, a.top, step, a.bottom - a.top);
          // caption under the month name, clear of the bars and value labels
          ctx.globalAlpha = 1;
          ctx.fillStyle = mC;
          ctx.font = `600 ${step >= 56 ? 10 : 8}px ${css('--f-body')}`;
          ctx.textAlign = 'center';
          ctx.fillText(step >= 56 ? (st === 'measured' ? 'MEASURED' : 'PARTLY') : st === 'measured' ? 'M' : 'P', cx, chart.height - 4);
        });
        ctx.restore();
      },
    });
    // value labels above (or below, for negative bars) a dataset or a stack
    const valueLabels = (fmtFn, pick, below) => ({
      id: 'valueLabels' + (below ? 'B' : 'T'),
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const metas = chart.getSortedVisibleDatasetMetas().filter((m) => m.type === 'bar');
        const target = pick(metas, chart);
        if (!target) return;
        ctx.save();
        ctx.font = `600 11px ${css('--f-body')}`;
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        target.data.forEach((el, i) => {
          const v = fmtFn(i);
          if (v == null) return;
          ctx.fillText(v, el.x, below ? el.y + 14 : el.y - 6);
        });
        ctx.restore();
      },
    });
    const baseOpts = (unit, abs) => ({
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 18, bottom: 16 } },
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: (c) => (c.tick && c.tick.value === 0 ? ink2 : line), lineWidth: (c) => (c.tick && c.tick.value === 0 ? 1.5 : 1) }, border: { display: false }, ticks: { color: ink2, maxTicksLimit: 7, callback: (v) => `${abs ? Math.abs(v) : v} ${unit}` } },
        x: { grid: { display: false }, border: { display: false }, ticks: { color: ink, font: { size: 13, weight: '600' } } },
      },
    });
    const statTitle = (fn) => (it) => `${Y[it[0].dataIndex].label} · ${LBL[fn(Y[it[0].dataIndex])].toLowerCase()}`;

    // 1) Yearly consumption profile: diverging bars (home use up, export down)
    const yOpts = baseOpts('kWh', true);
    yOpts.scales.x.stacked = true;
    yOpts.scales.y.stacked = true;
    yOpts.plugins.tooltip = {
      callbacks: {
        title: statTitle(sStat),
        label: (c) => ` ${c.dataset.label}: ${fmt(Math.abs(c.parsed.y), 0)} kWh`,
        footer: (it) => {
          const y = Y[it[0].dataIndex];
          return `Home use ${fmt(y.home, 0)} kWh · solar produced ${fmt(y.prod, 0)} kWh`;
        },
      },
    };
    const barW = { categoryPercentage: 0.72, barPercentage: 0.9, maxBarThickness: 56 };
    const yearCfg = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Solar used at home', data: Y.map((y) => Math.round(y.self)), backgroundColor: solarC, stack: 's', ...barW },
          { label: 'Bought from grid', data: Y.map((y) => Math.round(y.imp)), backgroundColor: gridC, borderRadius: { topLeft: 4, topRight: 4 }, stack: 's', ...barW },
          { label: 'Exported', data: Y.map((y) => -Math.round(y.exp)), backgroundColor: expC, borderRadius: { bottomLeft: 4, bottomRight: 4 }, stack: 's', ...barW },
        ],
      },
      options: yOpts,
      plugins: [bandFor(sStat), valueLabels((i) => fmt(Y[i].home, 0), (m) => m[1]), valueLabels((i) => fmt(Y[i].exp, 0), (m) => m[2], true)],
    };

    // 2) Bill per month
    const bestC = css('--s4');
    const curC = css('--s-current');
    $('year-bill-sub').textContent = best ? `Full monthly bill, taxes included and surplus credit already subtracted.${cur && cur.rate.id !== best.rate.id ? ` Year: ${eur(best.annual, 0)} on ${rateName(best.rate)} vs ${eur(cur.annual, 0)} on ${cn}.` : ''}` : '';
    $('year-bill-legend').innerHTML = `${best ? `<span><i style="background:${bestC}"></i>${esc(rateName(best.rate))} (best)</span>` : ''}${cur && best && cur.rate.id !== best.rate.id ? `<span><i style="background:${curC}"></i>${cn} (current)</span>` : ''}<span><i class="band-key"></i>Measured</span><span><i class="band-key bk-part"></i>Partly measured</span>`;
    const billOpts = baseOpts('€');
    billOpts.plugins.tooltip = { callbacks: { title: statTitle(sStat), label: (c) => ` ${c.dataset.label}: ${eur(c.parsed.y)}`, footer: (it) => (best ? `Surplus credit on ${rateName(best.rate)}: −${eur(best.perMonth[it[0].dataIndex].compensation)}` : '') } };
    const billDs = [];
    if (best) billDs.push({ label: rateName(best.rate), data: best.perMonth.map((b) => +b.total.toFixed(2)), backgroundColor: bestC, borderRadius: 4, borderSkipped: 'start', ...barW });
    if (cur && best && cur.rate.id !== best.rate.id) billDs.push({ label: cn, data: cur.perMonth.map((b) => +b.total.toFixed(2)), backgroundColor: curC, borderRadius: 4, borderSkipped: 'start', ...barW });
    const billCfg = { type: 'bar', data: { labels, datasets: billDs }, options: billOpts, plugins: [bandFor(sStat), valueLabels((i) => (best ? Math.round(best.perMonth[i].total) + '€' : null), (m) => m[0])] };

    // 3) Solar production through the year: measured part green, estimated part blue
    const nEstM = count(sStat, 'estimated');
    const nPart = count(sStat, 'partial');
    $('solar-year-sub').textContent = `${count(sStat, 'measured')} month${count(sStat, 'measured') === 1 ? '' : 's'} fully measured${nPart ? `, ${nPart} partly measured (missing days estimated)` : ''}${nEstM ? `, ${nEstM} estimated from the seasonal curve (peak in June)` : ''}. Year: ${fmt(T('prod'), 0)} kWh.`;
    $('solar-year-legend').innerHTML = `<span><i style="background:${mC}"></i>Measured</span>${nPart || nEstM ? `<span><i style="background:${eC}"></i>Estimated</span>` : ''}`;
    const solarOpts = baseOpts('kWh');
    solarOpts.scales.x.stacked = true;
    solarOpts.scales.y.stacked = true;
    solarOpts.plugins.tooltip = { callbacks: { title: statTitle(sStat), label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y, 0)} kWh`, footer: (it) => `Total ${fmt(Y[it[0].dataIndex].prod, 0)} kWh` } };
    const solarYearCfg = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Measured', data: Y.map((y) => Math.round(y.source === 'estimated' ? 0 : y.prodMeas)), backgroundColor: mC, stack: 'p', ...barW },
          { label: 'Estimated', data: Y.map((y) => Math.round(y.source === 'estimated' ? y.prod : y.prod - y.prodMeas)), backgroundColor: eC, borderRadius: { topLeft: 4, topRight: 4 }, stack: 'p', ...barW },
        ],
      },
      options: solarOpts,
      plugins: [valueLabels((i) => fmt(Y[i].prod, 0), (m) => m[1])],
    };

    // 4) Grid purchases by time period
    const pC = [css('--bad'), css('--s4'), css('--s3')];
    $('grid-period-legend').innerHTML = `<span><i style="background:${pC[0]}"></i>P1 punta</span><span><i style="background:${pC[1]}"></i>P2 llano</span><span><i style="background:${pC[2]}"></i>P3 valle</span><span><i class="band-key"></i>Measured</span>${ideFull ? '' : '<span><i class="band-key bk-part"></i>Partly measured</span>'}`;
    const gpOpts = baseOpts('kWh');
    gpOpts.scales.x.stacked = true;
    gpOpts.scales.y.stacked = true;
    gpOpts.plugins.tooltip = { callbacks: { title: statTitle(gStat), label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y, 0)} kWh`, footer: (it) => `Bought from grid ${fmt(Y[it[0].dataIndex].imp, 0)} kWh` } };
    const gridPeriodCfg = {
      type: 'bar',
      data: { labels, datasets: ['P1 punta', 'P2 llano', 'P3 valle'].map((l, i) => ({ label: l, data: Y.map((y) => Math.round(y.kwh[i])), backgroundColor: pC[i], stack: 'g', borderRadius: i === 2 ? { topLeft: 4, topRight: 4 } : 0, ...barW })) },
      options: gpOpts,
      plugins: [bandFor(gStat), valueLabels((i) => fmt(Y[i].imp, 0), (m) => m[2])],
    };
    for (const [key, cfg, el] of [
      ['year', yearCfg, 'chart-year'],
      ['yearBill', billCfg, 'chart-year-bill'],
      ['solarYear', solarYearCfg, 'chart-solar-year'],
      ['gridPeriods', gridPeriodCfg, 'chart-grid-periods'],
    ]) {
      if (charts[key]) charts[key].destroy();
      if (onPage(el)) charts[key] = new Chart($(el), cfg);
    }
  }

  // ---------- What solar saves you ----------
  // Share of weekday self-consumption falling in P1 / P2 (solar hours 8–20h weighted by output:
  // P1 10–14h and 18–20h, P2 8–10h and 14–18h). Weekend and holiday self-consumption is all P3.
  const SELF_WEEKDAY_SPLIT = [0.48, 0.52, 0];
  function valleShare(m) {
    const y = 2027;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let n = 0;
    for (let d = 1; d <= dim; d++) if (EI.isValleDay(y, m, d)) n++;
    return n / dim;
  }
  function noSolarMonths(months) {
    return months.map((mo) => {
      const y = mo.year;
      const vs = valleShare(y.m);
      const selfWd = y.self * (1 - vs);
      const sh = periodShares(y.m);
      // with an hourly provider file, the month's real pre-solar split; otherwise add solar hours back to P1/P2
      const kwh = sh ? sh.map((p) => p * y.home) : [y.kwh[0] + selfWd * SELF_WEEKDAY_SPLIT[0], y.kwh[1] + selfWd * SELF_WEEKDAY_SPLIT[1], y.kwh[2] + y.self * vs];
      return { ...mo, kwh, surplusKWh: 0 };
    });
  }
  function renderSavings(res, months) {
    const sec = $('savings');
    const ok = yearOn() && months.length && months[0].year;
    sec.hidden = !ok;
    if (!ok) return;
    const st = settings();
    const best = res.ranked[0];
    const cur = currentOf(res) || best;
    if (!best) return;
    const base = SolarCalc.annualForRate(cur.rate, noSolarMonths(months), st);
    const noSolar = base.annual;
    const solarCur = cur.annual;
    const solarBest = best.annual;
    const fromSolar = noSolar - solarCur;
    const fromSwitch = solarCur - solarBest;
    const total = noSolar - solarBest;
    const curName = cur.rate.custom ? cur.rate.plan : rateName(cur.rate);
    const bestName = rateName(best.rate);
    const same = cur.rate.id === best.rate.id;
    const cost = +($('sav-cost').value || state.installCost || 0);
    const irpfDed = Math.max(0, +($('irpf-ded').value || state.irpfDed || 0)); // entered by you
    const ibiDed = Math.max(0, +($('ibi-ded').value || state.ibiDed || 0)); // total over the years it applies
    const netCost = Math.max(0, cost - irpfDed - ibiDed);
    // 25-year timeline: savings shrink with panel output; IRPF back in year 1, IBI discount in years 1-4
    const degr = Math.min(5, Math.max(0, +($('lt-degr').value || 0))) / 100;
    const years = [];
    let bal = -cost;
    let paybackT = null;
    for (let yr = 1; yr <= 25; yr++) {
      const sav = total * Math.pow(1 - degr, yr - 1);
      const ded = (yr === 1 ? irpfDed : 0) + (yr <= 4 ? ibiDed / 4 : 0);
      const prev = bal;
      bal += sav + ded;
      if (paybackT == null && cost > 0 && prev < 0 && bal >= 0) paybackT = yr - 1 + -prev / (sav + ded);
      years.push({ yr, sav, ded, bal });
    }
    const totalSav = years.reduce((a, y) => a + y.sav, 0);
    const payback = cost > 0 && total > 0 ? paybackT : null;
    const paybackGross = cost > 0 && total > 0 ? cost / total : null;
    $('pay-flow').innerHTML = cost
      ? `<div><span class="eyebrow">Installation cost</span><span class="big">${eur(cost, 0)}</span><span class="step">what you paid</span></div>
         <div><span class="eyebrow">Tax deductions</span><span class="big">−${eur(irpfDed + ibiDed, 0)}</span><span class="step">IRPF ${eur(irpfDed, 0)} · IBI ${eur(ibiDed, 0)}</span></div>
         <div><span class="eyebrow">Net cost</span><span class="big">${eur(netCost, 0)}</span><span class="step">after deductions</span></div>
         <div class="total"><span class="eyebrow">Payback</span><span class="big">${payback != null ? fmt(payback, 1) + ' years' : '–'}</span><span class="step">at ${eur(total, 0)} saved per year${paybackGross ? ` · ${fmt(paybackGross, 1)} years without deductions` : ''}</span></div>`
      : '<div style="grid-column:1/-1"><span class="step">Enter the installation cost to see the net cost and payback.</span></div>';
    renderLifetime(years, { cost, netCost, totalSav, payback, degr, total });
    const Y = months.map((m) => m.year);
    const homeYear = Y.reduce((a, y) => a + y.home, 0);
    const selfYear = Y.reduce((a, y) => a + y.self, 0);
    const expYear = Y.reduce((a, y) => a + y.exp, 0);
    $('sav-sub').textContent = `Same year of home use (${fmt(homeYear, 0)} kWh) priced three ways. Solar avoids buying ${fmt(selfYear, 0)} kWh and exports ${fmt(expYear, 0)} kWh.`;
    $('sav-flow').innerHTML = `
      <div><span class="eyebrow">Without solar</span><span class="big">${eur(noSolar, 0)}</span><span class="step">${esc(curName)}, all ${fmt(homeYear, 0)} kWh bought from the grid</span></div>
      <div><span class="eyebrow">With solar, current rate</span><span class="big">${eur(solarCur, 0)}</span><span class="step">${esc(curName)} · solar saves <b>${eur(fromSolar, 0)}</b></span></div>
      <div><span class="eyebrow">With solar, best rate</span><span class="big">${eur(solarBest, 0)}</span><span class="step">${esc(bestName)} · switching saves <b>${same ? 'nothing more' : eur(fromSwitch, 0)}</b></span></div>
      <div class="total"><span class="eyebrow">Estimated annual savings</span><span class="big">${eur(total, 0)}</span><span class="step">${fmt(noSolar ? (total / noSolar) * 100 : 0, 0)}% lower than without solar · ${eur(total / 12, 0)} a month${payback ? ` · pays back in about <b>${fmt(payback, 1)} years</b> after deductions` : ''}</span></div>`;
    // table
    const rows = Y.map((y, i) => {
      const a = base.perMonth[i].total;
      const b = cur.perMonth[i].total;
      const c = best.perMonth[i].total;
      return { y, a, b, c };
    });
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    $('sav-table').innerHTML = `<thead><tr><th>Month</th><th>Without solar</th><th>Solar · current</th><th>Solar · best</th><th>Saved</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.y.source === 'measured' ? '' : 'est-row'}"><td><b>${r.y.short}</b> <span class="src ${r.y.source === 'measured' ? 'meas' : 'est'}">${r.y.source === 'measured' ? 'M' : 'E'}</span></td><td class="num">${eur(r.a)}</td><td class="num">${eur(r.b)}</td><td class="num">${eur(r.c)}</td><td class="num neg">${eur(r.a - r.c)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Year</td><td class="num">${eur(noSolar, 0)}</td><td class="num">${eur(solarCur, 0)}</td><td class="num">${eur(solarBest, 0)}</td><td class="num neg">${eur(total, 0)}</td></tr></tfoot>`;
    $('sav-method').textContent = `“Without solar” prices the same home use with no panels on ${curName}: everything solar covered directly is bought from the grid instead (on weekdays ${Math.round(SELF_WEEKDAY_SPLIT[0] * 100)}% in P1 punta and ${Math.round(SELF_WEEKDAY_SPLIT[1] * 100)}% in P2 llano, following solar hours; on weekends and holidays in P3 valle), and nothing is exported. Yearly totals include any virtual-battery credit. M = measured month, E = estimated.`;

    if (typeof Chart === 'undefined') return;
    const line = css('--line');
    const cNo = css('--s-current');
    const cCur = css('--s2');
    const cBest = css('--good');
    $('sav-legend').innerHTML = `<span><i style="background:${cNo}"></i>Without solar</span><span><i style="background:${cCur}"></i>Solar · ${esc(curName)}</span>${same ? '' : `<span><i style="background:${cBest}"></i>Solar · ${esc(bestName)}</span>`}`;
    const ds = [
      { label: 'Without solar', data: rows.map((r) => +r.a.toFixed(2)), backgroundColor: cNo },
      { label: `Solar · ${curName}`, data: rows.map((r) => +r.b.toFixed(2)), backgroundColor: cCur },
    ];
    if (!same) ds.push({ label: `Solar · ${bestName}`, data: rows.map((r) => +r.c.toFixed(2)), backgroundColor: cBest });
    const cfg = {
      type: 'bar',
      data: { labels: Y.map((y) => y.short), datasets: ds.map((d) => ({ ...d, borderRadius: 3, borderSkipped: 'start', borderColor: css('--surface'), borderWidth: { left: 1, right: 1 } })) },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${eur(c.parsed.y)}` } } },
        scales: { y: { beginAtZero: true, grid: { color: line }, border: { display: false }, ticks: { callback: (v) => `${v} €` } }, x: { grid: { display: false }, border: { color: line } } },
      },
    };
    if (charts.savings) charts.savings.destroy();
    charts.savings = new Chart($('chart-savings'), cfg);
  }
  $('sav-cost').addEventListener('input', (e) => {
    state.installCost = Math.max(0, +e.target.value || 0);
    save();
    if (lastResult) renderSavings(lastResult, lastResult.months);
  });

  // internal rate of return of: −cost today, then each year's savings + deductions
  function irr(cost, flows) {
    const npv = (r) => flows.reduce((a, f, i) => a + f / Math.pow(1 + r, i + 1), -cost);
    let lo = -0.99;
    let hi = 10;
    if (npv(lo) < 0 || npv(hi) > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function renderLifetime(years, k) {
    const has = k.cost > 0 && k.total > 0;
    const r = has ? irr(k.cost, years.map((y) => y.sav + y.ded)) : null;
    const left = has ? years[24].bal : 0;
    $('lt-flow').innerHTML = has
      ? `<div><span class="eyebrow">Saved over 25 years</span><span class="big">${eur(k.totalSav, 0)}</span><span class="step">on your electricity bills</span></div>
         <div><span class="eyebrow">Left after paying for the panels</span><span class="big">${eur(left, 0)}</span><span class="step">savings + deductions − installation cost</span></div>
         <div class="total"><span class="eyebrow">Equivalent annual return</span><span class="big">${r != null ? fmt(r * 100, 1) + ' %' : '–'}</span><span class="step">per year on the ${eur(k.cost, 0)} you invested</span></div>`
      : '';
    $('lt-sub').innerHTML = has
      ? `The balance turns positive after <b>${k.payback != null ? fmt(k.payback, 1) + ' years' : 'more than 25 years'}</b>${r != null ? `, a return equivalent to <b>${fmt(r * 100, 1)}% a year</b> on the installation cost` : ''}. Assumes ${fmt(k.degr * 100, 1)}% less production each year and today's electricity prices.`
      : 'Enter the installation cost to see when the panels pay for themselves and what they save over 25 years.';
    if (typeof Chart === 'undefined') return;
    if (charts.lifetime) charts.lifetime.destroy();
    $('lt-legend').innerHTML = '';
    if (!has || !onPage('chart-lifetime')) return;
    const savC = css('--s4');
    const dedC = css('--accent');
    const balC = css('--good');
    const badC = css('--bad');
    const line = css('--line');
    const ink2 = css('--ink-2');
    $('lt-legend').innerHTML = `<span><i style="background:${savC}"></i>Yearly savings</span><span><i style="background:${dedC}"></i>Tax deductions</span><span><i style="background:${balC};height:3px;vertical-align:3px"></i>Running balance</span>`;
    const pbPlugin = {
      id: 'paybackMark',
      afterDatasetsDraw(chart) {
        if (k.payback == null) return;
        const { ctx, chartArea: a, scales } = chart;
        const x = scales.x.getPixelForValue(k.payback); // linear x axis in years
        ctx.save();
        ctx.strokeStyle = balC;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, a.top);
        ctx.lineTo(x, a.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = balC;
        ctx.font = `600 11px ${css('--f-body')}`;
        ctx.textAlign = x > a.right - 90 ? 'right' : 'left';
        ctx.fillText(`Paid back · ${fmt(k.payback, 1)} yrs`, x + (ctx.textAlign === 'left' ? 6 : -6), a.top + 12);
        ctx.restore();
      },
    };
    const pts = [{ x: 0, y: -k.cost }].concat(years.map((y) => ({ x: y.yr, y: Math.round(y.bal) })));
    charts.lifetime = new Chart($('chart-lifetime'), {
      data: {
        datasets: [
          { type: 'bar', label: 'Yearly savings', data: years.map((y) => ({ x: y.yr, y: Math.round(y.sav) })), backgroundColor: savC, stack: 'y', borderRadius: 3, barPercentage: 0.9, categoryPercentage: 0.9, order: 2 },
          { type: 'bar', label: 'Tax deductions', data: years.map((y) => ({ x: y.yr, y: Math.round(y.ded) })), backgroundColor: dedC, stack: 'y', borderRadius: 3, barPercentage: 0.9, categoryPercentage: 0.9, order: 2 },
          { type: 'line', label: 'Running balance', data: pts, borderColor: balC, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, order: 1, segment: { borderColor: (c) => (c.p1.parsed.y < 0 ? badC : balC) } },
        ],
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (it) => it.parsed.y !== 0 || it.dataset.type === 'line',
            callbacks: { title: (it) => `Year ${it[0].parsed.x}`, label: (c) => ` ${c.dataset.label}: ${eur(c.parsed.y, 0)}` },
          },
        },
        scales: {
          x: { type: 'linear', min: 0, max: 25.6, offset: false, grid: { display: false }, border: { color: line }, afterBuildTicks: (ax) => { ax.ticks = [0, 5, 10, 15, 20, 25].map((v) => ({ value: v })); }, ticks: { color: css('--ink'), callback: (v) => (v === 0 ? 'Today' : `Year ${v}`) } },
          y: { grid: { color: (c) => (c.tick && c.tick.value === 0 ? ink2 : line), lineWidth: (c) => (c.tick && c.tick.value === 0 ? 1.5 : 1) }, border: { display: false }, ticks: { maxTicksLimit: 7, callback: (v) => `${(v / 1000).toLocaleString('es-ES')}k €` } },
        },
      },
      plugins: [pbPlugin],
    });
  }
  $('lt-degr').addEventListener('input', (e) => {
    state.ltDegr = e.target.value;
    save();
    if (lastResult) renderSavings(lastResult, lastResult.months);
  });
  $('irpf-ded').addEventListener('input', (e) => {
    state.irpfDed = Math.max(0, +e.target.value || 0);
    save();
    if (lastResult) renderSavings(lastResult, lastResult.months);
  });
  $('ibi-ded').addEventListener('input', (e) => {
    state.ibiDed = Math.max(0, +e.target.value || 0);
    save();
    if (lastResult) renderSavings(lastResult, lastResult.months);
  });

  $('ym-year').addEventListener('click', () => {
    state.yearMode = true;
    update();
  });
  $('ym-cards').addEventListener('click', () => {
    state.yearMode = false;
    renderImport();
    update();
  });
  [['yr-prod', 'prod'], ['yr-mindays', 'minDays'], ['yr-winter-ratio', 'winterRatio']].forEach(([id, k]) =>
    $(id).addEventListener('change', (e) => {
      const v = Math.max(k === 'minDays' ? 1 : 0, +e.target.value || 0);
      yrOpts()[k] = k === 'winterRatio' ? v / 100 : v;
      update();
    }),
  );

  const rateName = (r) => (r.custom ? r.plan : `${r.provider} · ${r.plan}`);
  const currentOf = (res) => res.ranked.find((x) => x.rate.current) || null;

  function renderVerdict(res, months) {
    const best = res.ranked[0];
    const cur = currentOf(res);
    if (!best) {
      $('verdict').innerHTML = '<div><p>No rate could be priced with these inputs.</p></div>';
      return;
    }
    const saving = cur ? cur.annual - best.annual : null;
    const second = res.ranked[1];
    const bestIsCurrent = cur && cur.rate.id === best.rate.id;
    $('verdict').innerHTML = `
      <div>
        <span class="eyebrow">Cheapest for your profile</span>
        <span class="best-name">${esc(rateName(best.rate))}</span>
        <span class="small muted">${esc(best.rate.accessTariff)} · surplus ${fmt(best.rate.surplus.price, 3)} €/kWh${best.rate.virtualBattery ? ' · virtual battery' : ''}${best.rate.url ? ` · <a href="${esc(best.rate.url)}" target="_blank" rel="noopener nofollow">offer page</a>` : ''}</span>
      </div>
      <div><span class="eyebrow">Estimated yearly cost</span><span class="big num">${eur(best.annual, 0)}</span><span class="small muted">${fmt(res.totalWeight, 1)} months · avg ${eur(best.annual / (res.totalWeight || 1))} / month</span></div>
      <div><span class="eyebrow">Saving vs current</span><span class="big num ${saving > 0 ? 'neg' : ''}">${cur ? (bestIsCurrent ? 'Already best' : eur(saving, 0)) : '–'}</span><span class="small muted">${cur ? `${esc(cur.rate.custom ? cur.rate.plan : rateName(cur.rate))}: ${eur(cur.annual, 0)}` : 'Choose your current rate in “Your data” at the top'}</span></div>
      <div class="formula"><span class="eyebrow">How the yearly figure is built (${esc(rateName(best.rate))})</span><span class="num small">${yearFormula(best, months)}</span></div>
      <div><span class="eyebrow">Runner-up</span><span class="best-name" style="font-size:1rem">${second ? esc(rateName(second.rate)) : '–'}</span><span class="small muted num">${second ? `+${eur(second.annual - best.annual, 0)} per year` : ''}</span></div>`;
  }

  function yearFormula(x, months) {
    if (months.length > 3 && months[0].year) {
      const meas = months.filter((m) => m.source === 'measured').length;
      const part = months.filter((m) => m.source === 'partial').length;
      const credit = x.bvCreditUsed > 0 ? ` − ${eur(x.bvCreditUsed)} virtual-battery credit` : '';
      const sold = x.perMonth.reduce((a, b) => a + b.compensation, 0);
      return `Sum of 12 monthly bills (${meas} measured, ${part} partly measured, ${12 - meas - part} estimated), with ${eur(sold)} of surplus credit already subtracted${credit ? ` ${eur(x.gross)}${credit}` : ''} = <b>${eur(x.annual)}</b>. Each month is listed under “Month-by-month details” below.`;
    }
    const parts = x.perMonth.map((b, i) => {
      const m = months[i];
      const perMonth = (b.total * SolarCalc.AVG_MONTH_DAYS) / (m.days || SolarCalc.AVG_MONTH_DAYS);
      return `${esc(m.name)} ${eur(b.total)} for ${m.days} days → ${eur(perMonth)}/month × ${fmt(m.weight, 1)}`;
    });
    const credit = x.bvCreditUsed > 0 ? ` − ${eur(x.bvCreditUsed)} virtual-battery credit` : '';
    return `${parts.join(' + ')}${credit} = <b>${eur(x.annual)}</b>`;
  }

  function renderBreakdownSelect(months) {
    const sel = $('breakdown-month');
    const prev = sel.value;
    sel.innerHTML = months.map((m, i) => `<option value="${i}">${esc(m.name)}</option>`).join('');
    if (prev && +prev < months.length) sel.value = prev;
  }
  $('breakdown-month').addEventListener('change', () => renderTable());
  $('rank-panel').addEventListener('toggle', () => renderTable());

  function chips(r) {
    const c = [];
    c.push(`<span class="chip">${r.accessTariff === '2.0A' ? '1 price' : '3 periods'}</span>`);
    if (r.virtualBattery) c.push(`<span class="chip bv" title="${esc(r.virtualBattery.text)}">BV</span>`);
    if (r.fvOnly) c.push('<span class="chip fv" title="Only for solar installations">FV*</span>');
    if (r.monthlyFee) c.push(`<span class="chip" title="Monthly fee">${fmt(r.monthlyFee, 2)} €/mo</span>`);
    if (r.cae) c.push(`<span class="chip">${esc(r.cae)}</span>`);
    if (r.custom) c.push(`<span class="chip mine">${r.current ? 'current' : 'mine'}</span>`);
    return c.join('');
  }

  function renderTable() {
    if (!lastResult) return;
    const res = lastResult;
    const mi = +$('breakdown-month').value || 0;
    const cur = currentOf(res);
    const head = `<tr><th>#</th><th>Rate</th><th>Energy €/kWh<br>P1 / P2 / P3</th><th>Power €/kW·day<br>P1 / P2</th><th>Surplus<br>€/kWh</th>
      <th>Power</th><th>Energy</th><th>Surplus credit</th><th>Surplus lost</th><th>Taxes + extras</th><th>Bill</th><th>To battery</th><th>Year</th><th>vs current</th></tr>`;
    const rows = res.ranked
      .map((x, i) => {
        const r = x.rate;
        const b = x.perMonth[mi];
        const extras = b.taxes + b.socialBond + b.meter + b.monthlyFee;
        const diff = cur ? x.annual - cur.annual : null;
        const e = r.energy;
        const energyTxt = r.accessTariff === '2.0A' ? fmt(e.e1, 4) : `${fmt(e.e1, 3)} / ${fmt(e.e2, 3)} / ${fmt(e.e3, 3)}`;
        return `<tr class="${i === 0 ? 'best' : ''} ${r.current ? 'current' : ''}">
          <td class="num">${i + 1}</td>
          <td class="rate"><b>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener nofollow">${esc(rateName(r))}</a>` : esc(rateName(r))}</b> ${chips(r)}</td>
          <td class="num">${energyTxt}</td>
          <td class="num">${fmt(r.power.p1, 4)} / ${fmt(r.power.p2, 4)}</td>
          <td class="num">${fmt(r.surplus.price, 3)}</td>
          <td class="num">${eur(b.power)}</td>
          <td class="num">${eur(b.energy)}</td>
          <td class="num neg">${b.compensation > 0 ? '−' + eur(b.compensation) : eur(0)}</td>
          <td class="num ${b.lostSurplus > 0.005 ? 'pos' : ''}">${eur(b.lostSurplus)}</td>
          <td class="num">${eur(extras)}</td>
          <td class="num"><b>${eur(b.total)}</b></td>
          <td class="num">${b.bvCredit > 0 ? eur(b.bvCredit) : '–'}</td>
          <td class="num"><b>${eur(x.annual, 0)}</b></td>
          <td class="num ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}">${diff == null ? '–' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + eur(Math.abs(diff), 0)}</td>
        </tr>`;
      })
      .join('');
    $('rank-table').innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
    const b0 = res.ranked[0];
    $('rank-summary').textContent = b0 ? `${res.ranked.length} rates compared · cheapest ${rateName(b0.rate)} at ${eur(b0.annual, 0)}/year · tap to ${$('rank-panel').open ? 'collapse' : 'expand'}` : '';
  }


  function renderCharts(res, months) {
    if (typeof Chart === 'undefined') return;
    const ink2 = css('--ink-2');
    const line = css('--line');
    const font = { family: css('--f-body'), size: 12 };
    Chart.defaults.color = ink2;
    Chart.defaults.font = font;
    const cur = currentOf(res);
    const top = res.ranked.slice();
    if (onPage('chart-annual')) $('chart-annual').parentElement.style.height = `${Math.max(320, top.length * 28 + 60)}px`;
    const colors = top.map((x, i) => (x.rate.current ? css('--s-current') : i === 0 ? css('--good') : css('--s1')));
    const tooltip = {
      callbacks: {
        label: (ctx) => ` ${eur(ctx.parsed.x ?? ctx.parsed.y, 0)}`,
      },
    };
    const annualCfg = {
      type: 'bar',
      data: {
        labels: top.map((x) => rateName(x.rate)),
        datasets: [{ data: top.map((x) => Math.round(x.annual)), backgroundColor: colors, borderRadius: 4, borderSkipped: 'start', barPercentage: 0.75, categoryPercentage: 0.9 }],
      },
      options: {
        indexAxis: 'y',
        interaction: { mode: 'index', intersect: false, axis: 'y' },
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip },
        scales: {
          x: { beginAtZero: true, grid: { color: line }, border: { display: false }, ticks: { callback: (v) => v + ' €' } },
          y: { grid: { display: false }, border: { color: line }, ticks: { autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 34 ? l.slice(0, 33) + '…' : l; } } },
        },
      },
    };
    const series = ['--s1', '--s2', '--s3', '--s4', '--s5'].map(css);
    let mtop = res.ranked.slice(0, 5);
    if (cur && !mtop.includes(cur)) mtop = mtop.concat([cur]);
    const mcolors = mtop.map((x, i) => (x.rate.current ? css('--s-current') : series[i % 5]));
    $('legend2').innerHTML = mtop.map((x, i) => `<span><i style="background:${mcolors[i]}"></i>${esc(rateName(x.rate))}</span>`).join('');
    const monthCfg = {
      type: 'bar',
      data: {
        labels: months.map((m) => m.name),
        datasets: mtop.map((x, i) => ({
          label: rateName(x.rate),
          data: x.perMonth.map((b) => +b.total.toFixed(2)),
          backgroundColor: mcolors[i],
          borderRadius: 4,
          borderSkipped: 'start',
          borderColor: css('--surface'),
          borderWidth: { left: 1, right: 1 },
        })),
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${eur(ctx.parsed.y)}` } } },
        scales: {
          y: { beginAtZero: true, grid: { color: line }, border: { display: false }, ticks: { callback: (v) => v + ' €' } },
          x: { grid: { display: false }, border: { color: line } },
        },
      },
    };
    for (const [key, cfg, el] of [
      ['annual', annualCfg, 'chart-annual'],
      ['months', monthCfg, 'chart-months'],
    ]) {
      if (charts[key]) charts[key].destroy();
      if (onPage(el)) charts[key] = new Chart($(el), cfg);
    }
  }

  // re-colour charts when the theme flips
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => update());
  new MutationObserver(() => update()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  $('btn-example').addEventListener('click', () => {
    state.months = EXAMPLE_MONTHS();
    renderMonths();
    update();
  });
  $('btn-reset').addEventListener('click', () => {
    state = BILL_STATE();
    renderMonths();
    renderSettings();
    renderCustom();
    update();
  });

  function renderSource() {
    const d = DATA.fetchedAt ? new Date(DATA.fetchedAt) : null;
    const n = DATA.rates.length;
    const c = DATA.rates.filter((r) => r.comparable).length;
    $('source').innerHTML = `<span class="dot" aria-hidden="true"></span> ${n} FV rates (${c} priceable) from <a href="${esc(DATA.source || 'https://www.simuladorfacturaluz.es/tarifas-de-luz/')}" target="_blank" rel="noopener">simuladorfacturaluz.es</a>${d ? ` · prices checked ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`;
  }


  // ---------- Enphase import ----------
  const EI = window.EnphaseImport;
  const DEFAULT_SPLIT = [22, 17, 61];
  function impRows() {
    return (state.imp?.rows || []).map((a) => ({ y: a[0], m: a[1], d: a[2], hour: a[3], prod: a[4], cons: a[5], exp: a[6], imp: a[7] }));
  }
  function impSummaries() {
    const rows = impRows();
    const split = state.imp.split;
    const months = EI.monthlyTotals(rows, split);
    const pj = state.imp.proj;
    const proj = EI.projectMonth(rows, pj.source, +pj.target, { prodFactor: pj.prodFactor ?? undefined, consFactor: pj.consFactor }, split);
    return { months, proj };
  }
  function seasonOf(m) {
    return [12, 1, 2].includes(m) ? 'winter' : [6, 7, 8].includes(m) ? 'summer' : 'mid';
  }
  function renderImport() {
    const has = !!state.imp;
    $('import-body').hidden = !has || yearOn();
    $('split-box').hidden = !has || !!(state.imp && state.imp.interval);
    $('solar-data').hidden = !has;
    $('solar-empty').hidden = has;
    if (!has) return;
    renderSolarData();
    const im = state.imp;
    ['ws0', 'ws1', 'ws2'].forEach((id, i) => ($(id).value = im.split[i]));
    $('ws0').closest('.settings-grid').hidden = !!im.interval;
    $('split-note').hidden = !!im.interval;
    const { months, proj } = impSummaries();
    const measured = months.map((x) => x.key);
    // projection selects
    $('proj-source').innerHTML = months.map((x) => `<option value="${x.key}" ${x.key === im.proj.source ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    const taken = new Set(months.map((x) => x.month));
    $('proj-target').innerHTML = EI.MONTHS.map((n, i) => (taken.has(i + 1) ? '' : `<option value="${i + 1}" ${+im.proj.target === i + 1 ? 'selected' : ''}>${n}</option>`)).join('');
    const autoF = proj ? proj.prodFactor : 1;
    $('proj-prod').value = im.proj.prodFactor ?? +autoF.toFixed(2);
    $('proj-cons').value = im.proj.consFactor;
    const row = (x, isProj) => {
      const key = isProj ? 'proj' : x.key;
      const sel = im.sel.includes(key);
      return `<tr class="${isProj ? 'proj' : ''}">
        <td><input type="checkbox" id="imp-${key}" data-imp="${key}" ${sel ? 'checked' : ''} aria-label="Use ${esc(x.label)}"></td>
        <td style="text-align:left"><b>${esc(x.label)}</b><br><span class="small muted">${esc(x.range)} · ${x.days} days${isProj || x.full ? '' : ' (partial)'}</span></td>
        <td class="num">${fmt(x.prod, 0)}</td><td class="num">${fmt(x.cons, 0)}</td><td class="num">${fmt(x.self, 0)}</td>
        <td class="num">${fmt(x.exp, 0)}</td><td class="num">${fmt(x.imp, 0)}</td>
        <td class="num">${x.kwh.map((k) => fmt(k, 0)).join(' / ')}</td>
        <td class="num">${x.prod ? Math.round((x.self / x.prod) * 100) : 0}%</td></tr>`;
    };
    $('import-table').innerHTML = `<thead><tr><th>Use</th><th>Month</th><th>Produced</th><th>Home use</th><th>Self-consumed</th><th>Exported</th><th>Imported</th><th>Import P1 / P2 / P3</th><th>Used directly</th></tr></thead>
      <tbody>${months.map((x) => row(x, false)).join('')}${proj ? row(proj, true) : ''}</tbody>`;
    $('use-note').textContent = `kWh. ${im.sel.length} of max 3 ticked.`;
    return measured;
  }

  async function loadFile(file) {
    const st = $('import-status');
    try {
      const text = await file.text();
      const p = EI.parseEnphaseCsv(text);
      const rows = p.rows.map((r) => [r.y, r.m, r.d, r.hour, +(r.prod ?? 0).toFixed(3), +(r.cons ?? 0).toFixed(3), +r.exp.toFixed(3), +r.imp.toFixed(3)]);
      const months = EI.monthlyTotals(p.rows, DEFAULT_SPLIT);
      // default picks: one measured month per season, plus a winter estimate if no winter data
      const bySeason = {};
      for (const x of months) {
        const s = seasonOf(x.month);
        if (!bySeason[s] || x.days > bySeason[s].days) bySeason[s] = x;
      }
      const sel = Object.values(bySeason).map((x) => x.key).slice(0, 3);
      const latest = months[months.length - 1];
      const proj = { target: 1, source: latest.key, prodFactor: null, consFactor: 1 };
      if (months.some((x) => x.month === 1)) proj.target = [12, 2, 11].find((m) => !months.some((x) => x.month === m)) || 1;
      if (!bySeason.winter && sel.length < 3) sel.push('proj');
      state.imp = { name: file.name, rows, split: p.interval ? [0, 0, 0] : DEFAULT_SPLIT.slice(), interval: p.interval, sel, proj };
      st.textContent = p.warnings.length ? p.warnings.join(' ') : '';
      $('split-note').hidden = p.interval;
      state.yearMode = true;
      renderImport();
      update();
    } catch (e) {
      st.textContent = `Couldn't read that file: ${e.message}`;
    }
  }
  $('csv-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) loadFile(f);
  });
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  ['ws0', 'ws1', 'ws2'].forEach((id, i) =>
    $(id).addEventListener('input', (e) => {
      state.imp.split[i] = Math.max(0, +e.target.value || 0);
      renderImport();
      update();
    }),
  );
  $('proj-target').addEventListener('change', (e) => {
    state.imp.proj.target = +e.target.value;
    state.imp.proj.prodFactor = null;
    renderImport();
    save();
  });
  $('proj-source').addEventListener('change', (e) => {
    state.imp.proj.source = e.target.value;
    state.imp.proj.prodFactor = null;
    renderImport();
    save();
  });
  $('proj-prod').addEventListener('change', (e) => {
    state.imp.proj.prodFactor = Math.max(0, +e.target.value || 0);
    renderImport();
    save();
  });
  $('proj-cons').addEventListener('change', (e) => {
    state.imp.proj.consFactor = Math.max(0, +e.target.value || 0);
    renderImport();
    save();
  });
  $('import-table').addEventListener('change', (e) => {
    const k = e.target.dataset.imp;
    if (!k) return;
    const sel = state.imp.sel;
    if (e.target.checked) {
      if (sel.length >= 3) {
        e.target.checked = false;
        $('use-note').textContent = 'Three months is the maximum. Untick one first.';
        return;
      }
      sel.push(k);
    } else sel.splice(sel.indexOf(k), 1);
    renderImport();
    save();
  });
  $('btn-use-import').addEventListener('click', () => {
    const { months, proj } = impSummaries();
    const picked = state.imp.sel
      .map((k) => (k === 'proj' ? proj : months.find((x) => x.key === k)))
      .filter(Boolean)
      .sort((a, b) => ({ summer: 0, mid: 1, winter: 2 })[seasonOf(a.month)] - ({ summer: 0, mid: 1, winter: 2 })[seasonOf(b.month)]);
    if (!picked.length) {
      $('use-note').textContent = 'Tick at least one month.';
      return;
    }
    const w = +(12 / picked.length).toFixed(1);
    state.months = [0, 1, 2].map((i) => {
      const x = picked[i];
      if (!x) return { on: false, name: `Month ${i + 1}`, days: 31, weight: w, mode: 'periods', kwh: [0, 0, 0], total: 0, split: [12, 9, 79], surplus: 0 };
      const kwh = x.kwh.map((k) => Math.round(k));
      const tot = kwh.reduce((a, b) => a + b, 0) || 1;
      return {
        on: true,
        name: x.projected ? `${x.label}` : `${x.label} · Enphase`,
        days: x.days,
        weight: w,
        mode: 'periods',
        kwh,
        total: tot,
        split: kwh.map((k) => Math.round((k / tot) * 100)),
        surplus: Math.round(x.exp),
        home: Math.round(x.cons),
        production: Math.round(x.prod),
        src: `${x.projected ? 'Estimated' : 'Measured'}: produced ${fmt(x.prod, 0)} kWh, self-consumed ${fmt(x.self, 0)} kWh, ${x.days} days${x.full || x.projected ? '' : ' (scaled to a full month)'}`,
      };
    });
    renderMonths();
    update();
    $('use-note').textContent = `Done. ${picked.length} month${picked.length > 1 ? 's' : ''} loaded below, ${w} months of the year each. Adjust the weights if you like.`;
    $('months').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });


  // ---------- Your solar data (summary of the imported Enphase file) ----------
  let sdMode = 'perday';
  function dailyRows() {
    // collapse interval rows into days
    const by = new Map();
    for (const r of impRows()) {
      const k = `${r.y}-${String(r.m).padStart(2, '0')}-${String(r.d).padStart(2, '0')}`;
      const a = by.get(k) || { key: k, y: r.y, m: r.m, d: r.d, prod: 0, cons: 0, exp: 0, imp: 0 };
      a.prod += r.prod || 0;
      a.cons += r.cons || 0;
      a.exp += r.exp || 0;
      a.imp += r.imp || 0;
      by.set(k, a);
    }
    return [...by.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((d) => ({ ...d, self: Math.max(0, d.prod - d.exp) }));
  }
  const SD_SERIES = [
    ['prod', 'Production', '--s4'],
    ['cons', 'Home use', '--s1'],
    ['self', 'Self-consumed', '--s5'],
    ['exp', 'Exported', '--s3'],
    ['imp', 'Imported', '--s2'],
  ];
  function renderSolarData() {
    const days = dailyRows();
    if (!days.length) return;
    const n = days.length;
    const sum = (k, list = days) => list.reduce((a, d) => a + d[k], 0);
    const T = Object.fromEntries(SD_SERIES.map(([k]) => [k, sum(k)]));
    const first = days[0];
    const last = days[n - 1];
    const MON = EI.MON;
    const AVG = SolarCalc.AVG_MONTH_DAYS;
    $('solar-sub').textContent = `Measured by Enphase · ${first.d} ${MON[first.m - 1]} ${first.y} – ${last.d} ${MON[last.m - 1]} ${last.y} · ${n} days`;
    const tile = (k, label, color) => `<div class="kpi"><span class="eyebrow k"><i style="background:${css(color)}"></i>${label}</span>
      <span class="v">${fmt(T[k] / n, 1)} <small>kWh/day</small></span>
      <span class="small muted" style="font-variant-numeric:tabular-nums">${fmt((T[k] / n) * AVG, 0)} kWh/month avg · ${fmt(T[k], 0)} total</span></div>`;
    const selfUse = T.prod ? (T.self / T.prod) * 100 : 0;
    const selfSuff = T.cons ? (T.self / T.cons) * 100 : 0;
    $('solar-kpis').innerHTML =
      tile('prod', 'Production', '--s4') + tile('self', 'Used at home', '--s5') + tile('exp', 'Exported', '--s3') +
      `<div class="kpi"><span class="eyebrow">Solar used at home</span><span class="v">${fmt(selfUse, 0)}<small> % of production</small></span><span class="small muted">the rest is exported to the grid</span></div>`;
    $('cons-kpis').innerHTML =
      tile('cons', 'Home use', '--s1') + tile('imp', 'Bought from grid', '--grid-color') +
      `<div class="kpi"><span class="eyebrow">Self-sufficiency</span><span class="v">${fmt(selfSuff, 0)}<small> % of home use</small></span><span class="small muted">covered directly by your panels</span></div>`;

    // monthly aggregates
    const months = [];
    for (const d of days) {
      const k = `${d.y}-${d.m}`;
      let mo = months.find((x) => x.k === k);
      if (!mo) months.push((mo = { k, y: d.y, m: d.m, list: [] }));
      mo.list.push(d);
    }
    for (const mo of months) {
      mo.days = mo.list.length;
      mo.dim = new Date(Date.UTC(mo.y, mo.m, 0)).getUTCDate();
      for (const [k] of SD_SERIES) mo[k] = sum(k, mo.list);
      mo.label = `${MON[mo.m - 1]} ${mo.y}`;
    }
    const perDay = sdMode === 'perday';
    $('sd-perday').setAttribute('aria-pressed', perDay);
    $('sd-total').setAttribute('aria-pressed', !perDay);
    $('sd-chart1-title').textContent = perDay ? 'Average per day, by month' : 'Total per month';
    $('sd-chart1-sub').textContent = perDay ? 'kWh per day, so partial months compare fairly with full ones.' : 'kWh measured in each month. Partial months show their number of days.';

    if (typeof Chart === 'undefined') return;
    const line = css('--line');
    Chart.defaults.color = css('--ink-2');
    Chart.defaults.font = { family: css('--f-body'), size: 12 };
    const barSeries = [
      ['prod', 'Production', '--s4'],
      ['self', 'Used at home', '--s5'],
      ['exp', 'Exported', '--s3'],
    ];
    $('sd-legend1').innerHTML = barSeries.map(([, l, c]) => `<span><i style="background:${css(c)}"></i>${l}</span>`).join('');
    const kwhTick = (v) => `${v} kWh`;
    const baseScales = { y: { beginAtZero: true, grid: { color: line }, border: { display: false }, ticks: { maxTicksLimit: 6, callback: kwhTick } }, x: { grid: { display: false }, border: { color: line }, ticks: { maxRotation: 0, autoSkipPadding: 12 } } };
    const monthCfg = {
      type: 'bar',
      data: {
        labels: months.map((mo) => (mo.days < mo.dim && !perDay ? `${mo.label} (${mo.days} d)` : mo.label)),
        datasets: barSeries.map(([k, l, c]) => ({ label: l, data: months.map((mo) => +(perDay ? mo[k] / mo.days : mo[k]).toFixed(1)), backgroundColor: css(c), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 46 })),
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y, 1)} kWh${perDay ? '/day' : ''}` } } },
        scales: baseScales,
      },
    };
    const lineCfg = (series) => ({
      type: 'line',
      data: {
        labels: days.map((d) => `${d.d} ${MON[d.m - 1]}`),
        datasets: series.map(([k, l, c, dash]) => ({ label: l, data: days.map((d) => +d[k].toFixed(1)), borderColor: css(c), backgroundColor: css(c), borderWidth: 2, borderDash: dash ? [5, 4] : [], pointRadius: 0, pointHoverRadius: 4, tension: 0.25 })),
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y, 1)} kWh` } } },
        scales: { ...baseScales, x: { ...baseScales.x, ticks: { maxTicksLimit: 7, maxRotation: 0 } } },
      },
    });
    const solarDays = [
      ['prod', 'Production', '--s4'],
      ['exp', 'Exported', '--s3', true],
    ];
    const consDays = [
      ['cons', 'Home use', '--s1'],
      ['imp', 'Bought from grid', '--grid-color', true],
    ];
    $('sd-legend2').innerHTML = solarDays.map(([, l, c]) => `<span><i style="background:${css(c)}"></i>${l}</span>`).join('');
    $('cons-days-legend').innerHTML = consDays.map(([, l, c]) => `<span><i style="background:${css(c)}"></i>${l}</span>`).join('');
    for (const [key, cfg, el] of [
      ['sdMonths', monthCfg, 'chart-solar-months'],
      ['consDays', lineCfg(consDays), 'chart-cons-days'],
    ]) {
      if (charts[key]) charts[key].destroy();
      if (onPage(el)) charts[key] = new Chart($(el), cfg);
    }
  }

  // ---------- which data we have, and what has to be estimated ----------
  function measuredMonthSet() {
    if (!state.imp) return new Set();
    const o = yrOpts();
    void o;
    return new Set(EI.monthlyTotals(completeRows(impRows()), state.imp.split).filter((x) => x.days >= 1).map((x) => x.month));
  }
  function hourlyFullYear() {
    const H = hourly();
    if (!H) return false;
    const inst = installDate();
    const ok = new Set(Object.entries(H.months).filter(([k, v]) => v.days >= 28 && (inst == null || Date.UTC(+k.slice(0, 4), +k.slice(5), 0) < inst)).map(([k]) => +k.slice(5)));
    return ok.size === 12;
  }
  function dataMode() {
    const meas = measuredMonthSet();
    if (!state.imp) return hourly() ? 'ide-only' : 'none';
    if (meas.size === 12) return 'A';
    if (hourlyFullYear()) return 'C';
    return 'B';
  }
  function renderMode() {
    const mode = dataMode();
    const meas = measuredMonthSet();
    const H = hourly();
    const opt = (id, title, text) => `<div class="mode-opt ${mode === id ? 'on' : ''}"><span class="mode-k">${mode === id ? 'Your setup' : 'Option'}</span><b>${title}</b><span class="small">${text}</span></div>`;
    const status = {
      none: 'Upload your Enphase report to start. Add the i-DE file too if you have it.',
      'ide-only': 'Your i-DE file is loaded. Add the Enphase report to get solar production and compare rates.',
      A: 'A full year of Enphase data: production and consumption are all measured, nothing is estimated.',
      B: `${meas.size} month${meas.size === 1 ? '' : 's'} of Enphase data: the other ${12 - meas.size} months estimate solar from the seasonal curve and home use from the consumption profile you choose.`,
      C: `Home use for every month comes from your i-DE file; solar for the ${12 - meas.size} month${12 - meas.size === 1 ? '' : 's'} Enphase hasn't measured is estimated from the seasonal curve.`,
    }[mode];
    $('mode-panel').innerHTML = `<div class="mode-head"><span class="info-icon" aria-hidden="true">i</span><div><b>How your year is built</b><span class="small">${status}</span></div></div>
      <div class="mode-opts">
        ${opt('A', 'Full Enphase year', 'Twelve months of Enphase data. Everything measured.')}
        ${opt('B', 'Partial Enphase year', 'Missing months estimated: solar from the seasonal curve, home use from a consumption profile.')}
        ${opt('C', 'Full i-DE year + partial Enphase', 'Home use measured for every month; only solar is estimated for the missing months.')}
      </div>`;
    // the consumption profile is only needed when no file covers a full year of home use
    $('profile-panel').hidden = mode !== 'B';
    $('solar-est-controls').hidden = !(mode === 'B' || mode === 'C');
    // upload facts
    if (state.imp) {
      const list = [...meas].sort((a, b) => a - b).map((m) => EI.MON[m - 1]);
      $('up-enphase-facts').innerHTML = `<span class="chip ok">Loaded</span> ${esc(state.imp.name || 'Enphase report')} · ${list.length} month${list.length === 1 ? '' : 's'} measured (${list.join(', ')})${state.imp.interval ? ' · hourly detail' : ' · daily totals'}`;
    } else $('up-enphase-facts').innerHTML = '';
    if (H) {
      const full = hourlyFullYear();
      $('up-ide-facts').innerHTML = `<span class="chip ok">Loaded</span> ${esc(H.name)} · ${new Date(H.first).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(H.last).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })}${full ? ' · full year before the panels' : ' · <span class="pos">not a full year before the panels</span>'}`;
    } else $('up-ide-facts').innerHTML = '';
    $('hourly-clear-row').hidden = !H;
  }
  function renderConsumptionBasics() {
    const hasE = !!state.imp;
    const H = hourly();
    $('cons-empty').hidden = hasE;
    $('cons-empty').textContent = H ? 'Your i-DE file is loaded. Add the Enphase report to see your consumption with solar.' : 'Upload your Enphase report to see your consumption.';
    $('cons-body').hidden = !hasE;
    $('cons-days-card').hidden = !hasE;
    $('cons-kpis').hidden = !hasE;
    $('solar-empty').hidden = hasE;
    $('solar-data').hidden = !hasE;
    $('hourly-body').hidden = !H;
    const bits = [];
    if (hasE) bits.push('home use measured by Enphase');
    if (H) bits.push(`hourly readings from your i-DE file (${esc(H.name)})`);
    $('cons-sub').innerHTML = bits.length ? `From ${bits.join(' and ')}.` : '';
  }

  $('sd-perday').addEventListener('click', () => {
    sdMode = 'perday';
    renderSolarData();
  });
  $('sd-total').addEventListener('click', () => {
    sdMode = 'total';
    renderSolarData();
  });


  // ---------- hourly provider file: upload + summary ----------
  async function loadHourly(file) {
    const st = $('hourly-status');
    try {
      const r = EI.parseHourlyConsumptionCsv(await file.text());
      const months = {};
      for (const [k, v] of Object.entries(r.months)) months[k] = { kwh: +v.kwh.toFixed(3), p: v.p.map((x) => +x.toFixed(3)), pd: v.pd.map((x) => +x.toFixed(3)), days: v.days, hours: v.hours };
      state.hourly = { name: file.name, months, first: r.first, last: r.last, days: r.days, hours: r.hours, exportKwh: +r.exportKwh.toFixed(1) };
      save();
      renderHourly();
      update();
    } catch (e) {
      st.textContent = `Couldn't read that file: ${e.message}`;
    }
  }
  function renderHourly() {
    const H = hourly();
    $('hourly-body').hidden = !H;
    $('hourly-empty').hidden = !!H;
    if (!H) return;
    const keys = Object.keys(H.months).sort();
    const tot = keys.reduce((a, k) => a + H.months[k].kwh, 0);
    const P = keys.reduce((a, k) => a.map((x, i) => x + H.months[k].p[i]), [0, 0, 0]);
    const d0 = new Date(H.first);
    const d1 = new Date(H.last);
    const f = (d) => `${d.getUTCDate()} ${EI.MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    const full = H.days >= 365;
    const inst = installDate();
    const after = inst != null && H.last >= inst;
    const warn = [];
    if (!full) warn.push(`it covers ${H.days} days, not a full year from 1 January to 31 December`);
    if (after) warn.push('part of it is after your panels were installed, so those months show grid purchases rather than home use and are not used for the profile');
    $('hourly-status').innerHTML = warn.length ? `<span class="pos">Note: ${warn.join('; ')}.</span>` : '';
    void d0; void d1; void f;
    const peak = keys.reduce((a, k) => (H.months[k].kwh > H.months[a].kwh ? k : a), keys[0]);
    const low = keys.reduce((a, k) => (H.months[k].kwh < H.months[a].kwh ? k : a), keys[0]);
    const lab = (k) => `${EI.MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}`;
    $('hourly-kpis').innerHTML = `
      <div class="kpi"><span class="eyebrow">Home use in the file</span><span class="v">${fmt(tot, 0)} <small>kWh</small></span><span class="small muted">${fmt(tot / keys.length, 0)} kWh per month on average</span></div>
      <div class="kpi"><span class="eyebrow">Highest month</span><span class="v">${fmt(H.months[peak].kwh, 0)} <small>kWh</small></span><span class="small muted">${lab(peak)}</span></div>
      <div class="kpi"><span class="eyebrow">Lowest month</span><span class="v">${fmt(H.months[low].kwh, 0)} <small>kWh</small></span><span class="small muted">${lab(low)}</span></div>
      <div class="kpi"><span class="eyebrow">When you use it</span><span class="v">${Math.round((P[2] / tot) * 100)}<small> % valle</small></span><span class="small muted">P1 punta ${Math.round((P[0] / tot) * 100)}% · P2 llano ${Math.round((P[1] / tot) * 100)}%</span></div>`;
    if (typeof Chart === 'undefined') return;
    const line = css('--line');
    const cols = [css('--bad'), css('--s4'), css('--s3')];
    $('hourly-legend').innerHTML = `<span><i style="background:${cols[0]}"></i>P1 punta</span><span><i style="background:${cols[1]}"></i>P2 llano</span><span><i style="background:${cols[2]}"></i>P3 valle</span>`;
    const cfg = {
      type: 'bar',
      data: {
        labels: keys.map((k) => EI.MON[+k.slice(5) - 1]),
        datasets: ['P1 punta', 'P2 llano', 'P3 valle'].map((l, i) => ({ label: l, data: keys.map((k) => Math.round(H.months[k].p[i])), backgroundColor: cols[i], stack: 'h', borderRadius: i === 2 ? { topLeft: 4, topRight: 4 } : 0, categoryPercentage: 0.72 })),
      },
      options: {
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y, 0)} kWh`, footer: (it) => `Total ${fmt(H.months[keys[it[0].dataIndex]].kwh, 0)} kWh` } } },
        scales: { x: { stacked: true, grid: { display: false }, border: { color: line }, ticks: { color: css('--ink'), font: { weight: '600' } } }, y: { stacked: true, beginAtZero: true, grid: { color: line }, border: { display: false }, ticks: { maxTicksLimit: 6, callback: (v) => `${v} kWh` } } },
      },
    };
    if (charts.hourly) charts.hourly.destroy();
    if (onPage('chart-hourly')) charts.hourly = new Chart($('chart-hourly'), cfg);
  }
  $('hourly-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = ''; // so choosing the same file again still triggers a load
    if (f) loadHourly(f);
  });
  (() => {
    const dz = $('hourly-drop');
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('over');
      if (e.dataTransfer.files[0]) loadHourly(e.dataTransfer.files[0]);
    });
  })();
  $('hourly-clear').addEventListener('click', () => {
    state.hourly = null;
    save();
    $('hourly-status').textContent = '';
    renderHourly();
    update();
  });


  // ---------- your current rate (optional) ----------
  function curState() {
    state.current = state.current || { mode: 'none', id: null, manual: { name: '', p1: '', p2: '', e1: '', e2: '', e3: '', surplus: 0, fee: 0, bv: false } };
    return state.current;
  }
  const manualValid = (m) => m && [m.p1, m.p2, m.e1, m.e2, m.e3].every((v) => v !== '' && +v > 0);
  function renderCurrent() {
    const cs = curState();
    const rates = (DATA.rates || []).filter((r) => r.comparable).slice().sort((a, b) => (a.provider + a.plan).localeCompare(b.provider + b.plan));
    const groups = {};
    rates.forEach((r) => (groups[r.provider] = groups[r.provider] || []).push(r));
    $('cur-select').innerHTML =
      `<option value="none" ${cs.mode === 'none' ? 'selected' : ''}>No current rate: just compare all rates</option>` +
      `<option value="manual" ${cs.mode === 'manual' ? 'selected' : ''}>Enter my prices manually…</option>` +
      Object.entries(groups).map(([p, rs]) => `<optgroup label="${esc(p)}">${rs.map((r) => `<option value="${esc(r.id)}" ${cs.mode === 'list' && cs.id === r.id ? 'selected' : ''}>${esc(r.plan)}</option>`).join('')}</optgroup>`).join('');
    $('cur-manual').hidden = cs.mode !== 'manual';
    const m = cs.manual;
    [['cur-name', 'name'], ['cur-p1', 'p1'], ['cur-p2', 'p2'], ['cur-e1', 'e1'], ['cur-e2', 'e2'], ['cur-e3', 'e3'], ['cur-sur', 'surplus'], ['cur-fee', 'fee']].forEach(([id, k]) => {
      if (document.activeElement !== $(id)) $(id).value = m[k] ?? '';
    });
    $('cur-bv').checked = !!m.bv;
  }
  $('cur-select').addEventListener('change', (e) => {
    const cs = curState();
    const v = e.target.value;
    if (v === 'none' || v === 'manual') {
      cs.mode = v;
      cs.id = null;
    } else {
      cs.mode = 'list';
      cs.id = v;
    }
    renderCurrent();
    update();
  });
  [['cur-name', 'name'], ['cur-p1', 'p1'], ['cur-p2', 'p2'], ['cur-e1', 'e1'], ['cur-e2', 'e2'], ['cur-e3', 'e3'], ['cur-sur', 'surplus'], ['cur-fee', 'fee']].forEach(([id, k]) =>
    $(id).addEventListener('input', (e) => {
      curState().manual[k] = k === 'name' ? e.target.value : e.target.value === '' ? '' : Math.max(0, +e.target.value || 0);
      update();
    }),
  );
  $('cur-bv').addEventListener('change', (e) => {
    curState().manual.bv = e.target.checked;
    update();
  });

  async function init() {
    if (state.installCost) $('sav-cost').value = state.installCost;
    if (state.ibiDed) $('ibi-ded').value = state.ibiDed;
    if (state.irpfDed) $('irpf-ded').value = state.irpfDed;
    if (state.ltDegr != null && state.ltDegr !== '') $('lt-degr').value = state.ltDegr;
    renderMonths();
    renderImport();
    renderHourly();
    renderSettings();
    renderCustom();
    try {
      DATA = window.RATES_DATA || (await (await fetch('data/rates.json', { cache: 'no-cache' })).json());
    } catch (e) {
      $('source').textContent = 'Could not load data/rates.json. Only your own rates are shown.';
    }
    renderSource();
    renderCurrent();
    update();
  }
  init();
})();
