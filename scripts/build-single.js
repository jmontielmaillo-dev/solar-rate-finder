// Builds dist/solar-rate-finder.html: one self-contained page (scripts and
// rate data inlined) for hosts that cannot serve the separate files.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let html = read('index.html');
const data = read('data/rates.json').replace(/</g, '\\u003c');
// Optional personal defaults for a private build (never committed): PROVIDER_DEFAULTS=path/to/json
const provDefaults = process.env.PROVIDER_DEFAULTS ? fs.readFileSync(process.env.PROVIDER_DEFAULTS, 'utf8').replace(/</g, '\\u003c') : null;
const hourlyDefaults = process.env.HOURLY_DEFAULTS ? fs.readFileSync(process.env.HOURLY_DEFAULTS, 'utf8').replace(/</g, '\\u003c') : null;
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace('<script src="calc.js"></script>', () => `<script>window.RATES_DATA=${data};${provDefaults ? `window.DEFAULT_PROVIDER=${provDefaults};` : ''}${hourlyDefaults ? `window.DEFAULT_HOURLY=${hourlyDefaults};` : ''}</script>\n<script>\n${read('calc.js')}\n</script>`)
  .replace('<script src="importer.js"></script>', () => `<script>\n${read('importer.js')}\n</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${read('app.js')}\n</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'solar-rate-finder.html'), html);
console.log('dist/solar-rate-finder.html', html.length, 'bytes');
