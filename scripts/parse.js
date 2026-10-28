// Parses the HTML returned by
//   https://www.simuladorfacturaluz.es/sfl_api/?func=get_html_tarifas_luz
// into a normalized list of household rates that offer photovoltaic (FV)
// surplus compensation. Works with any DOM `document` (browser DOMParser or
// linkedom in Node), so the same code runs in the scraper and in tests.

const txt = (el) => (el ? el.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '');

const num = (s) => {
  if (s == null) return null;
  const t = String(s).trim();
  if (!/^-?[\d.,]+$/.test(t)) return null;
  // Spanish format uses "," as decimal separator; some values (CM) use "."
  const n = t.includes(',') ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
  return Number.isFinite(n) ? n : null;
};

const slug = (s) =>
  s
    .replace(/[≥>]/g, ' gte ')
    .replace(/</g, ' lt ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function parseRow(row) {
  const empresa = txt(row.querySelector('.fmsimfl_css_tarif_empresa'));
  const plan = txt(row.querySelector('.fmsimfl_css_tarif_nameplan'));
  const tipoEl = row.querySelector('.fmsimfl_css_tarif_tipo');
  const tipoParts = tipoEl ? [...tipoEl.children].map(txt) : [];
  const accessTariff = tipoParts[0] || '';
  const powerLimitText = tipoParts.find((p) => /Pot/.test(p)) || '';
  const maxKwMatch = powerLimitText.match(/Pot\s*≤\s*([\d,]+)\s*kW/);
  const tags = [...(tipoEl ? tipoEl.querySelectorAll('span[title]') : [])].map((s) => txt(s));
  const caeEl = tipoEl ? [...tipoEl.querySelectorAll('span[title]')].find((s) => /CAE/.test(txt(s))) : null;
  const cae = caeEl ? txt(caeEl) : null;

  // label -> list of numeric/text values for price rows
  const f = {};
  const info = {};
  const priceCell = row.querySelector('.fmsimfl_css_tarif_precio_plan');
  if (priceCell) {
    priceCell.querySelectorAll('.fmsimfl_css_tarif_precio_vut').forEach((v) => {
      const k = txt(v.querySelector('.fmsimfl_css_tarif_per')).replace(':', '').trim();
      f[k] = [...v.querySelectorAll('.fmsimfl_css_tarif_val, .fmsimfl_css_tarif_dat')].map(txt);
    });
    priceCell.querySelectorAll('.fmsimfl_css_tarif_inf_dat').forEach((v) => {
      const k = txt(v.querySelector('.fmsimfl_css_tarif_inf')).replace(':', '').trim();
      info[k] = txt(v.querySelector('.fmsimfl_css_tarif_dat'));
    });
  }

  const v0 = (k) => (f[k] ? f[k][0] : null);
  return normalize({
    provider: empresa,
    plan,
    url: row.querySelector('.fmsimfl_css_tarif_plan a')?.getAttribute('href') || null,
    updated: txt(row.querySelector('.fmsimfl_css_tarif_fecha')) || null,
    accessTariff,
    schedule: (f['Horario'] || [''])[0],
    maxKw: maxKwMatch ? num(maxKwMatch[1]) : null,
    cae,
    tags,
    p1: v0('P1'),
    p2: v0('P2'),
    e1: v0('E1'),
    e2: v0('E2'),
    e3: v0('E3'),
    emc: v0('EMC'),
    cm: v0('CM'),
    fbs: v0('FBS'),
    surplus: v0('FV.EXC'),
    compensates: info['FV.CMP'] || '',
    bv: info['BV'] || null,
    bvAppliesTo: info['BV.CMP'] || null,
  });
}

// raw (strings or numbers) -> normalized rate object
function normalize(raw) {
  const n = (v) => (typeof v === 'number' ? v : num(v));
  const tags = raw.tags;
  const accessTariff = raw.accessTariff;
  const schedule = raw.schedule || '';
  const indexed = tags.includes('IDX') || /PVPC|OMIE/i.test(String(raw.e1 ?? ''));
  const isTD = /^2\.0TD/.test(accessTariff);
  const is20A = /^2\.0A/.test(accessTariff);
  const standardSchedule = /Horario estándar 2\.0(TD|A)/.test(schedule);
  const energy = indexed || n(raw.e1) == null
    ? null
    : is20A
      ? { e1: n(raw.e1), e2: n(raw.e1), e3: n(raw.e1) }
      : { e1: n(raw.e1), e2: n(raw.e2), e3: n(raw.e3) };
  const comparable = !indexed && standardSchedule && (isTD || is20A) && !!energy && energy.e2 != null && energy.e3 != null;
  let reason = null;
  if (indexed) reason = 'Indexed price (PVPC/OMIE), varies hour by hour';
  else if (!standardSchedule) reason = `Uses its own time bands (${schedule.replace('Horario especial ', '')}), not the standard 3 periods`;
  const cmp = raw.compensates || '';
  return {
    id: slug(`${raw.provider}-${raw.plan}-${accessTariff}`),
    provider: raw.provider,
    plan: raw.plan,
    url: raw.url,
    updated: raw.updated,
    accessTariff,
    periods: is20A ? 1 : isTD ? 3 : null,
    schedule,
    maxKw: raw.maxKw,
    cae: raw.cae,
    tags,
    fvOnly: tags.includes('FV*'),
    indexed,
    comparable,
    notComparableReason: comparable ? null : reason,
    power: { p1: n(raw.p1), p2: n(raw.p2) }, // €/kW/day
    energy, // €/kWh per 2.0TD period (P1 punta, P2 llano, P3 valle)
    emc: n(raw.emc),
    monthlyFee: n(raw.cm), // €/month
    socialBond: n(raw.fbs), // €/day (financiación bono social)
    surplus: {
      price: n(raw.surplus), // €/kWh; null when indexed (OMIE…)
      priceText: raw.surplus == null ? null : String(raw.surplus),
      compensates: cmp, // "Consumo", "Solo energía", "Potencia + consumo", …
      includesPower: /Potencia/i.test(cmp),
    },
    virtualBattery: raw.bv
      ? { text: raw.bv, beforeTax: /antes de impuestos/i.test(raw.bv), appliesTo: raw.bvAppliesTo }
      : null,
  };
}

// A minimum annual consumption ("CAE ≥ 4 MWh", "CAE > 10 MWh") marks a plan for large sites
function isLargeConsumerRate(r) {
  return !!r.cae && /CAE\s*(≥|>|>=)/.test(r.cae);
}

function parseRates(document) {
  const rows = [...document.querySelectorAll('tr')].filter((r) => r.querySelector('.fmsimfl_css_tarif_nameplan'));
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    // keep only the household ("hogares") detailed listing
    let p = row.parentElement;
    let sectionId = '';
    while (p) {
      if (p.id && /listado_tarifas_(hog|emp)_body/.test(p.id)) {
        sectionId = p.id;
        break;
      }
      p = p.parentElement;
    }
    if (!/hog/.test(sectionId)) continue;
    const r = parseRow(row);
    if (!r.tags.some((t) => t.startsWith('FV'))) continue; // only rates with FV compensation
    if (isLargeConsumerRate(r)) continue; // plans that require a high annual consumption (e.g. "CAE ≥ 4 MWh")
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { parseRates, parseRow, normalize, num, isLargeConsumerRate };
