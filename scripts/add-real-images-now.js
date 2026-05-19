#!/usr/bin/env node
/**
 * ADD REAL PRODUCT IMAGES TO AFFILIATE SITES
 * 
 * Strategy: Visit Amazon product pages with puppeteer, grab main product image,
 * inject into HTML product cards, push to GitHub.
 * 
 * Targets sites that have ASINs but no images.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/home/ubuntu/.openclaw/workspace';
const TOKEN = process.env.GH_TOKEN || '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';
const AFFILIATE_TAG = 'brazenprodu01-20';

// Image cache to avoid re-scraping same ASIN
const imageCache = {};
const CACHE_FILE = path.join(WORKSPACE, 'memory/asin-image-cache.json');

// Load existing cache
if (fs.existsSync(CACHE_FILE)) {
  try {
    Object.assign(imageCache, JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')));
    console.log(`Loaded ${Object.keys(imageCache).length} cached ASIN images`);
  } catch(e) {}
}

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(imageCache, null, 2));
}

// Find all site directories
function findSites() {
  const sites = [];
  const seen = new Set();
  const dirs = [
    path.join(WORKSPACE, 'tmp'),
    path.join(WORKSPACE, 'affiliate-sites'),
    path.join(WORKSPACE, 'sites'),
    WORKSPACE
  ];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const item of fs.readdirSync(dir)) {
      if (item.endsWith('.com') && !seen.has(item)) {
        const sitePath = path.join(dir, item);
        const indexPath = path.join(sitePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          seen.add(item);
          sites.push({ name: item, path: sitePath, indexPath });
        }
      }
    }
  }
  return sites;
}

// Extract ASINs from HTML
function extractASINs(html) {
  const matches = html.match(/amazon\.com\/dp\/([A-Z0-9]{10})/g) || [];
  const asins = new Set();
  for (const m of matches) {
    asins.add(m.replace('amazon.com/dp/', ''));
  }
  return [...asins];
}

// Check if site already has real images
function hasImages(html) {
  // Count actual product images (not logos/icons)
  const imgMatches = html.match(/<img[^>]+src="https:\/\/m\.media-amazon\.com[^"]+"/g) || [];
  return imgMatches.length;
}

// Scrape image from Amazon product page
async function scrapeImage(page, asin) {
  if (imageCache[asin]) {
    console.log(`    📦 Cache hit for ${asin}`);
    return imageCache[asin];
  }

  const url = `https://www.amazon.com/dp/${asin}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Wait a bit for images to load
    await new Promise(r => setTimeout(r, 2000));
    
    // Try multiple selectors for the main product image
    const imageUrl = await page.evaluate(() => {
      // Method 1: Main product image
      const mainImg = document.querySelector('#landingImage, #imgBlkFront, #main-image, .a-dynamic-image');
      if (mainImg) {
        // Check data-old-hires first (highest res)
        const hiRes = mainImg.getAttribute('data-old-hires');
        if (hiRes && hiRes.startsWith('http')) return hiRes;
        // Then src
        const src = mainImg.src;
        if (src && src.includes('images') && !src.includes('transparent-pixel') && !src.includes('spinner')) return src;
      }
      
      // Method 2: OG image meta tag
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) {
        const content = ogImg.getAttribute('content');
        if (content && content.startsWith('http')) return content;
      }
      
      // Method 3: Any Amazon image in the main image container
      const container = document.querySelector('#imgTagWrapperId, #img-canvas, #imageBlock');
      if (container) {
        const img = container.querySelector('img[src*="images"]');
        if (img && img.src && !img.src.includes('transparent-pixel')) return img.src;
      }
      
      // Method 4: Look through all images for Amazon CDN images
      const allImgs = document.querySelectorAll('img');
      for (const img of allImgs) {
        if (img.src && img.src.includes('m.media-amazon.com/images/I/') && 
            img.naturalWidth > 100 && !img.src.includes('sprite')) {
          return img.src;
        }
      }
      
      return null;
    });

    if (imageUrl) {
      // Normalize to a good size
      const cleanUrl = imageUrl.replace(/\._[A-Z0-9,_]+_\./, '._AC_SL1500_.');
      imageCache[asin] = cleanUrl;
      saveCache();
      console.log(`    ✅ Got image for ${asin}`);
      return cleanUrl;
    }
    
    console.log(`    ❌ No image found for ${asin}`);
    return null;
  } catch (e) {
    console.log(`    ❌ Error scraping ${asin}: ${e.message}`);
    return null;
  }
}

// Inject images into HTML product cards
function injectImages(html, asinImages) {
  let modified = html;
  let injected = 0;
  
  for (const [asin, imageUrl] of Object.entries(asinImages)) {
    if (!imageUrl) continue;
    
    // Find product cards that reference this ASIN
    // Pattern: product card with an amazon.com/dp/ASIN link but no img tag before it
    
    // Strategy: find the <h3> or heading right before the Amazon link, insert image after it
    const asinPattern = new RegExp(
      `(<div class="product-card"[^>]*>\\s*(?:<span[^>]*>[^<]*</span>\\s*)?<h3>([^<]+)</h3>)`,
      'g'
    );
    
    // Find all product card sections
    const cardRegex = /<div class="product-card"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*(?:<\/div>)?/g;
    
    // Simpler approach: find h3 followed by content that includes this ASIN, inject image after h3
    const pattern = new RegExp(
      `(<div class="product-card"[^>]*>\\s*(?:<span[^>]*class="rank"[^>]*>[^<]*</span>\\s*)?<h3>[^<]+</h3>)(\\s*<div class="rating">)`,
      'g'
    );
    
    let match;
    const tempHtml = modified;
    let lastIndex = 0;
    let result = '';
    
    while ((match = pattern.exec(tempHtml)) !== null) {
      // Check if this card contains our ASIN
      const cardEnd = tempHtml.indexOf('</div>\n\n', match.index);
      const cardContent = tempHtml.substring(match.index, cardEnd > 0 ? cardEnd : match.index + 2000);
      
      if (cardContent.includes(asin) && !cardContent.includes('<img')) {
        result += tempHtml.substring(lastIndex, match.index);
        result += match[1];
        // Extract product name from h3
        const nameMatch = match[1].match(/<h3>([^<]+)<\/h3>/);
        const productName = nameMatch ? nameMatch[1] : 'Product';
        result += `\n            <div class="product-image"><img src="${imageUrl}" alt="${productName}" loading="lazy" width="300" height="300"></div>`;
        result += match[2];
        lastIndex = match.index + match[0].length;
        injected++;
      }
    }
    
    if (lastIndex > 0) {
      result += tempHtml.substring(lastIndex);
      modified = result;
    }
  }
  
  // Also add some CSS for the product images if not present
  if (injected > 0 && !modified.includes('.product-image')) {
    const cssInject = `
        .product-image { text-align: center; margin: 15px 0; }
        .product-image img { max-width: 300px; height: auto; border-radius: 8px; }`;
    modified = modified.replace('</style>', cssInject + '\n    </style>');
  }
  
  return { html: modified, injected };
}

// Push to GitHub
function pushToGithub(site) {
  try {
    const repoUrl = `https://x-access-token:${TOKEN}@github.com/brazenproducts/${site.name}.git`;
    
    // Check if git is initialized
    if (!fs.existsSync(path.join(site.path, '.git'))) {
      execSync(`cd "${site.path}" && git init && git remote add origin ${repoUrl}`, { stdio: 'pipe' });
    }
    
    // Update remote URL with token
    try {
      execSync(`cd "${site.path}" && git remote set-url origin ${repoUrl}`, { stdio: 'pipe' });
    } catch(e) {}
    
    execSync(`cd "${site.path}" && git add -A && git commit -m "Add product images" --allow-empty 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`cd "${site.path}" && git push -f origin HEAD:main 2>&1`, { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch (e) {
    console.log(`    ⚠️  Push failed: ${e.message.substring(0, 100)}`);
    return false;
  }
}

async function main() {
  console.log('🚀 ADD REAL IMAGES TO AFFILIATE SITES\n');
  
  const sites = findSites();
  console.log(`Found ${sites.length} total sites\n`);
  
  // Filter to sites that have ASINs but need images
  const needsWork = [];
  for (const site of sites) {
    const html = fs.readFileSync(site.indexPath, 'utf8');
    const asins = extractASINs(html);
    const existingImages = hasImages(html);
    
    if (asins.length > 0 && existingImages === 0) {
      needsWork.push({ ...site, asins, html });
    }
  }
  
  console.log(`Sites needing images: ${needsWork.length}\n`);
  
  if (needsWork.length === 0) {
    console.log('All sites with ASINs already have images!');
    
    // Still push sites that have images but might not be deployed
    console.log('\nChecking if sites with images need pushing...');
    for (const site of sites) {
      const html = fs.readFileSync(site.indexPath, 'utf8');
      const asins = extractASINs(html);
      const existingImages = hasImages(html);
      if (asins.length > 0 && existingImages > 0) {
        console.log(`\n📦 ${site.name} (${existingImages} images, ${asins.length} ASINs)`);
        const pushed = pushToGithub(site);
        console.log(pushed ? '  ✅ Pushed' : '  ❌ Push failed');
      }
    }
    return;
  }
  
  // Launch browser
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  
  let fixedCount = 0;
  let pushedCount = 0;
  
  for (const site of needsWork) {
    console.log(`\n📦 ${site.name} (${site.asins.length} ASINs)`);
    
    // Scrape images for each ASIN
    const asinImages = {};
    for (const asin of site.asins) {
      const imageUrl = await scrapeImage(page, asin);
      asinImages[asin] = imageUrl;
      
      // Rate limit
      await new Promise(r => setTimeout(r, 3000));
    }
    
    // Inject images
    const gotImages = Object.values(asinImages).filter(Boolean).length;
    if (gotImages === 0) {
      console.log(`  ⚠️  No images found for any product`);
      continue;
    }
    
    const { html: newHtml, injected } = injectImages(site.html, asinImages);
    
    if (injected > 0) {
      fs.writeFileSync(site.indexPath, newHtml);
      console.log(`  ✅ Injected ${injected} images`);
      fixedCount++;
      
      // Push
      const pushed = pushToGithub(site);
      if (pushed) {
        pushedCount++;
        console.log(`  ✅ Pushed to GitHub`);
      }
    } else {
      console.log(`  ⚠️  Got ${gotImages} images but injection failed (HTML structure mismatch)`);
      // Save images anyway for manual use
    }
  }
  
  await browser.close();
  
  console.log(`\n\n=== RESULTS ===`);
  console.log(`Sites processed: ${needsWork.length}`);
  console.log(`Sites with images added: ${fixedCount}`);
  console.log(`Sites pushed to GitHub: ${pushedCount}`);
  console.log(`Image cache size: ${Object.keys(imageCache).length}`);
  saveCache();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
