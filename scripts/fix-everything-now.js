#!/usr/bin/env node
/**
 * FIX EVERYTHING NOW
 * 
 * 1. Fix all broken ASINs (B0BT6M3CM7 → B0BP9SNVH9)
 * 2. Scrape real images from Amazon for each product
 * 3. Add images to sites
 * 4. Push to GitHub
 * 
 * NO EXCUSES. JUST WORK.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/home/ubuntu/.openclaw/workspace';
const TOKEN = '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';

// Find all site directories
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

async function getImageFromAmazon(asin) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(`https://www.amazon.com/dp/${asin}`, { 
      waitUntil: 'domcontentloaded',
      timeout: 10000 
    });
    
    await page.waitForTimeout(2000);
    
    const imageUrl = await page.evaluate(() => {
      const img = document.querySelector('img[data-a-image-name="landingImage"]') ||
                  document.querySelector('#landingImage') ||
                  document.querySelector('#imgBlkFront') ||
                  document.querySelector('img[data-old-hires]');
      return img ? (img.getAttribute('data-old-hires') || img.src) : null;
    });
    
    await browser.close();
    return imageUrl;
  } catch(e) {
    await browser.close();
    return null;
  }
}

async function processSite(site) {
  console.log(`\n📦 ${site.name}`);
  
  let html = fs.readFileSync(site.indexPath, 'utf8');
  let modified = false;
  
  // Step 1: Fix broken ASINs
  if (html.includes('B0BT6M3CM7')) {
    html = html.replace(/B0BT6M3CM7/g, 'B0BP9SNVH9');
    console.log(`  ✅ Fixed broken ASIN`);
    modified = true;
  }
  
  // Step 2: Find all Amazon ASIN links
  const asinMatches = [...html.matchAll(/amazon\.com\/dp\/([A-Z0-9]{10})/g)];
  const uniqueAsins = [...new Set(asinMatches.map(m => m[1]))];
  
  console.log(`  Found ${uniqueAsins.length} unique products`);
  
  // Step 3: Get images for each ASIN
  for (const asin of uniqueAsins.slice(0, 5)) { // Top 5 per site
    console.log(`  🔍 ASIN ${asin}...`);
    
    // Check if already has image for this product
    const asinContext = html.match(new RegExp(`[\\s\\S]{0,500}amazon\\.com\\/dp\\/${asin}[\\s\\S]{0,500}`, 'i'));
    if (asinContext && asinContext[0].includes('<img')) {
      console.log(`    ⏭️  Already has image`);
      continue;
    }
    
    const imageUrl = await getImageFromAmazon(asin);
    
    if (!imageUrl) {
      console.log(`    ❌ No image`);
      continue;
    }
    
    console.log(`    ✅ Got image`);
    
    // Find where this ASIN appears and add image
    const asinIndex = html.indexOf(`/dp/${asin}`);
    if (asinIndex > 0) {
      // Look backwards for card start
      const before = html.substring(Math.max(0, asinIndex - 1500), asinIndex);
      const cardMatch = before.match(/<div[^>]*class="[^"]*(?:cat-card|card|cd)[^"]*"[^>]*>[\s\S]*$/);
      
      if (cardMatch) {
        const cardStart = asinIndex - 1500 + cardMatch.index;
        const cardSection = html.substring(cardStart, asinIndex + 500);
        const h2Match = cardSection.match(/<h[23]/);
        
        if (h2Match && !cardSection.includes('<img')) {
          const insertPos = cardStart + h2Match.index;
          const imgTag = `<img src="${imageUrl}" alt="Product" style="width:100%;max-width:350px;height:auto;margin:0 auto 1rem;display:block;border-radius:8px" loading="lazy">\n`;
          html = html.slice(0, insertPos) + imgTag + html.slice(insertPos);
          console.log(`    ✅ Added to page`);
          modified = true;
        }
      }
    }
    
    await new Promise(r => setTimeout(r, 3000)); // Rate limit
  }
  
  if (modified) {
    fs.writeFileSync(site.indexPath, html);
    console.log(`  💾 Saved`);
    
    try {
      execSync(
        `cd "${site.path}" && git add index.html && git commit -m "Fix ASINs and add product images" && git push`,
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
  console.log('=== FIXING EVERYTHING NOW ===\n');
  
  const sites = findSites();
  console.log(`Found ${sites.length} sites\n`);
  
  // Process top priority sites
  const priority = [
    'bestfirestick.com',
    'bestinstantpot.com', 
    'bestcordlesstools.com',
    'cybertruckseats.com',
    'bestseatcover.com',
    'besttruckaccessories.com',
    'bestcarwashkits.com',
    'besttonneaucovers.com',
    'bestgarageorganizer.com',
    'bestdutchoven.com'
  ];
  
  let fixed = 0;
  
  for (const name of priority) {
    const site = sites.find(s => s.name === name);
    if (site) {
      const success = await processSite(site);
      if (success) fixed++;
    }
  }
  
  console.log(`\n=== RESULTS ===`);
  console.log(`Fixed and pushed: ${fixed} sites`);
  console.log(`\n✅ DONE\n`);
})();
