// Bill calculation engine (Spanish 2.0TD / 2.0A household bills with solar
// surplus compensation). Pure functions, shared by the web page and tests.
(function (root) {
  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  const DEFAULT_SETTINGS = {
    ieeRate: 0.0511269632, // Impuesto Especial sobre la Electricidad
    ieeMinPerMWh: 1.0, // legal minimum IEE for non-industrial use, €/MWh consumed
    vatRate: 0.21, // IVA
    meterRentPerDay: 0.026774, // alquiler de equipos, €/day (0,83 € / 31 days on the sample bill)
    useVirtualBattery: true, // count surplus value beyond the legal cap when the rate has a virtual battery
  };

  // Parse a CAE restriction like "CAE < 4 MWh" / "CAE ≥ 4 MWh" -> predicate on annual kWh
  function caeAllows(cae, annualKWh) {
    if (!cae) return true;
    const m = cae.match(/CAE\s*([<≥>≤]=?)\s*([\d,.]+)\s*MWh/);
    if (!m) return true;
    const limit = parseFloat(m[2].replace(',', '.')) * 1000;
    switch (m[1]) {
      case '<':
        return annualKWh < limit;
      case '≤':
        return annualKWh <= limit;
      case '≥':
      case '>=':
        return annualKWh >= limit;
      case '>':
        return annualKWh > limit;
      default:
        return true;
    }
  }

  // month: { days, kwP1, kwP2, kwh: [p1, p2, p3], surplusKWh }
  // rate: normalized rate (see scripts/parse.js)
  function monthBill(rate, month, settings) {
    const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    const days = month.days;
    const [k1, k2, k3] = month.kwh;
    const consumed = k1 + k2 + k3;

    const power = days * (month.kwP1 * rate.power.p1 + month.kwP2 * rate.power.p2);
    const e = rate.energy;
    const energy = k1 * e.e1 + k2 * e.e2 + k3 * e.e3;
    const socialBond = days * (rate.socialBond || 0);
    const monthlyFee = rate.monthlyFee ? (rate.monthlyFee * days * 12) / 365 : 0;

    // Simplified surplus compensation (RD 244/2019): valued at the rate's
    // pre-tax €/kWh price and capped at what the rate lets it offset.
    const surplusValue = (month.surplusKWh || 0) * (rate.surplus.price || 0);
    const cmp = rate.surplus.compensates || '';
    let cap = energy;
    if (/Potencia/i.test(cmp)) cap += power;
    if (/Bono Social/i.test(cmp)) cap += socialBond;
    if (/cuota mensual/i.test(cmp)) cap += monthlyFee;
    const compensation = Math.min(surplusValue, cap);
    const leftover = surplusValue - compensation;

    // Order of application: energy, then power, then bono social, then fee
    let rest = compensation;
    const offEnergy = Math.min(rest, energy);
    rest -= offEnergy;
    const offPower = Math.min(rest, power);
    rest -= offPower;
    const offBond = Math.min(rest, socialBond);
    rest -= offBond;
    const offFee = Math.min(rest, monthlyFee);

    const ieeBase = power - offPower + (energy - offEnergy);
    const iee = Math.max(ieeBase * s.ieeRate, (consumed / 1000) * s.ieeMinPerMWh);
    const meter = days * s.meterRentPerDay;
    const vatBase = ieeBase + iee + (socialBond - offBond) + meter + (monthlyFee - offFee);
    const vat = vatBase * s.vatRate;
    const total = vatBase + vat;

    // Virtual battery credit: leftover surplus value carried to future bills.
    let bvCredit = 0;
    if (rate.virtualBattery && s.useVirtualBattery && leftover > 0) {
      // "antes de impuestos": credit reduces the next pre-tax base, so each € saves € + taxes
      bvCredit = rate.virtualBattery.beforeTax ? leftover * (1 + s.ieeRate) * (1 + s.vatRate) : leftover;
    }

    return {
      power,
      energy,
      surplusValue,
      compensation,
      lostSurplus: bvCredit > 0 ? 0 : leftover,
      bvCredit,
      socialBond,
      monthlyFee,
      meter,
      iee,
      vat,
      taxes: iee + vat,
      total, // bill before applying any virtual-battery credit
      consumed,
    };
  }

  // months: [{ ..., weight }] weight = how many months of the year this one represents
  const AVG_MONTH_DAYS = 365 / 12;
  const monthFactor = (m) => m.weight * (m.days ? AVG_MONTH_DAYS / m.days : 1);

  function annualForRate(rate, months, settings) {
    const perMonth = months.map((m) => monthBill(rate, m, settings));
    let gross = 0;
    let credit = 0;
    // A period of `days` days is scaled to an average month (365/12 days) before
    // multiplying by the number of months it represents, so a 22-day partial
    // month or a 31-day bill both count correctly.
    perMonth.forEach((b, i) => {
      const f = monthFactor(months[i]);
      b.factor = f;
      gross += b.total * f;
      credit += b.bvCredit * f;
    });
    const usedCredit = Math.min(credit, gross);
    return { perMonth, gross, bvCreditGenerated: credit, bvCreditUsed: usedCredit, annual: gross - usedCredit };
  }

  function rankRates(rates, months, settings) {
    const totalWeight = months.reduce((a, m) => a + m.weight, 0) || 1;
    const annualKWh = (months.reduce((a, m) => a + (m.kwh[0] + m.kwh[1] + m.kwh[2]) * monthFactor(m), 0) * 12) / totalWeight;
    const maxKw = Math.max(...months.map((m) => Math.max(m.kwP1, m.kwP2)));
    const ranked = [];
    const excluded = [];
    for (const r of rates) {
      if (!r.comparable) {
        excluded.push({ rate: r, reason: r.notComparableReason || 'Incomplete price data' });
        continue;
      }
      if (r.maxKw != null && maxKw > r.maxKw) {
        excluded.push({ rate: r, reason: `Only for up to ${r.maxKw} kW contracted` });
        continue;
      }
      if (!caeAllows(r.cae, annualKWh)) {
        excluded.push({ rate: r, reason: `${r.cae} (your estimated use: ${(annualKWh / 1000).toFixed(1)} MWh/year)` });
        continue;
      }
      ranked.push({ rate: r, ...annualForRate(r, months, settings) });
    }
    ranked.sort((a, b) => a.annual - b.annual);
    return { ranked, excluded, annualKWh, maxKw, totalWeight };
  }

  const api = { AVG_MONTH_DAYS, monthFactor, DEFAULT_SETTINGS, monthBill, annualForRate, rankRates, caeAllows, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SolarCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
