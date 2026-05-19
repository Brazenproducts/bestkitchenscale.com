#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');

const site = '/home/ubuntu/.openclaw/workspace/tmp/bestfirestick.com/index.html';
let html = fs.readFileSync(site, 'utf8');

// Add images where missing
const images = {
  'B0BP9SNVH9': 'https://m.media-amazon.com/images/I/617-2QI09-L._AC_SY741_.jpg',
  'B091G4YP57': 'https://m.media-amazon.com/images/I/61x4Sru7fTL._AC_SY450_.jpg',
  'B09BZZ3MM7': 'https://m.media-amazon.com/images/I/71YRVDg1RCL._AC_SY741_.jpg'
};

for (const [asin, imageUrl] of Object.entries(images)) {
  // Find this ASIN in HTML
  const asinIndex = html.indexOf(`/dp/${asin}`);
  if (asinIndex === -1) continue;
  
  // Look backwards for card start
  const before = html.substring(Math.max(0, asinIndex - 1500), asinIndex);
  const cardMatch = before.match(/<div[^>]*class="[^"]*cat-card[^"]*"[^>]*>[\s\S]*$/);
  
  if (!cardMatch) continue;
  
  const cardStart = asinIndex - 1500 + cardMatch.index;
  const cardSection = html.substring(cardStart, asinIndex + 500);
  
  // Skip if already has image
  if (cardSection.includes('<img')) continue;
  
  // Find h3 and insert image before it
  const h3Match = cardSection.match(/<h3/);
  if (!h3Match) continue;
  
  const insertPos = cardStart + h3Match.index;
  const imgTag = `<img src="${imageUrl}" alt="Product" style="width:100%;max-width:300px;height:auto;margin:0 auto 1rem;display:block;border-radius:8px" loading="lazy">\n`;
  
  html = html.slice(0, insertPos) + imgTag + html.slice(insertPos);
  console.log(`✅ Added image for ${asin}`);
}

fs.writeFileSync(site, html);
console.log('💾 Saved');

try {
  execSync('cd /home/ubuntu/.openclaw/workspace/tmp/bestfirestick.com && git add index.html && git commit -m "Add product images" && git push', { stdio: 'inherit' });
  console.log('🚀 Pushed');
} catch(e) {
  console.log('⚠️  Push failed');
}
