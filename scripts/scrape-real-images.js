#!/usr/bin/env node
/**
 * SCRAPE REAL IMAGES FROM PRODUCT PAGES
 * 
 * For each Amazon link on each site:
 * 1. Visit the actual product page
 * 2. Extract the real product image
 * 3. Update the HTML with that image
 * 4. Push to GitHub
 * 
 * Simple. Direct. Uses the links we already have.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/home/ubuntu/.openclaw/workspace';

async function getProductImage(url) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
    
    // Extract main product image
    const imageUrl = await page.evaluate(() => {
      const img = document.querySelector('img[data-a-image-name="landingImage"]') ||
                  document.querySelector('#landingImage') ||
                  document.querySelector('#imgBlkFront');
      return img ? img.src : null;
    });
    
    await browser.close();
    return imageUrl;
  } catch(e) {
    await browser.close();
    return null;
  }
}

async function processSite(sitePath) {
  const siteName = path.basename(sitePath);
  const indexPath = path.join(sitePath, 'index.html');
  
  if (!fs.existsSync(indexPath)) return;
  
  let html = fs.readFileSync(indexPath, 'utf8');
  let modified = false;
  
  // Find all Amazon product links
  const linkMatches = [...html.matchAll(/href="(https?:\/\/(?:www\.)?amazon\.com\/dp\/([A-Z0-9]{10})[^"]*)"/g)];
  
  console.log(`\n📦 ${siteName} - Found ${linkMatches.length} product links`);
  
  for (const match of linkMatches.slice(0, 5)) { // Top 5 products per site
    const fullUrl = match[1];
    const asin = match[2];
    
    console.log(`  🔍 Fetching image for ASIN ${asin}...`);
    
    const imageUrl = await getProductImage(fullUrl);
    
    if (!imageUrl) {
      console.log(`  ❌ No image found`);
      continue;
    }
    
    console.log(`  ✅ Got image: ${imageUrl.substring(0, 60)}...`);
    
    // Find the section containing this link and add image before the heading
    const linkIndex = html.indexOf(fullUrl);
    if (linkIndex === -1) continue;
    
    // Look backwards for the start of this card/section
    const beforeLink = html.substring(Math.max(0, linkIndex - 2000), linkIndex);
    const cardMatch = beforeLink.match(/<div[^>]*class="[^"]*(?:cat-card|product-card|card|cd)[^"]*"[^>]*>[\s\S]*$/);
    
    if (cardMatch) {
      const cardStart = linkIndex - 2000 + cardMatch.index;
      const cardHtml = html.substring(cardStart, linkIndex + 500);
      
      // Skip if already has image
      if (cardHtml.includes('<img')) {
        console.log(`  ⏭️  Already has image`);
        continue;
      }
      
      // Find h2 or h3 and insert image before it
      const headingMatch = cardHtml.match(/<h[23][^>]*>/);
      if (headingMatch) {
        const headingPos = cardStart + headingMatch.index;
        const imageTag = `\n<img src="${imageUrl}" alt="Product" style="width:100%;max-width:400px;height:auto;margin-bottom:1rem;border-radius:8px;" loading="lazy">\n`;
        html = html.slice(0, headingPos) + imageTag + html.slice(headingPos);
        modified = true;
        console.log(`  ✅ Image added`);
      }
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }
  
  if (modified) {
    fs.writeFileSync(indexPath, html);
    console.log(`  💾 Saved changes`);
    
    try {
      execSync(
        `cd "${sitePath}" && git add index.html && git commit -m "Add real product images" && git push`,
        { stdio: 'ignore', timeout: 30000 }
      );
      console.log(`  🚀 Pushed to GitHub`);
      return true;
    } catch(e) {
      console.log(`  ⚠️  Git push failed`);
      return false;
    }
  }
  
  return false;
}

(async () => {
  console.log('=== SCRAPING REAL PRODUCT IMAGES ===\n');
  
  // Find top 20 sites to fix first
  const topSites = [
    'bestfirestick.com',
    'bestinstantpot.com',
    'bestcordlesstools.com',
    'bestgarageorganizer.com',
    'cybertruckseats.com',
    'broncograbhandles.com'
  ];
  
  let processed = 0;
  let pushed = 0;
  
  for (const site of topSites) {
    const sitePath = path.join(WORKSPACE, 'tmp', site);
    if (!fs.existsSync(sitePath)) {
      console.log(`⏭️  ${site} - not found`);
      continue;
    }
    
    const success = await processSite(sitePath);
    processed++;
    if (success) pushed++;
  }
  
  console.log(`\n=== RESULTS ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Pushed: ${pushed}`);
  console.log(`\n✅ DONE!\n`);
})();
