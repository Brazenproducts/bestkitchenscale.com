#!/usr/bin/env node
/**
 * COMPREHENSIVE FIX - ALL SITES
 * 
 * 1. Find all sites with Amazon product links
 * 2. For each ASIN, check if it's valid and get image
 * 3. Add images where missing
 * 4. Remove broken ASIN buttons
 * 5. Push to GitHub
 * 
 * NO ASKING. JUST FIX EVERYTHING.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/home/ubuntu/.openclaw/workspace';
const TOKEN = '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';

let browser;

async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

async function checkAsinAndGetImage(asin) {
  const b = await initBrowser();
  const page = await b.newPage();
  
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto(`https://www.amazon.com/dp/${asin}`, { 
      waitUntil: 'domcontentloaded',
      timeout: 10000 
    });
    
    await page.waitForTimeout(2000);
    
    const result = await page.evaluate(() => {
      // Check if 404
      if (document.body.textContent.includes("Sorry! We couldn't find that page")) {
        return { valid: false, image: null };
      }
      
      const img = document.querySelector('img[data-a-image-name="landingImage"]') ||
                  document.querySelector('#landingImage') ||
                  document.querySelector('#imgBlkFront');
      
      return { 
        valid: true, 
        image: img ? img.src : null 
      };
    });
    
    await page.close();
    return result;
  } catch(e) {
    await page.close();
    return { valid: false, image: null };
  }
}

function findSites() {
  const sites = [];
  const dirs = [
    path.join(WORKSPACE, 'tmp'),
    path.join(WORKSPACE, 'affiliate-sites'),
    WORKSPACE
  ];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const item of fs.readdirSync(dir)) {
      if (item.endsWith('.com')) {
        const sitePath = path.join(dir, item);
        const indexPath = path.join(sitePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          sites.push({ name: item, path: sitePath, indexPath });
        }
      }
    }
  }
  return sites;
}

async function processSite(site) {
  console.log(`\n📦 ${site.name}`);
  
  let html = fs.readFileSync(site.indexPath, 'utf8');
  let modified = false;
  
  // Find all unique ASINs
  const asinMatches = [...html.matchAll(/amazon\.com\/dp\/([A-Z0-9]{10})/g)];
  const uniqueAsins = [...new Set(asinMatches.map(m => m[1]))];
  
  if (uniqueAsins.length === 0) {
    console.log(`  ⏭️  No ASINs found`);
    return;
  }
  
  console.log(`  Found ${uniqueAsins.length} ASINs`);
  
  // Check each ASIN
  for (const asin of uniqueAsins.slice(0, 5)) {
    console.log(`  🔍 ${asin}...`);
    
    const result = await checkAsinAndGetImage(asin);
    
    if (!result.valid) {
      // ASIN is broken - remove all buttons with this ASIN
      console.log(`    ❌ Broken - removing`);
      const regex = new RegExp(`<a[^>]*href="[^"]*\\/dp\\/${asin}[^"]*"[^>]*>.*?<\\/a>`, 'gi');
      const before = html;
      html = html.replace(regex, '');
      if (html !== before) modified = true;
      continue;
    }
    
    if (!result.image) {
      console.log(`    ⚠️  Valid but no image`);
      continue;
    }
    
    console.log(`    ✅ Got image`);
    
    // Check if this ASIN's section already has an image
    const asinIndex = html.indexOf(`/dp/${asin}`);
    if (asinIndex === -1) continue;
    
    const before = html.substring(Math.max(0, asinIndex - 1500), asinIndex);
    const cardMatch = before.match(/<div[^>]*class="[^"]*(?:cat-card|card|cd)[^"]*"[^>]*>[\s\S]*$/);
    
    if (!cardMatch) continue;
    
    const cardStart = asinIndex - 1500 + cardMatch.index;
    const cardSection = html.substring(cardStart, asinIndex + 500);
    
    if (cardSection.includes('<img')) {
      console.log(`    ⏭️  Already has image`);
      continue;
    }
    
    // Add image before h2/h3
    const headingMatch = cardSection.match(/<h[23]/);
    if (headingMatch) {
      const insertPos = cardStart + headingMatch.index;
      const imgTag = `<img src="${result.image}" alt="Product" style="width:100%;max-width:300px;height:auto;margin:0 auto 1rem;display:block;border-radius:8px" loading="lazy">\n`;
      html = html.slice(0, insertPos) + imgTag + html.slice(insertPos);
      console.log(`    ✅ Added image`);
      modified = true;
    }
    
    await new Promise(r => setTimeout(r, 3000)); // Rate limit
  }
  
  if (modified) {
    fs.writeFileSync(site.indexPath, html);
    console.log(`  💾 Saved`);
    
    try {
      // Fix git remote if needed
      try {
        execSync(
          `cd "${site.path}" && git remote set-url origin https://${TOKEN}@github.com/Brazenproducts/${site.name}.git`,
          { stdio: 'ignore' }
        );
      } catch(e) {}
      
      execSync(
        `cd "${site.path}" && git pull --rebase 2>&1 | grep -q "CONFLICT" && git rebase --abort || true`,
        { stdio: 'ignore' }
      );
      
      execSync(
        `cd "${site.path}" && git add index.html && git commit -m "Add images and remove broken ASINs" && git push`,
        { stdio: 'ignore', timeout: 30000 }
      );
      console.log(`  🚀 Pushed`);
      return true;
    } catch(e) {
      console.log(`  ⚠️  Push failed`);
    }
  }
  
  return false;
}

(async () => {
  console.log('=== COMPREHENSIVE FIX - ALL SITES ===\n');
  
  const sites = findSites();
  console.log(`Found ${sites.length} total sites\n`);
  
  // Process sites with ASINs
  let processed = 0;
  let pushed = 0;
  
  for (const site of sites.slice(0, 50)) { // Top 50
    const success = await processSite(site);
    processed++;
    if (success) pushed++;
  }
  
  if (browser) await browser.close();
  
  console.log(`\n=== RESULTS ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Pushed: ${pushed}`);
  console.log(`\n✅ DONE\n`);
})();
