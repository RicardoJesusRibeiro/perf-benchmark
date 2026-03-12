const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────

const API_KEY = process.env.PAGESPEED_API_KEY;
const TODAY = new Date().toISOString().split('T')[0];

const SITES = [
  {
    id: 'continente',
    name: 'Continente',
    color: '#e63946',
    isOwn: true,
    pages: {
      homepage:  'https://www.continente.pt/',
      category:  'https://www.continente.pt/bebidas-e-garrafeira/',
      pdp:       'https://www.continente.pt/produto/agua-continente-15l-cont-7096756/',
      cart:      'https://www.continente.pt/carrinho/',
    }
  },
  {
    id: 'auchan',
    name: 'Auchan',
    color: '#f77f00',
    isOwn: false,
    pages: {
      homepage:  'https://www.auchan.pt/',
      category:  'https://www.auchan.pt/bebidas/',
      pdp:       'https://www.auchan.pt/agua-continente-15l/',
      cart:      'https://www.auchan.pt/carrinho/',
    }
  },
  {
    id: 'pingodoce',
    name: 'Pingo Doce',
    color: '#2a9d8f',
    isOwn: false,
    pages: {
      homepage:  'https://www.pingodoce.pt/',
      category:  'https://www.pingodoce.pt/produtos/bebidas/',
      pdp:       'https://www.pingodoce.pt/produtos/bebidas/aguas/agua-de-nascente/',
      cart:      'https://www.pingodoce.pt/carrinho/',
    }
  },
  {
    id: 'elcorteingles',
    name: 'El Corte Inglés',
    color: '#457b9d',
    isOwn: false,
    pages: {
      homepage:  'https://www.elcorteingles.pt/',
      category:  'https://www.elcorteingles.pt/supermercado/bebidas/',
      pdp:       'https://www.elcorteingles.pt/supermercado/',
      cart:      'https://www.elcorteingles.pt/carrinho/',
    }
  }
];

const STRATEGIES = ['mobile', 'desktop'];

// ─── HELPERS ───────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractMetrics(psiResult) {
  const cats = psiResult.lighthouseResult?.categories || {};
  const audits = psiResult.lighthouseResult?.audits || {};
  const loading = psiResult.loadingExperience?.metrics || {};

  return {
    // Scores (0–100)
    performanceScore:    Math.round((cats.performance?.score || 0) * 100),
    accessibilityScore:  Math.round((cats.accessibility?.score || 0) * 100),
    seoScore:            Math.round((cats.seo?.score || 0) * 100),
    bestPracticesScore:  Math.round((cats['best-practices']?.score || 0) * 100),

    // Core Web Vitals (ms ou score)
    lcp:  audits['largest-contentful-paint']?.numericValue   || null,  // ms
    fid:  audits['max-potential-fid']?.numericValue           || null,  // ms
    cls:  audits['cumulative-layout-shift']?.numericValue     || null,  // score
    fcp:  audits['first-contentful-paint']?.numericValue      || null,  // ms
    tti:  audits['interactive']?.numericValue                 || null,  // ms
    tbt:  audits['total-blocking-time']?.numericValue         || null,  // ms
    si:   audits['speed-index']?.numericValue                 || null,  // ms

    // Field data (real users) quando disponível
    lcpField: loading['LARGEST_CONTENTFUL_PAINT_MS']?.percentile || null,
    fidField: loading['FIRST_INPUT_DELAY_MS']?.percentile         || null,
    clsField: loading['CUMULATIVE_LAYOUT_SHIFT_SCORE']?.percentile || null,
    fcpField: loading['FIRST_CONTENTFUL_PAINT_MS']?.percentile    || null,
  };
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function runBenchmark() {
  console.log(`\n🚀 Starting benchmark for ${TODAY}\n`);

  const results = {
    date: TODAY,
    timestamp: new Date().toISOString(),
    sites: {}
  };

  for (const site of SITES) {
    results.sites[site.id] = { name: site.name, pages: {} };

    for (const [pageId, url] of Object.entries(site.pages)) {
      results.sites[site.id].pages[pageId] = {};

      for (const strategy of STRATEGIES) {
        console.log(`  📡 ${site.name} / ${pageId} / ${strategy} ...`);

        const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${API_KEY}`;

        try {
          const data = await fetchJson(apiUrl);

          if (data.error) {
            console.warn(`    ⚠️  API error: ${data.error.message}`);
            results.sites[site.id].pages[pageId][strategy] = { error: data.error.message };
          } else {
            const metrics = extractMetrics(data);
            results.sites[site.id].pages[pageId][strategy] = metrics;
            console.log(`    ✅ Performance: ${metrics.performanceScore} | LCP: ${metrics.lcp ? Math.round(metrics.lcp/1000*10)/10+'s' : 'n/a'}`);
          }
        } catch (err) {
          console.error(`    ❌ Failed: ${err.message}`);
          results.sites[site.id].pages[pageId][strategy] = { error: err.message };
        }

        // Respeitar rate limits da API (400 req/100s)
        await sleep(1500);
      }
    }
  }

  // ─── GUARDAR RESULTADOS ────────────────────────────────────────────────

  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Ficheiro do dia
  const dailyFile = path.join(dataDir, `${TODAY}.json`);
  fs.writeFileSync(dailyFile, JSON.stringify(results, null, 2));
  console.log(`\n💾 Saved: data/${TODAY}.json`);

  // Índice acumulado (todos os dias)
  const indexFile = path.join(dataDir, 'index.json');
  let index = [];
  if (fs.existsSync(indexFile)) {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  }
  // Atualiza ou adiciona entrada do dia
  const existingIdx = index.findIndex(e => e.date === TODAY);
  if (existingIdx >= 0) index[existingIdx] = { date: TODAY, file: `${TODAY}.json` };
  else index.push({ date: TODAY, file: `${TODAY}.json` });
  index.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));

  // Latest snapshot (para a app carregar rápido)
  const latestFile = path.join(dataDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(results, null, 2));

  console.log(`\n✅ Benchmark complete! ${Object.keys(results.sites).length} sites × ${STRATEGIES.length} strategies × ${Object.keys(SITES[0].pages).length} pages\n`);
}

runBenchmark().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
