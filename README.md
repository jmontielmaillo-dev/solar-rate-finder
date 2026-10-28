# Solar Performance & Rate Finder

A static web page for a home solar installation in Spain. You upload your files and it shows your solar production, your consumption, and every household electricity rate with surplus compensation priced as a full bill for your year.

**Inputs (files only, no manual entry):**
1. **Enphase report (required):** Enlighten CSV with Energy Produced, Energy Consumed, Exported to Grid and Imported from Grid.
2. **i-DE hourly consumption (optional):** `consumo_periodo_01-01-YYYY_31-12-YYYY.csv` from the distributor, for a full year before the panels.

**How the year is built:**
- **A. Full Enphase year:** everything measured.
- **B. Partial Enphase year:** missing months estimate solar from a seasonal curve, and home use from a consumption profile (selectable, only shown in this case).
- **C. Full i-DE year + partial Enphase:** home use measured for every month; only solar is estimated.

**Page sections:** Your data (uploads, how the year is built, your current rate) · Solar production · Consumption (yearly profile with export below zero, grid purchases per time period) · Rate finder.

**Partial months:** any month with at least one complete day of Enphase data counts as partly measured. Missing days get solar from the seasonal curve and home use at the measured daily average; the self-use share and the P1/P2/P3 split follow the measured days. A day counts when the report has the whole day (any value for daily reports, ≥ 22 hours for interval reports).

**Your current rate (optional):** pick it from the list of rates or type its prices; nothing is preselected. Every rate is ranked, and savings are shown against the current rate when one is set.

**Rate data:** simuladorfacturaluz.es doesn't allow other websites to read its data from the browser (no CORS), so the page uses a copy in `data/rates.json` that the GitHub Action refreshes every day.

