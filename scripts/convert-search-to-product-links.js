#!/usr/bin/env node
/**
 * convert-search-to-product-links.js
 * 
 * Converts Amazon search links (/s?k=...) to direct product links (/dp/ASIN)
 * by looking up real ASINs via web search.
 * 
 * Phase 1: Build ASIN lookup cache (query → ASIN mapping)
 * Phase 2: Replace search links in all HTML files
 * Phase 3: Commit and push
 * 
 * Usage:
 *   node scripts/convert-search-to-product-links.js [--batch-size 50] [--dry-run] [--cache-only] [--replace-only]
 * 
 * --cache-only:   Only build the ASIN cache, don't replace links
 * --replace-only: Only replace links using existing cache, don't look up new ASINs
 * --dry-run:      Show what would change without modifying files
 * --batch-size N: Max number of NEW lookups per run (rate limit protection)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const SITES_DIR = '/home/ubuntu/.openclaw/workspace/sites';
const TOKEN = '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';
const ORG = 'Brazenproducts';
const CACHE_FILE = '/home/ubuntu/.openclaw/workspace/memory/asin-cache.json';
const FAILED_FILE = '/home/ubuntu/.openclaw/workspace/memory/asin-failed.json';
const REPORT_FILE = '/home/ubuntu/.openclaw/workspace/memory/link-conversion-report.json';
const TAG = 'brazenprodu01-20';

const BATCH_SIZE = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--batch-size') || '100');
const DRY_RUN = process.argv.includes('--dry-run');
const CACHE_ONLY = process.argv.includes('--cache-only');
const REPLACE_ONLY = process.argv.includes('--replace-only');

// Load caches
let asinCache = {};
try { asinCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch(e) {}
let failedLookups = {};
try { failedLookups = JSON.parse(fs.readFileSync(FAILED_FILE, 'utf8')); } catch(e) {}

// Extract all unique search queries across all sites
function getAllSearchQueries() {
  const queries = new Map(); // query -> [{site, file, fullUrl, tag}]
  for (const site of fs.readdirSync(SITES_DIR)) {
    const siteDir = path.join(SITES_DIR, site);
    if (!fs.statSync(siteDir).isDirectory()) continue;
    for (const f of fs.readdirSync(siteDir)) {
      if (!f.endsWith('.html')) continue;
      let html;
      try { html = fs.readFileSync(path.join(siteDir, f), 'utf8'); } catch(e) { continue; }
      
      // Match href="https://...amazon.com/s?k=..."
      const re = /href="(https?:\/\/(?:www\.)?amazon\.com\/s\?[^"]+)"/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const url = m[1];
        const kMatch = url.match(/[?&]k=([^&"]+)/);
        if (!kMatch) continue;
        let query;
        try { query = decodeURIComponent(kMatch[1].replace(/\+/g, ' ')).trim(); } catch(e) { query = kMatch[1].replace(/\+/g, ' ').trim(); }
        const tagMatch = url.match(/tag=([a-zA-Z0-9_-]+)/);
        const tag = tagMatch ? tagMatch[1] : TAG;
        
        if (!queries.has(query)) queries.set(query, []);
        queries.get(query).push({ site, file: f, fullUrl: url, tag });
      }
    }
  }
  return queries;
}

// Rotate user agents to reduce blocking
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];
let uaIndex = 0;

// Look up ASIN by searching Amazon directly
function searchAmazonForASIN(query) {
  return new Promise((resolve) => {
    const url = 'https://www.amazon.com/s?k=' + encodeURIComponent(query);
    const ua = USER_AGENTS[uaIndex++ % USER_AGENTS.length];
    const opts = {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'close',
      },
      timeout: 20000,
    };
    
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };
    
    const handleResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http') ? res.headers.location : 'https://www.amazon.com' + res.headers.location;
        https.get(redirectUrl, opts, handleResponse).on('error', () => done(null));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (data.includes('captcha') || data.includes('CAPTCHA') || data.includes('robot check')) {
          done('CAPTCHA');
          return;
        }
        const asins = [...new Set([...data.matchAll(/\/dp\/([A-Z0-9]{10})/g)].map(m => m[1]))];
        done(asins.length > 0 ? asins[0] : null);
      });
    };
    
    https.get(url, opts, handleResponse).on('error', () => done(null));
    setTimeout(() => done(null), 25000);
  });
}

// Find ASIN with cache and retry logic
async function findASIN(query) {
  if (asinCache[query]) return asinCache[query];
  if (failedLookups[query] && Date.now() - failedLookups[query] < 7 * 86400000) return null;
  
  let asin = await searchAmazonForASIN(query);
  
  // If captcha, back off and signal caller
  if (asin === 'CAPTCHA') {
    console.log('  ⚠️ CAPTCHA detected — pausing 30s...');
    await sleep(30000);
    asin = await searchAmazonForASIN(query);
    if (asin === 'CAPTCHA') {
      console.log('  ⚠️ CAPTCHA again — stopping lookups for this run');
      return 'STOP';
    }
  }
  
  if (asin && asin !== 'STOP') {
    asinCache[query] = asin;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(asinCache, null, 2));
    return asin;
  }
  
  failedLookups[query] = Date.now();
  fs.writeFileSync(FAILED_FILE, JSON.stringify(failedLookups, null, 2));
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Amazon Search Link → Product Link Converter ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : CACHE_ONLY ? 'CACHE ONLY' : REPLACE_ONLY ? 'REPLACE ONLY' : 'FULL RUN'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Cached ASINs: ${Object.keys(asinCache).length}`);
  console.log('');
  
  // Phase 1: Collect all search queries
  console.log('Phase 1: Scanning all sites for search links...');
  const queries = getAllSearchQueries();
  console.log(`Found ${queries.size} unique search queries across ${[...queries.values()].reduce((a,b) => a + b.length, 0)} links`);
  
  const needLookup = [...queries.keys()].filter(q => !asinCache[q] && !(failedLookups[q] && Date.now() - failedLookups[q] < 7*86400000));
  const alreadyCached = [...queries.keys()].filter(q => asinCache[q]);
  console.log(`  Already cached: ${alreadyCached.length}`);
  console.log(`  Need lookup: ${needLookup.length}`);
  console.log(`  Will look up: ${Math.min(needLookup.length, BATCH_SIZE)} this run`);
  console.log('');
  
  // Phase 2: Look up ASINs
  if (!REPLACE_ONLY) {
    const toLookup = needLookup.slice(0, BATCH_SIZE);
    let found = 0, missed = 0;
    
    for (let i = 0; i < toLookup.length; i++) {
      const query = toLookup[i];
      const asin = await findASIN(query);
      if (asin === 'STOP') {
        console.log(`  🛑 CAPTCHA block — stopping lookups. Will resume next run.`);
        break;
      } else if (asin) {
        found++;
        console.log(`  ✅ [${i+1}/${toLookup.length}] "${query}" → ${asin}`);
      } else {
        missed++;
        console.log(`  ❌ [${i+1}/${toLookup.length}] "${query}" → not found`);
      }
      
      // Rate limit: 1 request per 3 seconds to avoid captcha
      if (i < toLookup.length - 1) await sleep(3000);
      
      // Longer pause every 50 requests
      if (i > 0 && i % 50 === 0) {
        console.log(`  ⏸  Pausing 15s (rate limit cooldown)...`);
        await sleep(15000);
      }
      
      // Save cache periodically
      if (i % 10 === 0) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(asinCache, null, 2));
      }
    }
    
    console.log(`\nLookup complete: ${found} found, ${missed} missed`);
    console.log(`Total cached ASINs: ${Object.keys(asinCache).length}`);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(asinCache, null, 2));
    fs.writeFileSync(FAILED_FILE, JSON.stringify(failedLookups, null, 2));
  }
  
  if (CACHE_ONLY) {
    console.log('\nCache-only mode — skipping replacements.');
    return;
  }
  
  // Phase 3: Replace links in HTML files
  console.log('\nPhase 3: Replacing search links with product links...');
  let replacedLinks = 0;
  let replacedFiles = 0;
  let replacedSites = new Set();
  const sitesToPush = new Set();
  
  for (const [query, locations] of queries) {
    const asin = asinCache[query];
    if (!asin) continue;
    
    for (const { site, file, fullUrl, tag } of locations) {
      const filePath = path.join(SITES_DIR, site, file);
      let html;
      try { html = fs.readFileSync(filePath, 'utf8'); } catch(e) { continue; }
      
      // Build the new direct product URL
      const newUrl = `https://www.amazon.com/dp/${asin}?tag=${tag}`;
      
      // Replace the specific search URL
      const escapedUrl = fullUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const newHtml = html.replace(new RegExp(escapedUrl, 'g'), newUrl);
      
      if (newHtml !== html) {
        if (!DRY_RUN) {
          fs.writeFileSync(filePath, newHtml);
        }
        replacedLinks++;
        replacedSites.add(site);
        sitesToPush.add(site);
      }
    }
  }
  
  console.log(`Replaced ${replacedLinks} links across ${replacedSites.size} sites`);
  
  if (DRY_RUN) {
    console.log('DRY RUN — no files modified, no pushes.');
    return;
  }
  
  // Phase 4: Commit and push
  console.log(`\nPhase 4: Committing and pushing ${sitesToPush.size} sites...`);
  let pushed = 0, pushErrors = 0;
  
  for (const site of sitesToPush) {
    const siteDir = path.join(SITES_DIR, site);
    try {
      const remote = execSync(`cd "${siteDir}" && git remote get-url origin`, {encoding:'utf8'}).trim();
      const repo = remote.match(/([^/]+?)(?:\.git)?$/)?.[1] || site;
      execSync(`cd "${siteDir}" && git remote set-url origin https://x-access-token:${TOKEN}@github.com/${ORG}/${repo}.git`, {stdio:'pipe'});
      execSync(`cd "${siteDir}" && git config user.email "axl@openclaw.ai" && git config user.name "Axl"`, {stdio:'pipe'});
      try { execSync(`cd "${siteDir}" && git checkout main --quiet 2>/dev/null || git checkout -b main --quiet`, {stdio:'pipe'}); } catch(e) {}
      try {
        execSync(`cd "${siteDir}" && git fetch origin main --quiet`, {stdio:'pipe', timeout:15000});
        execSync(`cd "${siteDir}" && git merge origin/main --no-edit --quiet -X ours`, {stdio:'pipe', timeout:10000});
      } catch(e) {
        try { execSync(`cd "${siteDir}" && git reset --hard origin/main`, {stdio:'pipe'}); } catch(e2) {}
      }
      execSync(`cd "${siteDir}" && git add -A && git commit -m "Convert search links to direct product links" --quiet`, {stdio:'pipe'});
      execSync(`cd "${siteDir}" && git push -u origin main --quiet 2>&1`, {stdio:'pipe', timeout:20000});
      pushed++;
    } catch(e) {
      pushErrors++;
      console.error(`  Push failed: ${site} — ${e.message.substring(0, 80)}`);
    }
    
    if (pushed % 20 === 0 && pushed > 0) console.log(`  Push progress: ${pushed}/${sitesToPush.size}`);
  }
  
  // Save report
  const report = {
    date: new Date().toISOString(),
    totalQueries: queries.size,
    cachedASINs: Object.keys(asinCache).length,
    failedLookups: Object.keys(failedLookups).length,
    replacedLinks,
    replacedSites: replacedSites.size,
    pushed,
    pushErrors,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  
  console.log(`\n========================================`);
  console.log(`  Link Conversion Report — ${new Date().toISOString().split('T')[0]}`);
  console.log(`  Queries: ${queries.size} unique`);
  console.log(`  ASINs cached: ${Object.keys(asinCache).length}`);
  console.log(`  Links replaced: ${replacedLinks}`);
  console.log(`  Sites updated: ${replacedSites.size}`);
  console.log(`  Pushed: ${pushed} | Errors: ${pushErrors}`);
  console.log(`========================================`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
