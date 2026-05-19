#!/usr/bin/env node
/**
 * BUILD IMAGE MAP FROM AMAZON SEARCH RESULTS
 * 
 * Given product names, search Amazon, grab first result's image + ASIN.
 * Save to a JSON map we can use to inject into sites.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const TAG = 'brazenprodu01-20';

const PRODUCTS = {
  'bestmassage-gun.com': [
    { name: 'Theragun PRO Plus', rank: 1 },
    { name: 'Hypervolt 2 Pro', rank: 2 },
    { name: 'Ekrin Athletics B37S', rank: 3 },
    { name: 'Bob and Brad Q2 Mini massage gun', rank: 4 },
    { name: 'Lifepro Dynaflex Mini massage gun', rank: 5 },
  ],
  'bestmini-fridge.com': [
    { name: 'Midea 3.1 Cu Ft Mini Fridge with Freezer', rank: 1 },
    { name: 'Frigidaire EFR451 Retro Mini Fridge', rank: 2 },
    { name: 'hOmeLabs 3.3 Cu Ft Mini Fridge', rank: 3 },
    { name: 'BLACK DECKER BCRK25B 2.5 Cu Ft mini fridge', rank: 4 },
    { name: 'Galanz GLR31TRDER Retro Fridge', rank: 5 },
  ],
  'bestportable-charger.com': [
    { name: 'Anker 737 Power Bank PowerCore 24K', rank: 1 },
    { name: 'Baseus Blade 100W Power Bank', rank: 2 },
    { name: 'Anker 525 Power Bank 20000mAh', rank: 3 },
    { name: 'Nitecore NB10000 Gen3 power bank', rank: 4 },
    { name: 'Mophie Powerstation XXL', rank: 5 },
  ]
};

// Already found from browser:
const KNOWN = {
  'Theragun PRO Plus': { asin: 'B0CG2G7RQY', image: 'https://m.media-amazon.com/images/I/71oPm50a2wL._AC_UL320_.jpg' },
  'Hypervolt 2 Pro': { asin: 'B09JB64T9Z', image: 'https://m.media-amazon.com/images/I/61jirA2o7nL._AC_UL320_.jpg' },
  'Ekrin Athletics B37S': { asin: 'B08M8P7ZVD', image: 'https://m.media-amazon.com/images/I/61-n1cdIa8L._AC_UL320_.jpg' },
  'Bob and Brad Q2 Mini massage gun': { asin: 'B08M8YSFC7', image: 'https://m.media-amazon.com/images/I/713LnvmR38L._AC_UL320_.jpg' },
  'Lifepro Dynaflex Mini massage gun': { asin: 'B08Q44SMZZ', image: 'https://m.media-amazon.com/images/I/71U19m91B3L._AC_UL320_.jpg' },
};

async function searchAmazon(page, query) {
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&tag=${TAG}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1500));
    
    const result = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-asin]');
      for (const item of items) {
        const asin = item.getAttribute('data-asin');
        if (!asin || asin.length !== 10) continue;
        const img = item.querySelector('.s-image');
        const title = item.querySelector('h2 span');
        if (img && title) {
          return { asin, title: title.textContent.trim().substring(0, 100), image: img.src };
        }
      }
      return null;
    });
    
    return result;
  } catch(e) {
    console.error(`  Error searching "${query}": ${e.message}`);
    return null;
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  const imageMap = {};
  
  for (const [site, products] of Object.entries(PRODUCTS)) {
    console.log(`\n=== ${site} ===`);
    imageMap[site] = [];
    
    for (const product of products) {
      // Check known cache first
      if (KNOWN[product.name]) {
        console.log(`  ✅ ${product.name} (cached)`);
        imageMap[site].push({
          ...product,
          asin: KNOWN[product.name].asin,
          image: KNOWN[product.name].image
        });
        continue;
      }
      
      const result = await searchAmazon(page, product.name);
      if (result) {
        console.log(`  ✅ ${product.name} → ${result.asin} (${result.title.substring(0, 40)})`);
        imageMap[site].push({
          ...product,
          asin: result.asin,
          image: result.image,
          amazonTitle: result.title
        });
      } else {
        console.log(`  ❌ ${product.name} — no result`);
        imageMap[site].push({ ...product, asin: null, image: null });
      }
      
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  await browser.close();
  
  // Save the map
  fs.writeFileSync('/home/ubuntu/.openclaw/workspace/memory/product-image-map.json', JSON.stringify(imageMap, null, 2));
  console.log('\nSaved to memory/product-image-map.json');
  
  // Print summary
  console.log('\n=== SUMMARY ===');
  for (const [site, products] of Object.entries(imageMap)) {
    const good = products.filter(p => p.image).length;
    console.log(`${site}: ${good}/${products.length} images found`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