Rate data comes from [simuladorfacturaluz.es](https://www.simuladorfacturaluz.es/tarifas-de-luz/). Only household rates tagged **FV** (surplus compensation) are kept. A GitHub Action refreshes `data/rates.json` every day.

## Files

| Path | What it is |
|---|---|
| `index.html`, `app.js` | The page and its UI logic |
| `importer.js` | Reads an Enphase Enlighten report CSV (daily or interval) into monthly inputs, and estimates months with no data |
| `calc.js` | Bill engine: power, energy, surplus cap, virtual battery, IEE, IVA |
| `scripts/parse.js` | Turns the source site's rate listing into normalized JSON |
| `scripts/scrape.js` | Downloads the listing and writes `data/rates.json` |
| `scripts/build-single.js` | Builds `dist/solar-rate-finder.html`, a single-file copy with everything inlined |
| `.github/workflows/update-rates.yml` | Weekly scrape, commits `data/rates.json` when prices change |
| `tests/` | Tests, including a check against a real bill (98,01 €) |

## Publish on GitHub Pages

1. Create a new repository on GitHub, named `solar-rate-finder` under `jmontielmaillo-dev`. On the free plan, Pages needs a **public** repo. The repo holds no personal data, only public rate prices and the example kWh figures.
2. Push this folder:
   ```bash
   git init && git add . && git commit -m "Solar Rate Finder"
   git branch -M main
   git remote add origin https://github.com/jmontielmaillo-dev/solar-rate-finder.git
   git push -u origin main
   ```
3. **Settings → Pages**: Source "Deploy from a branch", branch `main`, folder `/ (root)`.
4. **Settings → Actions → General → Workflow permissions**: allow "Read and write" so the weekly job can commit new prices.
5. Optional: **Actions → Update FV rates → Run workflow** to refresh the rates right away.

The site will be at `https://jmontielmaillo-dev.github.io/solar-rate-finder/` (next to your finance dashboard).

## Run locally

```bash
npm ci
npm test
npm run scrape            # refresh data/rates.json
python3 -m http.server    # then open http://localhost:8000
```

## Importing Enphase data

In Enlighten, export a report with **Energy Produced, Energy Consumed, Exported to Grid and Imported from Grid** (consumption meters needed), daily or in 15-minute or hourly intervals. Drop the CSV on the page. Each calendar month becomes a measured month:

- Weekends and national holidays are 100% P3 valle.
- With interval data, weekday imports are placed in P1/P2/P3 by hour.
- With daily data, weekday imports are split with editable shares. The default 22 / 17 / 61 comes from a real bill, where the bill and Enphase agreed to within 1 kWh.

In the full-year view, estimated months get their solar production from one smooth seasonal curve that peaks at the June solstice (monthly output = A + B·cos(2π(day − 172)/365), with December at 47% of June by default, editable). The curve is scaled to the months Enphase measured. The daily usage pattern of the measured month with the most similar sunshine decides how much of that solar is used directly. Partial months are scaled to a full month in the yearly sum.

With a file loaded, the rate finder defaults to **Full year from my data**: twelve calendar months, each marked measured or estimated, shown in a chart and a table with the bill per month for the best and the current rate. The yearly cost is the sum of those twelve bills. "Representative months" switches back to the three-card model.

**Home use through the year:** months without real readings follow a consumption profile: more in winter and summer (default), more in winter, more in summer, or flat. With "Learn from my data" on, months that have data (Enphase, or provider readings from before the panels) keep their real value and shape the profile; the other months follow the preset, scaled to match. Each month can be edited as a % of the average month, and any provider reading can be switched off (for example a month you were away).

**Hourly consumption file (recommended):** in "Your solar data", upload the hourly CSV from your distributor (i-DE: https://www.i-de.es/area-privada/web/home/contract/consumption; Datadis works too) covering 1 January to 31 December of a year before the panels. Format: `CUPS;Fecha;Hora;Consumo_kWh;Metodo_obtencion`, Hora 1–24. It gives real home use for each calendar month (used by the profile with no other input), the P1/P2/P3 split per month (used for the "without solar" bill and for estimated months' grid purchases) and the daylight share of use per period (what solar can offset). Only monthly aggregates are stored in the browser; the CUPS is not kept. For a private build with it preloaded: `HOURLY_DEFAULTS=hourly.json node scripts/build-single.js`.

**Provider readings:** (optional) paste or type your monthly grid consumption from your energy provider (for example "enero 2026 950,250 kWh"). Months before the installation date (the first day in the Enphase file) are taken as real home use, which captures winter heating. Remaining gaps are interpolated between known months. For a private single-file build with your readings preloaded: `PROVIDER_DEFAULTS=my-readings.json node scripts/build-single.js` (JSON like `{"2026-01": 950.25}`). Keep that file out of the repo.

**What solar saves you:** the same year of home use priced three ways: without solar on the current rate (self-consumed energy bought from the grid instead: weekdays 48% P1 / 52% P2, weekends P3; no export), with solar on the current rate, and with solar on the best rate. It shows the yearly and monthly savings. Enter the installation cost (including VAT and any other taxes or fees), your IRPF deduction and your IBI deduction (total over the years it applies) to get the net cost, the payback (when the running balance turns positive) and a 25-year outlook: yearly savings shrinking with panel output (1% per year by default, editable), IRPF back in year 1, the IBI discount spread over years 1–4, at today's electricity prices, plus the equivalent annual return (IRR) on the installation cost.

The CSV is processed in the browser only. Don't commit your own export to a public repo.

## Modelling notes

- **Periods (2.0TD):** P1 punta 10–14h and 18–22h on weekdays; P2 llano 8–10h, 14–18h and 22–24h on weekdays; P3 valle 0–8h on weekdays plus weekends and holidays. Single-price (2.0A) rates use the same price for all three.
- **Surplus:** valued at each rate's own pre-tax €/kWh. It is capped at what the rate allows it to offset ("Consumo"/"Solo energía" means energy only; some indexed rates add power). Value above the cap is lost, unless the rate has a virtual battery, in which case it is kept as credit against later bills.
- **Taxes:** IEE 5.11269632% on power + energy − compensation (minimum 1 €/MWh), then 21% IVA on that plus the bono social charge, meter rental and any monthly fee.
- **Left out:** plans for large consumers (a minimum annual consumption such as "CAE ≥ 4 MWh") are dropped by the scraper. Indexed rates (PVPC/OMIE), rates with their own time bands (for example Iberdrola Plan Solar) and rates that don't fit your contracted power or yearly use are not ranked. Add any rate by hand under "Your own rates".
- If the source site changes its markup, the scraper fails its sanity check and keeps the previous `rates.json`. The Action run then shows as failed.
