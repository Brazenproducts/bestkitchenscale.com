#!/usr/bin/env node
/**
 * Add images manually to top 20 highest-traffic sites
 * Downloads product images from Amazon and adds them to HTML
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const SITES_DIR = '/home/ubuntu/.openclaw/workspace/sites';
const IMAGES_DIR = '/home/ubuntu/.openclaw/workspace/product-images';
const TAG = 'brazenprodu01-20';

// Top 20 sites by traffic potential (Bartact/vehicle focus + bestsellers)
const TOP_SITES = [
  'jeepseatcover.com',
  'bestseatcover.com',
  'besttruckaccessories.com',
  'broncograbhandles.com',
  'jlseats.com',
  'gladiatorseatcover.com',
  'jkseats.com',
  'besttonneaucovers.com',
  'bestcarwashkits.com',
  'bestfirestick.com',
  'bestinstantpots.com',
  'bestairdryerblower.com',
  'bestcordlesstools.com',
  'bestgaming-chair.com',
  'bestmini-fridge.com',
  'bestportable-charger.com',
  'bestshower-head.com',
  'bestmassage-gun.com',
  'bestice-maker.com',
  'bestprotein-powder.com'
];

console.log('=== MANUAL IMAGE ADDITION FOR TOP 20 SITES ===\n');
console.log('Strategy: Use browser automation to screenshot Amazon product cards\n');

// For each top site:
// 1. Identify products (from links)
// 2. Open Amazon page for each
// 3. Screenshot product image
// 4. Save locally
// 5. Update HTML with local image path
// 6. Commit and push

console.log('This requires browser automation with openclaw browser tool.');
console.log('Will generate task list for manual execution.\n');

const taskList = [];

for (const site of TOP_SITES) {
  const indexPath = path.join(SITES_DIR, site, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.log(`⏭️  ${site} - no index.html`);
    continue;
  }
  
  const html = fs.readFileSync(indexPath, 'utf8');
  
  // Extract all Amazon links
  const links = [...html.matchAll(/href="(https?:\/\/(?:www\.)?amazon\.com\/(?:s\?k=|dp\/)([^"]+))"/g)];
  
  const products = [];
  for (const match of links) {
    const url = match[1];
    let productName = '';
    
    if (url.includes('/dp/')) {
      const asin = url.match(/\/dp\/([A-Z0-9]{10})/);
      if (asin) products.push({ asin: asin[1], url });
    } else if (url.includes('/s?k=')) {
      const query = url.match(/[?&]k=([^&"]+)/);
      if (query) {
        try {
          productName = decodeURIComponent(query[1].replace(/\+/g, ' '));
          products.push({ query: productName, url });
        } catch(e) {}
      }
    }
  }
  
  if (products.length > 0) {
    taskList.push({
      site,
      products: products.slice(0, 5), // Top 5 products per site
      indexPath
    });
    console.log(`📋 ${site} - ${products.length} products found`);
  }
}

console.log(`\n=== TASK LIST ===`);
console.log(`Total sites: ${taskList.length}`);
console.log(`\nNext steps:`);
console.log(`1. Use browser tool to open each Amazon URL`);
console.log(`2. Screenshot product image`);
console.log(`3. Save to ${IMAGES_DIR}/<site>/<product>.jpg`);
console.log(`4. Update HTML with <img> tags`);
console.log(`5. Push to GitHub\n`);

fs.writeFileSync(
  '/home/ubuntu/.openclaw/workspace/image-task-list.json',
  JSON.stringify(taskList, null, 2)
);

console.log('✅ Task list saved to image-task-list.json');
console.log('\nThis is a 2-3 hour manual task. Should I start?');
