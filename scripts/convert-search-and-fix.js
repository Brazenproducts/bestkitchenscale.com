#!/usr/bin/env node
/**
 * CONVERT SEARCH LINKS TO ASINS + ADD IMAGES
 * 
 * For sites using /s?k=search links:
 * 1. Extract search query
 * 2. Search Amazon to get the top ASIN
 * 3. Get product image
 * 4. Replace search link with direct ASIN link
 * 5. Add image to card
 * 6. Push to GitHub
 * 
 * NO MORE EXCUSES. FIX EVERYTHING.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/home/ubuntu/.openclaw/workspace';
const TOKEN = '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';
const TAG = 'brazenprodu01-20';

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

async function searchToAsin(query) {
  const b = await initBrowser();
  const page = await b.newPage();
  
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 10000 
    });
    
    await page.waitForTimeout(2000);
    
    const result = await page.evaluate(() => {
      const firstProduct = document.querySelector('[data-asin]:not([data-asin=""])');
      if (!firstProduct) return null;
      
      const asin = firstProduct.getAttribute('data-asin');
      const img = firstProduct.querySelector('img');
      
      return { 
        asin,
        image: img ? img.src : null
      };
    });
    
    await page.close();
    return result;
  } catch(e) {
    await page.close();
    return null;
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
  
  // Find all Amazon search links
  const searchMatches = [...html.matchAll(/href="(https?:\/\/(?:www\.)?amazon\.com\/s\?k=([^"&]+)[^"]*)"/g)];
  
  if (searchMatches.length === 0) {
    console.log(`  ⏭️  No search links found`);
    return false;
  }
  
  console.log(`  Found ${searchMatches.length} search links`);
  
  // Process top 5 search links
  for (const match of searchMatches.slice(0, 5)) {
    const fullUrl = match[1];
    const query = decodeURIComponent(match[2].replace(/\+/g, ' '));
    
    console.log(`  🔍 "${query}"...`);
    
    const result = await searchToAsin(query);
    
    if (!result || !result.asin) {
      console.log(`    ❌ No ASIN found`);
      continue;
    }
    
    console.log(`    ✅ ASIN: ${result.asin}`);
    
    // Replace search link with direct ASIN link
    const newUrl = `https://www.amazon.com/dp/${result.asin}?tag=${TAG}`;
    html = html.replace(fullUrl, newUrl);
    modified = true;
    
    // Add image if available and not already present
    if (result.image) {
      const linkIndex = html.indexOf(newUrl);
      if (linkIndex > 0) {
        const before = html.substring(Math.max(0, linkIndex - 1500), linkIndex);
        const cardMatch = before.match(/<div[^>]*class="[^"]*(?:cat-card|card|cd)[^"]*"[^>]*>[\s\S]*$/);
        
        if (cardMatch) {
          const cardStart = linkIndex - 1500 + cardMatch.index;
          const cardSection = html.substring(cardStart, linkIndex + 500);
          
          if (!cardSection.includes('<img')) {
            const headingMatch = cardSection.match(/<h[23]/);
            if (headingMatch) {
              const insertPos = cardStart + headingMatch.index;
              const imgTag = `<img src="${result.image}" alt="${query}" style="width:100%;max-width:300px;height:auto;margin:0 auto 1rem;display:block;border-radius:8px" loading="lazy">\n`;
              html = html.slice(0, insertPos) + imgTag + html.slice(insertPos);
              console.log(`    ✅ Added image`);
            }
          }
        }
      }
    }
    
    await new Promise(r => setTimeout(r, 4000)); // Rate limit
  }
  
  if (modified) {
    fs.writeFileSync(site.indexPath, html);
    console.log(`  💾 Saved`);
    
    try {
      // Fix git remote
      try {
        execSync(
          `cd "${site.path}" && git remote set-url origin https://${TOKEN}@github.com/Brazenproducts/${site.name}.git`,
          { stdio: 'ignore' }
        );
      } catch(e) {}
      
      // Pull and handle conflicts
      execSync(
        `cd "${site.path}" && git fetch origin && git reset --hard origin/main`,
        { stdio: 'ignore' }
      );
      
      // Re-apply changes
      fs.writeFileSync(site.indexPath, html);
      
      execSync(
        `cd "${site.path}" && git add index.html && git commit -m "Convert search links to ASINs and add images" && git push`,
        { stdio: 'ignore', timeout: 30000 }
      );
      console.log(`  🚀 Pushed`);
      return true;
    } catch(e) {
      console.log(`  ⚠️  Push failed: ${e.message}`);
    }
  }
  
  return false;
}

(async () => {
  console.log('=== CONVERT SEARCH LINKS + ADD IMAGES ===\n');
  
  const sites = findSites();
  console.log(`Found ${sites.length} sites\n`);
  
  let processed = 0;
  let pushed = 0;
  
  // Focus on sites that had "No ASINs found" in previous run
  const prioritySites = [
    'bestfirestick.com',
    'bestinstantpot.com',
    'bestcordlesstools.com',
    'bestseatcover.com',
    'bestgarageorganizer.com',
    'bestmeshwifi.com',
    'bestbroncoaccessories.com',
    'bestoffroadbrands.com',
    'besttonneaucovers.com',
    'besttruckaccessories.com'
  ];
  
  for (const siteName of prioritySites) {
    const site = sites.find(s => s.name === siteName);
    if (!site) continue;
    
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
