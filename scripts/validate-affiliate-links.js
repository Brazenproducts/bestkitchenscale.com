#!/usr/bin/env node
/**
 * validate-affiliate-links.js — Daily link health checker
 * 
 * Checks that:
 * 1. All Amazon links have valid affiliate tags
 * 2. Direct product links (/dp/ASIN) return 200 (not 404)
 * 3. No broken search links remain that could be converted
 * 4. Amazon Associates disclosure is present on all pages with affiliate links
 * 
 * Usage: node scripts/validate-affiliate-links.js [--fix] [--sample 50]
 * 
 * --fix: Attempt to fix issues (re-run converter for unconverted links)
 * --sample N: Only check N random product links for liveness (default 100)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SITES_DIR = '/home/ubuntu/.openclaw/workspace/sites';
const CACHE_FILE = '/home/ubuntu/.openclaw/workspace/memory/asin-cache.json';
const REPORT_DIR = '/home/ubuntu/.openclaw/workspace/memory';
const SAMPLE_SIZE = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--sample') || '100');
const FIX_MODE = process.argv.includes('--fix');

const VALID_TAGS = [
  'brazenprodu01-20','brazenprodu01-20-recipsaw-20','brazenprodu01-20-pastamaker-20',
  'brazenprodu01-20-dutchoven-20','brazenprodu01-20-sousvide-20','brazenprodu01-20-tireinflator-20',
  'brazenprodu01-20-headlight-20','brazenprodu01-20-tirepatch-20','brazenprodu01-20-towingstrap-20',
  'brazenprodu01-20-showerhead-20','brazenprodu01-20-labelmaker-20','brazenprodu01-20-powerbank-20',
  'brazenprodu01-20-portableac-20','brazenprodu01-20-icemaker-20','brazenprodu01-20-gamingchair-20',
  'brazenprodu01-20-massagegun-20','brazenprodu01-20-minifridge-20','brazenprodu01-20-protein-20',
  'brazenprodu01-20-resistance-20','brazenprodu01-20-vibration-20','brazenprodu01-20-heatingpad-20',
  'brazenprodu01-20-charger-20','brazenprodu01-20-necklift-20','brazenprodu01-20-magnesium-20'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function checkProductLink(url) {
  return new Promise((resolve) => {
    // Just check if Amazon returns a valid product page (not 404/redirect to search)
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        // Check if redirected to search or dog page (dead product)
        const isDead = data.includes('Page Not Found') || 
                       data.includes("we couldn't find") ||
                       data.includes('currently unavailable and we don');
        resolve({ 
          status: res.statusCode, 
          alive: res.statusCode === 200 && !isDead,
          unavailable: data.includes('currently unavailable')
        });
      });
    }).on('error', () => resolve({ status: 0, alive: false }));
    setTimeout(() => resolve({ status: 0, alive: false }), 15000);
  });
}

async function main() {
  const dateStr = new Date().toISOString().split('T')[0];
  console.log(`=== Affiliate Link Validator — ${dateStr} ===\n`);
  
  let totalLinks = 0;
  let searchLinks = 0;
  let productLinks = 0;
  let invalidTags = [];
  let missingTags = [];
  let missingDisclosure = [];
  let allProductUrls = [];
  let totalSites = 0;
  let sitesWithLinks = 0;
  
  // Scan all sites
  for (const site of fs.readdirSync(SITES_DIR).sort()) {
    const siteDir = path.join(SITES_DIR, site);
    if (!fs.statSync(siteDir).isDirectory()) continue;
    totalSites++;
    
    let siteHasLinks = false;
    let siteHasDisclosure = false;
    
    for (const f of fs.readdirSync(siteDir)) {
      if (!f.endsWith('.html')) continue;
      let html;
      try { html = fs.readFileSync(path.join(siteDir, f), 'utf8'); } catch(e) { continue; }
      
      // Check disclosure
      if (/amazon\s+associate.*earn.*qualifying\s+purchases/i.test(html)) {
        siteHasDisclosure = true;
      }
      
      // Check all Amazon links
      const hrefs = [...html.matchAll(/href="([^"]+amazon\.com[^"]+)"/g)];
      for (const [, href] of hrefs) {
        totalLinks++;
        siteHasLinks = true;
        
        // Check tag
        const tagMatch = href.match(/tag=([a-zA-Z0-9_-]+)/);
        if (!tagMatch) {
          missingTags.push({ site, file: f, url: href.substring(0, 100) });
        } else if (!VALID_TAGS.includes(tagMatch[1])) {
          invalidTags.push({ site, file: f, tag: tagMatch[1] });
        }
        
        // Categorize link type
        if (/\/s\?/.test(href) && /[?&]k=/.test(href)) {
          searchLinks++;
        } else if (/\/dp\/[A-Z0-9]{10}/.test(href)) {
          productLinks++;
          allProductUrls.push(href);
        }
      }
    }
    
    if (siteHasLinks) {
      sitesWithLinks++;
      if (!siteHasDisclosure) {
        missingDisclosure.push(site);
      }
    }
  }
  
  // Report: Tag validation
  console.log(`--- Tag Validation ---`);
  console.log(`Total sites: ${totalSites} | With links: ${sitesWithLinks}`);
  console.log(`Total Amazon links: ${totalLinks}`);
  console.log(`  Product links (/dp/): ${productLinks} (${(productLinks/totalLinks*100).toFixed(1)}%)`);
  console.log(`  Search links (/s?k=): ${searchLinks} (${(searchLinks/totalLinks*100).toFixed(1)}%)`);
  console.log(`  Other: ${totalLinks - productLinks - searchLinks}`);
  
  if (invalidTags.length > 0) {
    console.log(`\n⚠️  INVALID TAGS (${invalidTags.length}):`);
    invalidTags.forEach(t => console.log(`  ${t.site}/${t.file}: tag=${t.tag}`));
  } else {
    console.log(`\n✅ All tags valid`);
  }
  
  if (missingTags.length > 0) {
    console.log(`\n⚠️  MISSING TAGS (${missingTags.length}):`);
    missingTags.slice(0, 10).forEach(t => console.log(`  ${t.site}/${t.file}: ${t.url}`));
  } else {
    console.log(`✅ All links have tags`);
  }
  
  if (missingDisclosure.length > 0) {
    console.log(`\n⚠️  MISSING DISCLOSURE (${missingDisclosure.length}):`);
    missingDisclosure.slice(0, 10).forEach(s => console.log(`  ${s}`));
  } else {
    console.log(`✅ All sites have Amazon Associates disclosure`);
  }
  
  // Spot-check product links for liveness
  console.log(`\n--- Product Link Liveness Check (sample ${Math.min(SAMPLE_SIZE, allProductUrls.length)}) ---`);
  const sample = allProductUrls.sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
  let alive = 0, dead = 0, unavailable = 0, timeout = 0;
  
  for (let i = 0; i < sample.length; i++) {
    const url = sample[i];
    const result = await checkProductLink(url);
    if (result.alive) alive++;
    else if (result.unavailable) unavailable++;
    else if (result.status === 0) timeout++;
    else dead++;
    
    if (!result.alive && result.status > 0) {
      const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
      console.log(`  ❌ ${asinMatch ? asinMatch[1] : 'unknown'}: status=${result.status} unavailable=${result.unavailable}`);
    }
    
    if (i % 20 === 0 && i > 0) console.log(`  Checked ${i}/${sample.length}...`);
    await sleep(1500);
  }
  
  console.log(`\nResults: ${alive} alive, ${dead} dead, ${unavailable} unavailable, ${timeout} timeout`);
  const healthPct = ((alive / sample.length) * 100).toFixed(1);
  console.log(`Link health: ${healthPct}%`);
  
  // Save report
  const report = {
    date: dateStr,
    totalSites,
    sitesWithLinks,
    totalLinks,
    productLinks,
    searchLinks,
    invalidTags: invalidTags.length,
    missingTags: missingTags.length,
    missingDisclosure: missingDisclosure.length,
    linkHealth: { checked: sample.length, alive, dead, unavailable, timeout, pct: parseFloat(healthPct) },
  };
  fs.writeFileSync(path.join(REPORT_DIR, `link-validation-${dateStr}.json`), JSON.stringify(report, null, 2));
  
  console.log(`\n========================================`);
  console.log(`  Affiliate Link Validation — ${dateStr}`);
  console.log(`  Tags: ${invalidTags.length === 0 ? '✅ All valid' : `❌ ${invalidTags.length} invalid`}`);
  console.log(`  Disclosure: ${missingDisclosure.length === 0 ? '✅ All present' : `❌ ${missingDisclosure.length} missing`}`);
  console.log(`  Product links: ${productLinks} (${(productLinks/totalLinks*100).toFixed(1)}%)`);
  console.log(`  Search links remaining: ${searchLinks}`);
  console.log(`  Link health: ${healthPct}%`);
  console.log(`========================================`);
  
  // Exit with error if critical issues found
  if (invalidTags.length > 0 || missingDisclosure.length > 0) {
    process.exit(1);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
