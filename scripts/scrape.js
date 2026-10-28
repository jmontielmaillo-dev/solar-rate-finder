// Downloads the household rate listing from simuladorfacturaluz.es, keeps only
// rates with photovoltaic (FV) surplus compensation and writes data/rates.json.
// Run: node scripts/scrape.js   (used by .github/workflows/update-rates.yml)

const fs = require('fs');
const path = require('path');
const { parseHTML } = require('linkedom');
const { parseRates } = require('./parse');

const SOURCE = 'https://www.simuladorfacturaluz.es/sfl_api/?func=get_html_tarifas_luz';
const OUT = path.join(__dirname, '..', 'data', 'rates.json');

async function main() {
  const res = await fetch(SOURCE, {
    headers: { 'User-Agent': 'solar-rate-comparator (GitHub Action, weekly)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from source`);
  const html = await res.text();
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const rates = parseRates(document);

  // Sanity checks so a site redesign never wipes the data file
  const comparable = rates.filter((r) => r.comparable);
  if (rates.length < 10 || comparable.length < 5) {
    throw new Error(`Parsed too few rates (${rates.length} total, ${comparable.length} comparable) – keeping previous file`);
  }

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  if (prev && JSON.stringify(prev.rates) === JSON.stringify(rates)) {
    console.log('No changes in rates.');
    return;
  }
  const data = {
    source: 'https://www.simuladorfacturaluz.es/tarifas-de-luz/',
    fetchedAt: new Date().toISOString(),
    notes: 'Prices without taxes. Power in €/kW/day, energy and surplus in €/kWh, monthly fee in €/month, social bond financing in €/day.',
    rates,
  };
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${rates.length} FV rates (${comparable.length} comparable) to ${OUT}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
