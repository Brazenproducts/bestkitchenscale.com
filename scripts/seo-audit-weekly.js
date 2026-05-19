const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SA_PATH = '/home/ubuntu/.config/gcloud/legacy_credentials/axl-348@proud-stage-397621.iam.gserviceaccount.com/adc.json';
const OUTPUT_FILE = path.join('/home/ubuntu/.openclaw/workspace/memory/seo-audit-weekly.md');

const SITES = [
  'bestseatcover.com',
  'jeepseatcover.com',
  'wranglerseatcover.com',
  'tacticalseats.com',
  'bestbroncoaccessories.com',
];

// Brand terms to exclude (case-insensitive partial match)
const BRAND_TERMS = [
  'bartact', 'bull strap', 'bullstrap', 'brazen', 'walkway',
  'bestseatcover', 'jeepseatcover', 'wranglerseatcover', 'tacticalseats', 'bestbroncoaccessories',
];

function isBrandQuery(query) {
  const q = query.toLowerCase();
  return BRAND_TERMS.some(b => q.includes(b));
}

async function main() {
  const creds = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
  
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  
  // Date ranges: last 7 days vs prior 7 days
  // Current date: 2026-05-18. GSC data has ~3 day lag, so use up to 2026-05-15
  const endDate = '2026-05-15';
  const startDateCurrent = '2026-05-09';
  const endDatePrior = '2026-05-08';
  const startDatePrior = '2026-05-02';
  
  const results = [];
  const alerts = []; // queries that dropped off page 1
  
  for (const site of SITES) {
    // Try both sc-domain and URL prefix formats
    const siteUrls = [
      `sc-domain:${site}`,
      `https://${site}/`,
      `https://www.${site}/`,
      `http://${site}/`,
    ];
    
    let currentData = null;
    let priorData = null;
    let usedSiteUrl = null;
    
    for (const siteUrl of siteUrls) {
      try {
        const [curr, prior] = await Promise.all([
          searchconsole.searchanalytics.query({
            siteUrl,
            requestBody: {
              startDate: startDateCurrent,
              endDate: endDate,
              dimensions: ['query', 'page'],
              rowLimit: 50,
              dimensionFilterGroups: [],
            },
          }),
          searchconsole.searchanalytics.query({
            siteUrl,
            requestBody: {
              startDate: startDatePrior,
              endDate: endDatePrior,
              dimensions: ['query', 'page'],
              rowLimit: 50,
              dimensionFilterGroups: [],
            },
          }),
        ]);
        currentData = curr.data.rows || [];
        priorData = prior.data.rows || [];
        usedSiteUrl = siteUrl;
        break;
      } catch (e) {
        // Try next format
        continue;
      }
    }
    
    if (!currentData) {
      results.push({ site, error: 'No GSC access (tried all URL formats)', queries: [] });
      continue;
    }
    
    // Build lookup: query -> { currentPos, priorPos, currentClicks, url }
    const currentMap = new Map();
    for (const row of currentData) {
      const query = row.keys[0];
      const url = row.keys[1];
      if (isBrandQuery(query)) continue;
      const key = query;
      if (!currentMap.has(key) || row.impressions > (currentMap.get(key).impressions || 0)) {
        currentMap.set(key, { query, url, position: row.position, clicks: row.clicks, impressions: row.impressions });
      }
    }
    
    const priorMap = new Map();
    for (const row of priorData) {
      const query = row.keys[0];
      if (isBrandQuery(query)) continue;
      const key = query;
      if (!priorMap.has(key) || row.impressions > (priorMap.get(key).impressions || 0)) {
        priorMap.set(key, { position: row.position, clicks: row.clicks, impressions: row.impressions });
      }
    }
    
    // Merge and find top 20 by current impressions, then check drops
    const merged = [];
    for (const [query, curr] of currentMap) {
      const prior = priorMap.get(query);
      merged.push({
        query,
        url: curr.url,
        currentPos: curr.position,
        priorPos: prior ? prior.position : null,
        posDelta: prior ? curr.position - prior.position : null,
        currentClicks: curr.clicks,
        currentImpressions: curr.impressions,
      });
    }
    
    // Sort by impressions desc, take top 20
    merged.sort((a, b) => b.currentImpressions - a.currentImpressions);
    const top20 = merged.slice(0, 20);
    
    // Flag drops > 1 position (positive delta = worse position)
    const drops = top20.filter(q => q.posDelta !== null && q.posDelta > 1);
    
    // Check for page 1 dropoffs (was <=10, now >10)
    const page1Drops = drops.filter(q => q.priorPos <= 10 && q.currentPos > 10);
    
    results.push({
      site,
      siteUrl: usedSiteUrl,
      top20Count: top20.length,
      drops,
      page1Drops,
      queries: top20,
    });
    
    for (const d of page1Drops) {
      alerts.push({
        site,
        query: d.query,
        url: d.url,
        from: d.priorPos.toFixed(1),
        to: d.currentPos.toFixed(1),
      });
    }
  }
  
  // Format output
  const now = new Date().toISOString().split('T')[0];
  let md = `\n---\n\n## Weekly Non-Brand SEO Audit — ${now}\n`;
  md += `**Period:** ${startDateCurrent} to ${endDate} vs ${startDatePrior} to ${endDatePrior}\n\n`;
  
  for (const r of results) {
    md += `### ${r.site}\n`;
    if (r.error) {
      md += `⚠️ ${r.error}\n\n`;
      continue;
    }
    
    if (r.drops.length === 0) {
      md += `✅ No significant drops (top ${r.top20Count} non-brand queries stable)\n\n`;
    } else {
      md += `⚠️ **${r.drops.length} queries dropped >1 position:**\n`;
      for (const d of r.drops) {
        const arrow = d.priorPos <= 10 && d.currentPos > 10 ? ' 🔴 OFF PAGE 1' : '';
        md += `- "${d.query}" — pos ${d.priorPos.toFixed(1)} → ${d.currentPos.toFixed(1)} (Δ+${d.posDelta.toFixed(1)})${arrow}\n`;
        md += `  URL: ${d.url}\n`;
      }
      md += '\n';
    }
  }
  
  if (alerts.length > 0) {
    md += `### 🚨 Page 1 Drop-Offs\n`;
    for (const a of alerts) {
      md += `- **${a.site}** — "${a.query}" fell from pos ${a.from} to ${a.to}\n`;
      md += `  URL: ${a.url}\n`;
    }
    md += '\n';
  }
  
  // Append to file
  fs.appendFileSync(OUTPUT_FILE, md);
  
  // Output summary for console
  console.log(JSON.stringify({ results: results.map(r => ({ site: r.site, error: r.error, drops: r.drops?.length || 0, page1Drops: r.page1Drops?.length || 0, top20: r.top20Count })), alerts, appendedTo: OUTPUT_FILE }, null, 2));
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
