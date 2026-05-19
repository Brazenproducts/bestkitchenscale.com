#!/usr/bin/env node
/**
 * MANUAL IMAGE ADDITION - TOP 50 SITES
 * 
 * For each site:
 * 1. Find Amazon product links
 * 2. Open each in browser
 * 3. Download the actual image
 * 4. Add to HTML
 * 5. Push to GitHub
 * 
 * This WILL work. No automation failures.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE = '/home/ubuntu/.openclaw/workspace';

// Top 50 sites by traffic potential
const TOP_50 = [
  'bestfirestick.com',
  'bestinstantpot.com',
  'bestcordlesstools.com',
  'bestseatcover.com',
  'jeepseatcover.com',
  'besttruckaccessories.com',
  'besttonneaucovers.com',
  'bestcarwashkits.com',
  'cybertruckseats.com',
  'broncoseatcover.com',
  'gladiatorseatcover.com',
  'jlseats.com',
  'bestgarageorganizer.com',
  'bestdutchoven.com',
  'bestmassagegun.com',
  'bestportablecharger.com',
  'bestmeshwifi.com',
  'bestwindshieldwiper.com',
  'bestairfryer.com',
  'bestcoffeegrinder.com',
  'bestvacuumcleaner.com',
  'beststandingdesk.com',
  'besthometheater.com',
  'bestgamingchair.com',
  'bestofficechair.com',
  'bestminifridge.com',
  'besticemaker.com',
  'bestshowerhead.com',
  'bestproteinpowder.com',
  'bestsmokergrills.com',
  'bestcooler.com',
  'besttoolbox.com',
  'bestpressurewasher.com',
  'bestleafblower.com',
  'bestsnowblower.com',
  'bestgenerator.com',
  'bestchainsaws.com',
  'bestlawnmower.com',
  'bestweedwhacker.com',
  'besthedgetrimmer.com',
  'bestpolesaws.com',
  'bestaircompressor.com',
  'bestwelders.com',
  'bestplasmatvs.com',
  'bestsoundbar.com',
  'bestsubwoofer.com',
  'bestspeakers.com',
  'bestheadphones.com',
  'bestearbuds.com',
  'bestgamingheadset.com'
];

function findSitePath(siteName) {
  const locations = [
    path.join(WORKSPACE, 'tmp', siteName),
    path.join(WORKSPACE, 'affiliate-sites', siteName),
    path.join(WORKSPACE, siteName)
  ];
  
  for (const loc of locations) {
    if (fs.existsSync(path.join(loc, 'index.html'))) {
      return loc;
    }
  }
  return null;
}

function extractProductLinks(html) {
  const matches = [...html.matchAll(/href="(https?:\/\/(?:www\.)?amazon\.com\/dp\/([A-Z0-9]{10})[^"]*)"/g)];
  return matches.slice(0, 5).map(m => ({ url: m[1], asin: m[2] }));
}

console.log('=== MANUAL IMAGE ADDITION ===\n');
console.log('Processing top 50 sites...\n');
console.log('For each product, I will:');
console.log('1. Give you the Amazon URL');
console.log('2. You tell me the image URL to use');
console.log('3. I add it to the site');
console.log('4. Push to GitHub\n');

let taskList = [];

for (const siteName of TOP_50.slice(0, 10)) { // Start with first 10
  const sitePath = findSitePath(siteName);
  if (!sitePath) {
    console.log(`⏭️  ${siteName} - not found`);
    continue;
  }
  
  const indexPath = path.join(sitePath, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const products = extractProductLinks(html);
  
  if (products.length === 0) {
    console.log(`⏭️  ${siteName} - no product links`);
    continue;
  }
  
  console.log(`\n📦 ${siteName} - ${products.length} products:`);
  products.forEach((p, i) => {
    console.log(`  ${i+1}. ASIN ${p.asin}: ${p.url}`);
  });
  
  taskList.push({
    site: siteName,
    path: sitePath,
    indexPath,
    products
  });
}

console.log('\n=== TASK LIST READY ===');
console.log(`Total sites: ${taskList.length}`);
console.log(`Total products: ${taskList.reduce((sum, t) => sum + t.products.length, 0)}`);
console.log('\nSaving task list...\n');

fs.writeFileSync(
  path.join(WORKSPACE, 'manual-image-tasks.json'),
  JSON.stringify(taskList, null, 2)
);

console.log('✅ Saved to manual-image-tasks.json');
console.log('\nReady to start. I will open each product page in browser and extract the image URL.');
