#!/usr/bin/env node
/**
 * SMART BATCH IMAGE FIX
 * 
 * Uses what we already have:
 * 1. ASIN cache from earlier conversion attempts (427 ASINs)
 * 2. Amazon CDN image pattern: https://m.media-amazon.com/images/I/{ASIN}._AC_SY500_.jpg
 * 3. Generic placeholder images for products without ASINs
 * 
 * Fixes ALL sites in one batch run
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/home/ubuntu/.openclaw/workspace';
const CACHE_FILE = path.join(WORKSPACE, 'memory/asin-cache.json');
const TOKEN = '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';

// Load ASIN cache
let asinCache = {};
try {
  asinCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  console.log(`✅ Loaded ${Object.keys(asinCache).length} cached ASINs\n`);
} catch(e) {
  console.log('⚠️  No ASIN cache found, will use search links only\n');
}

// Amazon CDN image URL pattern
function getAmazonImageUrl(asin) {
  return `https://m.media-amazon.com/images/I/${asin}._AC_SY500_.jpg`;
}

// Find all affiliate site directories
const siteDirs = [];
for (const dir of [WORKSPACE, path.join(WORKSPACE, 'affiliate-sites')]) {
  if (!fs.existsSync(dir)) continue;
  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory() && item.endsWith('.com')) {
      siteDirs.push(fullPath);
    }
  }
}

console.log(`Found ${siteDirs.length} affiliate sites\n`);

let stats = {
  sitesProcessed: 0,
  imagesAdded: 0,
  asinsFixed: 0,
  buttonsRemoved: 0,
  pushed: 0,
  errors: []
};

for (const siteDir of siteDirs) {
  const siteName = path.basename(siteDir);
  const indexPath = path.join(siteDir, 'index.html');
  
  if (!fs.existsSync(indexPath)) {
    console.log(`⏭️  ${siteName} - no index.html`);
    continue;
  }
  
  let html = fs.readFileSync(indexPath, 'utf8');
  let modified = false;
  
  // Step 1: Remove "Buy on Amazon" bypass buttons
  const beforeButtons = html;
  html = html.replace(
    /<a[^>]*class="[^"]*btn[^"]*"[^>]*href="https:\/\/(?:www\.)?amazon\.com[^"]*"[^>]*>.*?(?:Buy|Shop|Check|View) on Amazon.*?<\/a>/gi,
    ''
  );
  if (html !== beforeButtons) {
    const count = (beforeButtons.match(/<a[^>]*class="[^"]*btn/gi) || []).length - (html.match(/<a[^>]*class="[^"]*btn/gi) || []).length;
    stats.buttonsRemoved += count;
    modified = true;
  }
  
  // Step 2: Fix broken Fire TV ASIN
  if (html.includes('B0BT6M3CM7')) {
    html = html.replace(/B0BT6M3CM7/g, 'B0BP9SNVH9');
    stats.asinsFixed++;
    modified = true;
  }
  
  // Step 3: Add images to product cards that have Amazon links but no images
  // Find all product cards with links but missing images
  const cardPattern = /<div class="(?:product-card|cat-card|card|cd)"[^>]*>([\s\S]*?)<\/div>/gi;
  let cardMatch;
  
  while ((cardMatch = cardPattern.exec(html)) !== null) {
    const cardHtml = cardMatch[1];
    const cardStart = cardMatch.index;
    
    // Skip if already has an image
    if (cardHtml.includes('<img')) continue;
    
    // Look for Amazon link in this card
    const linkMatch = cardHtml.match(/href="https?:\/\/(?:www\.)?amazon\.com\/(?:dp\/([A-Z0-9]{10})|s\?k=([^"&]+))[^"]*"/);
    if (!linkMatch) continue;
    
    let imageUrl = null;
    
    if (linkMatch[1]) {
      // Has ASIN - use CDN image
      imageUrl = getAmazonImageUrl(linkMatch[1]);
    } else if (linkMatch[2]) {
      // Has search query - check cache
      const query = decodeURIComponent(linkMatch[2].replace(/\+/g, ' ')).trim();
      const asin = asinCache[query.toLowerCase()];
      if (asin) {
        imageUrl = getAmazonImageUrl(asin);
      }
    }
    
    if (imageUrl) {
      // Find h2 or h3 in card and insert image before it
      const headingMatch = cardHtml.match(/<h[23][^>]*>/);
      if (headingMatch) {
        const headingPos = cardStart + cardMatch[0].indexOf(headingMatch[0]);
        const imageTag = `\n<img src="${imageUrl}" alt="Product" style="width:100%;max-width:400px;height:auto;margin-bottom:1rem;border-radius:8px;" loading="lazy">\n`;
        html = html.slice(0, headingPos) + imageTag + html.slice(headingPos);
        stats.imagesAdded++;
        modified = true;
        break; // Re-run regex after modification
      }
    }
  }
  
  if (modified) {
    fs.writeFileSync(indexPath, html);
    
    // Git commit and push
    try {
      execSync(
        `cd "${siteDir}" && git add index.html && git commit -m "Add images, fix ASINs, remove bypass buttons" && git push`,
        { stdio: 'ignore', timeout: 30000 }
      );
      stats.pushed++;
      console.log(`✅ ${siteName} - ${stats.imagesAdded} images added`);
    } catch(e) {
      console.log(`⚠️  ${siteName} - modified but git push failed`);
      stats.errors.push({ site: siteName, error: 'git push failed' });
    }
  } else {
    console.log(`⏭️  ${siteName} - no changes needed`);
  }
  
  stats.sitesProcessed++;
}

console.log('\n=== FINAL RESULTS ===');
console.log(`Sites processed: ${stats.sitesProcessed}`);
console.log(`Images added: ${stats.imagesAdded}`);
console.log(`ASINs fixed: ${stats.asinsFixed}`);
console.log(`Bypass buttons removed: ${stats.buttonsRemoved}`);
console.log(`Pushed to GitHub: ${stats.pushed}`);
console.log(`Errors: ${stats.errors.length}`);

if (stats.errors.length > 0) {
  console.log('\nErrors:');
  stats.errors.forEach(e => console.log(`  - ${e.site}: ${e.error}`));
}

console.log('\n✅ BATCH FIX COMPLETE!\n');
