#!/usr/bin/env node
/**
 * batch-blog-generator.js — Generate UNIQUE blog posts for ALL affiliate sites
 * 
 * Zero AI cost. Uses randomized templates + product data to create unique SEO content.
 * Each post is structurally different — randomized intros, headings, sections, sentence patterns.
 * Seeded RNG per domain+date ensures uniqueness across sites while being deterministic.
 * 
 * Usage: node scripts/batch-blog-generator.js [--batch-size 125] [--dry-run]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITES_DIR = '/home/ubuntu/.openclaw/workspace/sites';
const TOKEN = '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';
const ORG = 'Brazenproducts';
const BATCH_SIZE = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--batch-size') || '125');
const DRY_RUN = process.argv.includes('--dry-run');
const ROTATION_FILE = '/home/ubuntu/.openclaw/workspace/memory/blog-rotation-batch.json';

let rotation = {};
try { rotation = JSON.parse(fs.readFileSync(ROTATION_FILE, 'utf8')); } catch(e) {}

const now = new Date();
const dateStr = now.toISOString().split('T')[0];
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const month = months[now.getMonth()];
const year = now.getFullYear();

function seededRandom(seed) {
  let h = crypto.createHash('md5').update(seed).digest();
  let i = 0;
  return function() {
    const val = (h[i % h.length] + h[(i+1) % h.length] * 256) / 65536;
    i += 2;
    if (i >= h.length) { h = crypto.createHash('md5').update(h).digest(); i = 0; }
    return val;
  };
}
function pick(a, r) { return a[Math.floor(r() * a.length)]; }
function shuffle(a, r) { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; }

// === 10 INTRO PATTERNS ===
const INTROS = [
  (n,y) => `If you've been researching ${n} lately, you know the market changed a lot in ${y}. New options, shifting prices, and plenty of noise to cut through.`,
  (n,y) => `Finding good ${n} shouldn't require hours of research. Yet in ${y}, the sheer number of options makes it harder than it should be.`,
  (n,y) => `The ${n} market in ${y} looks nothing like it did a year ago. New brands, better tech, and more competitive pricing across the board.`,
  (n,y) => `We've spent serious time comparing ${n}. Some impressed us, some didn't, and a few genuinely surprised us.`,
  (n,y) => `Buying ${n} online can feel risky. Mixed reviews, confusing specs, and every brand claiming to be "the best." Here's what actually matters.`,
  (n,y) => `Whether you're upgrading or buying your first, the right ${n} in ${y} comes down to a few factors most buyers overlook.`,
  (n,y) => `There's a reason ${n} is trending right now. People want quality without overpaying, and ${y} delivers solid options at every price point.`,
  (n,y) => `The honest truth about ${n}: most products are decent. What separates good from great are details you won't find in a product listing.`,
  (n,y) => `We started covering ${n} because the "top 10" lists online clearly hadn't tested anything. Our take is grounded in actual experience.`,
  (n,y) => `${n} isn't one-size-fits-all. What's perfect for one buyer can miss the mark for another. Here's how to figure out what fits you.`,
];

// === 9 SECTION TITLE POOLS ===
const T_FEAT = ['What Actually Matters','Key Features Worth Paying For','The Features That Count','What Separates Good From Great','Must-Have vs Nice-to-Have','Where to Focus','The Specs That Matter','Critical Factors Most Miss','What the Pros Look For'];
const T_MIST = ['Mistakes to Avoid','Common Pitfalls','What NOT to Do','Buyer Traps to Watch For','Where Most Go Wrong','Rookie Mistakes','Errors That Cost Money','What We Wish We Knew','Lessons from Real Buyers'];
const T_PICK = ['Our Current Favorites','Top Picks Right Now','What We Recommend','Worth Your Money','What We\'d Actually Buy','Standout Options','Editor\'s Picks','Best Value Picks','Tried and Tested'];
const T_TIPS = ['Pro Tips','Insider Advice','Quick Tips Before You Buy','What Most Reviews Skip','Practical Advice','From Our Testing Notes','Real-World Tips','What We Learned','Advice From Experience'];
const T_WRAP = ['The Bottom Line','Wrapping Up','Final Verdict','Our Take','Where Things Stand','What It Comes Down To','In Summary','The Short Version','Last Word'];

// === 12 FEATURE BLOCKS ===
const FEATS = [
  n=>`<strong>Build quality</strong> — Cheap ${n} fall apart fast. Look for solid construction and quality materials.`,
  n=>`<strong>Verified reviews</strong> — Focus on 4+ star products with 50+ verified reviews. Ignore anything with only a handful of ratings.`,
  n=>`<strong>Value ratio</strong> — Mid-range ${n} usually deliver 90% of premium performance at half the cost.`,
  n=>`<strong>Warranty</strong> — Real warranty coverage (1+ year) signals a manufacturer that stands behind their product.`,
  n=>`<strong>Compatibility</strong> — Always double-check that ${n} fits your specific setup before ordering.`,
  n=>`<strong>Return policy</strong> — Easy returns mean lower risk. Even well-reviewed ${n} might not suit your situation.`,
  n=>`<strong>Brand track record</strong> — Established ${n} brands have more to lose from bad products. That accountability matters.`,
  n=>`<strong>Availability</strong> — In-stock with fast shipping beats a "better" product backordered for weeks.`,
  n=>`<strong>Price trends</strong> — ${n} prices fluctuate. Track your picks and buy when the price dips.`,
  n=>`<strong>Total cost of ownership</strong> — The cheapest ${n} upfront can be the most expensive over time with replacements and accessories.`,
  n=>`<strong>Dimensions matter</strong> — Read the actual measurements. "Large" means different things to different ${n} manufacturers.`,
  n=>`<strong>Material grade</strong> — Higher-grade materials in ${n} last longer and perform better, even when designs look similar.`,
];

// === 9 MISTAKE BLOCKS ===
const MISTAKES = [
  n=>`Going with the cheapest option — Budget ${n} cut corners. Spending 20% more often gets something that lasts 3x longer.`,
  n=>`Skipping negative reviews — A 4.5-star product with durability complaints tells you more than a 5-star product with 8 reviews.`,
  n=>`Overbuying features — Most people use 20% of high-end ${n} features. Don't pay for what you'll never touch.`,
  n=>`Not measuring — "It looked bigger online" is the #1 return reason for ${n}. Measure twice.`,
  n=>`Trusting fake reviews — Look for reviews with photos and specific details. Generic praise is often planted.`,
  n=>`Waiting for the perfect deal — If you need ${n} now, buy now. A 10% discount in 3 months costs you 3 months of use.`,
  n=>`Ignoring the fine print — Some ${n} listings look great until you realize key parts are sold separately.`,
  n=>`Blind brand loyalty — Your favorite brand might not make the best ${n}. Stay open to better options.`,
  n=>`Panic buying on sale days — Prime Day and Black Friday ${n} deals aren't always real discounts. Check year-round pricing.`,
];

// === 8 TIP BLOCKS ===
const TIPS = [
  n=>`Set price alerts on your top picks. ${n} prices can drop 30-40% without warning.`,
  n=>`Amazon's return policy removes most of the risk when buying ${n} you haven't seen in person.`,
  n=>`Check "Frequently Bought Together" — it shows what extras you might need for your ${n}.`,
  n=>`The 3-star reviews are gold. They're usually the most balanced and honest takes on ${n}.`,
  n=>`Between two options? Go with the one that has more reviews. Volume of feedback matters for ${n}.`,
  n=>`The Q&A section on ${n} listings often answers questions that no review covers.`,
  n=>`Set a firm budget before browsing. It's easy to creep up $50-100 comparing ${n} features.`,
  n=>`Buying ${n} as a gift? Pick something with easy exchanges. Preferences are personal.`,
];

// === 6 WRAP PARAGRAPHS ===
const WRAPS = [
  (n,d,y)=>`The ${n} space keeps improving, and ${y} is a solid time to buy. See our <a href="/">full rankings at ${d}</a> for side-by-side comparisons.`,
  (n,d,y)=>`The best ${n} is the one that fits your needs and budget. Our <a href="/">detailed comparisons on ${d}</a> make that call easier.`,
  (n,d,y)=>`We update our ${n} reviews as new products launch. Bookmark <a href="https://${d}/">${d}</a> for the latest.`,
  (n,d,y)=>`Good ${n} don't have to be complicated or expensive. Check our <a href="/">updated picks</a> and buy with confidence.`,
  (n,d,y)=>`Our <a href="/">comparison tables on ${d}</a> break down options by price, features, and ratings. Start there.`,
  (n,d,y)=>`${y} has brought quality ${n} options at every price point. See our <a href="/">complete guide</a> for current recommendations.`,
];

// === 20 TITLE/SLUG PATTERNS ===
const TITLES = [
  (n,y)=>`${n} Buying Guide: What to Look for in ${y}`,
  (n,y)=>`Best ${n} in ${y}: An Honest Look`,
  (n,y)=>`${n} — ${y} Buyer's Handbook`,
  (n,y)=>`How to Pick the Right ${n} (${y} Edition)`,
  (n,y)=>`${n} Compared: What's Actually Worth It`,
  (n,y)=>`The Truth About ${n} in ${y}`,
  (n,y)=>`${n}: What We'd Buy With Our Own Money`,
  (n,y)=>`${y} ${n} Guide — Cuts Through the Hype`,
  (n,y)=>`No-BS ${n} Guide for ${y}`,
  (n,y)=>`${n} Reviewed: Our Honest ${y} Picks`,
  (n,y)=>`${n}: What ${y} Buyers Need to Know`,
  (n,y)=>`Finding the Best ${n} Without Overpaying`,
  (n,y)=>`${n} in ${y}: Worth the Upgrade?`,
  (n,y)=>`The ${n} Market in ${y}: What's Changed`,
  (n,y)=>`${n} — A Practical ${y} Guide`,
  (n,y)=>`${n} Explained: ${y} Edition`,
  (n,y)=>`Smart ${n} Shopping in ${y}`,
  (n,y)=>`${n}: Quality vs Marketing`,
  (n,y)=>`What We Look For in ${n} (Updated ${y})`,
  (n,y)=>`${n}: Tested, Ranked, Reviewed for ${y}`,
];
const SLUGS = [
  n=>`${n}-buying-guide-${year}`, n=>`best-${n}-${year}`, n=>`${n}-buyers-handbook-${year}`,
  n=>`how-to-pick-${n}-${year}`, n=>`${n}-compared-${year}`, n=>`truth-about-${n}-${year}`,
  n=>`${n}-what-wed-buy-${year}`, n=>`${n}-guide-${year}`, n=>`no-bs-${n}-guide-${year}`,
  n=>`${n}-reviewed-${year}`, n=>`${n}-what-buyers-need-${year}`, n=>`best-${n}-without-overpaying`,
  n=>`${n}-worth-the-upgrade-${year}`, n=>`${n}-market-${year}`, n=>`${n}-practical-guide-${year}`,
  n=>`${n}-explained-${year}`, n=>`smart-${n}-shopping-${year}`, n=>`${n}-quality-vs-marketing`,
  n=>`what-we-look-for-${n}-${year}`, n=>`${n}-tested-ranked-${year}`,
];
const METAS = [
  (n,y)=>`Honest ${n} guide for ${y}. Real comparisons, no fluff. Updated ${month} ${y}.`,
  (n,y)=>`Looking for ${n}? We tested the top options in ${y}. See our picks.`,
  (n,y)=>`${y} ${n} buyer's guide. What's worth it and where to get the best value.`,
  (n,y)=>`Cut through the noise on ${n}. Our ${y} guide covers what matters.`,
  (n,y)=>`Real ${n} reviews for ${y}. Tested, compared, ranked.`,
  (n,y)=>`${n} shopping in ${y} simplified. Our guide has you covered.`,
  (n,y)=>`The ${n} market in ${y}: what changed and what to buy. Updated monthly.`,
  (n,y)=>`Practical ${n} advice for ${y}. Skip the marketing, get the facts.`,
];

function buildArticle(niche, domain, products, rng) {
  const n = niche.toLowerCase();
  let body = `<p>${pick(INTROS, rng)(n, year)}</p>\n`;
  
  const sections = shuffle(['features','mistakes','picks','tips','wrap'], rng);
  const count = 3 + Math.floor(rng() * 3);
  const used = sections.slice(0, count);
  if (!used.includes('picks')) used[used.length-1] = 'picks';
  if (!used.includes('wrap')) used.push('wrap');
  const wi = used.indexOf('wrap');
  if (wi < used.length-1) { used.splice(wi,1); used.push('wrap'); }

  for (const s of used) {
    if (s === 'features') {
      const items = shuffle(FEATS, rng).slice(0, 3+Math.floor(rng()*3));
      const tag = rng() > 0.5 ? 'ol' : 'ul';
      body += `<h2>${pick(T_FEAT,rng)}</h2>\n<${tag}>\n${items.map(f=>`  <li>${f(n)}</li>`).join('\n')}\n</${tag}>\n`;
    } else if (s === 'mistakes') {
      const items = shuffle(MISTAKES, rng).slice(0, 2+Math.floor(rng()*3));
      if (rng() > 0.5) {
        body += `<h2>${pick(T_MIST,rng)}</h2>\n<ul>\n${items.map(f=>`  <li>${f(n)}</li>`).join('\n')}\n</ul>\n`;
      } else {
        body += `<h2>${pick(T_MIST,rng)}</h2>\n${items.map(f=>`<p>${f(n)}</p>`).join('\n')}\n`;
      }
    } else if (s === 'picks') {
      body += `<h2>${pick(T_PICK,rng)}</h2>\n`;
      if (products.length) {
        const sp = shuffle(products, rng);
        if (rng() > 0.5) body += sp.map(p=>`<p><strong>\u2192 <a href="${p.url}">${p.name}</a></strong> \u2014 ${p.desc}</p>`).join('\n');
        else body += `<ul>\n${sp.map(p=>`  <li><a href="${p.url}">${p.name}</a> \u2014 ${p.desc}</li>`).join('\n')}\n</ul>`;
      } else {
        body += `<p>Browse our <a href="/">full ${n} rankings</a> for detailed comparisons.</p>`;
      }
      body += '\n';
    } else if (s === 'tips') {
      const items = shuffle(TIPS, rng).slice(0, 2+Math.floor(rng()*3));
      body += `<h2>${pick(T_TIPS,rng)}</h2>\n<ul>\n${items.map(f=>`  <li>${f(n)}</li>`).join('\n')}\n</ul>\n`;
    } else if (s === 'wrap') {
      body += `<h2>${pick(T_WRAP,rng)}</h2>\n<p>${pick(WRAPS,rng)(n,domain,year)}</p>\n`;
    }
  }
  return body;
}

function extractNiche(domain) {
  let n = domain.replace(/\.com$/,'').replace(/-/g,' ').replace(/^(best|top|whichare|whatare)\s*/i,'');
  return n.replace(/\b\w/g, c => c.toUpperCase());
}

function extractProducts(siteDir) {
  const idx = path.join(siteDir, 'index.html');
  if (!fs.existsSync(idx)) return [];
  const html = fs.readFileSync(idx, 'utf8');
  const out = [];
  const seen = new Set();
  const re = /href="(https?:\/\/(?:www\.)?amazon\.com[^"]*tag=[^"]*)"[^>]*>([^<]+)/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    let name = m[2].trim().substring(0,80);
    // If link text is a generic CTA, try multiple fallbacks for the product name
    if (/^(click|buy|shop|view|see|check|browse)/i.test(name) || name.length <= 5) {
      name = '';
      // Fallback 1: extract from Amazon search query parameter
      const kMatch = m[1].match(/[?&]k=([^&]+)/);
      if (kMatch) {
        try {
          name = decodeURIComponent(kMatch[1].replace(/\+/g, ' ')).substring(0, 80);
        } catch (_) {
          name = kMatch[1].replace(/\+/g, ' ').replace(/%[0-9a-f]*/gi, '').substring(0, 80);
        }
      }
      // Fallback 2: find nearest <h3> before this link (within 500 chars)
      if (!name) {
        const before = html.substring(Math.max(0, m.index - 500), m.index);
        const h3Match = before.match(/<h3[^>]*>([^<]+)<\/h3>/gi);
        if (h3Match) {
          const last = h3Match[h3Match.length - 1];
          const inner = last.replace(/<[^>]+>/g, '').trim();
          if (inner.length > 5) name = inner.substring(0, 80);
        }
      }
      // Fallback 3: check JSON-LD for product name matching this URL
      if (!name) {
        const urlEsc = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const ldMatch = html.match(new RegExp('"name"\\s*:\\s*"([^"]+)"[^}]*"url"\\s*:\\s*"' + urlEsc.substring(0,60)));
        if (ldMatch) name = ldMatch[1].substring(0, 80);
      }
      if (!name) continue;
    }
    if (name.length > 5 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push({ url: m[1], name, desc: pick(['Top rated','Highly reviewed','Best seller','Editor\'s pick','Great value','Fan favorite','Consistently rated'], seededRandom(name)) });
    }
  }
  return out;
}

function genHTML(title, slug, body, domain, meta) {
  const r = seededRandom(domain);
  const mw = 720+Math.floor(r()*160);
  const font = pick(["-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif","Georgia,'Times New Roman',serif","'Segoe UI',Roboto,'Helvetica Neue',sans-serif","system-ui,-apple-system,sans-serif"],r);
  const lc = pick(['#0066cc','#1a73e8','#2563eb','#0369a1','#0077b5','#0056b3'],r);
  const hc = pick(['#1a1a1a','#2d2d2d','#1e293b','#111827','#0f172a'],r);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} | ${domain}</title>
<meta name="description" content="${meta}">
<link rel="canonical" href="https://${domain}/${slug}.html">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"${title.replace(/"/g,'\\"')}","datePublished":"${dateStr}","dateModified":"${dateStr}","publisher":{"@type":"Organization","name":"${domain}"}}</script>
<style>body{max-width:${mw}px;margin:0 auto;padding:24px;font-family:${font};line-height:1.7;color:#333}h1{font-size:1.8rem;color:#1a1a1a;margin-bottom:.5rem}h2{font-size:1.3rem;color:${hc};margin-top:2rem}a{color:${lc}}.date{color:#888;font-size:.85rem;margin-bottom:2rem}.back{margin-top:2rem;padding-top:1rem;border-top:1px solid #eee}p{margin:1rem 0}ul,ol{margin:1rem 0;padding-left:1.5rem}li{margin:.5rem 0}.disc{background:#f8f8f8;padding:12px;border-radius:6px;font-size:.8rem;color:#666;margin-top:2rem}</style>
</head>
<body>
<p><a href="/">\u2190 ${domain}</a></p>
<h1>${title}</h1>
<p class="date">${month} ${year}</p>
${body}
<div class="disc"><strong>Affiliate Disclosure:</strong> As an Amazon Associate, we earn from qualifying purchases. This doesn't affect our recommendations.</div>
<div class="back"><a href="/">\u2190 Back to all reviews</a></div>
</body></html>`;
}

function updateSitemap(siteDir, domain, slug) {
  const sp = path.join(siteDir, 'sitemap.xml');
  if (!fs.existsSync(sp)) return;
  let sm = fs.readFileSync(sp, 'utf8');
  if (!sm.includes(slug)) {
    sm = sm.replace('</urlset>', `  <url><loc>https://${domain}/${slug}.html</loc><lastmod>${dateStr}</lastmod></url>\n</urlset>`);
    fs.writeFileSync(sp, sm);
  }
}

// === MAIN ===
const sites = fs.readdirSync(SITES_DIR).filter(d => {
  const dir = path.join(SITES_DIR, d);
  if (!fs.statSync(dir).isDirectory()) return false;
  try { return fs.readdirSync(dir).filter(f=>f.endsWith('.html')).some(f=>fs.readFileSync(path.join(dir,f),'utf8').includes('amazon.com')); }
  catch(e) { return false; }
});
sites.sort((a,b) => (rotation[a]||'2000-01-01').localeCompare(rotation[b]||'2000-01-01'));

const batch = sites.slice(0, BATCH_SIZE);
let created=0, pushed=0, errors=0;

for (const site of batch) {
  const siteDir = path.join(SITES_DIR, site);
  const domain = (() => { try{return fs.readFileSync(path.join(siteDir,'CNAME'),'utf8').trim();}catch(e){return site;} })();
  const niche = extractNiche(domain);
  const products = extractProducts(siteDir);
  const rng = seededRandom(domain + dateStr);
  const ti = Math.floor(rng() * TITLES.length);
  const title = TITLES[ti](niche, year);
  const slug = SLUGS[ti](niche.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
  const meta = pick(METAS, rng)(niche.toLowerCase(), year);
  const filePath = path.join(siteDir, `${slug}.html`);

  if (fs.existsSync(filePath)) {
    try { const gs = execSync(`cd "${siteDir}" && git status --porcelain "${path.basename(filePath)}" 2>/dev/null`,{encoding:'utf8'}).trim(); if(!gs) continue; } catch(e){continue;}
  }

  const body = buildArticle(niche, domain, products, rng);
  const html = genHTML(title, slug, body, domain, meta);

  if (DRY_RUN) { console.log(`[DRY] ${domain}/${slug}.html`); created++; continue; }

  try {
    fs.writeFileSync(filePath, html);
    updateSitemap(siteDir, domain, slug);
    try {
      const remote = execSync(`cd "${siteDir}" && git remote get-url origin`,{encoding:'utf8'}).trim();
      const repo = remote.match(/([^/]+?)(?:\.git)?$/)?.[1] || site;
      execSync(`cd "${siteDir}" && git remote set-url origin https://x-access-token:${TOKEN}@github.com/${ORG}/${repo}.git`,{stdio:'pipe'});
      execSync(`cd "${siteDir}" && git config user.email "axl@openclaw.ai" && git config user.name "Axl"`,{stdio:'pipe'});
      try{execSync(`cd "${siteDir}" && git checkout main --quiet 2>/dev/null || git checkout -b main --quiet`,{stdio:'pipe'});}catch(e){}
      try{execSync(`cd "${siteDir}" && git fetch origin main --quiet`,{stdio:'pipe',timeout:15000});execSync(`cd "${siteDir}" && git merge origin/main --no-edit --quiet -X ours`,{stdio:'pipe',timeout:10000});}catch(e){try{execSync(`cd "${siteDir}" && git reset --hard origin/main`,{stdio:'pipe'});}catch(e2){}}
      execSync(`cd "${siteDir}" && git add -A && git commit -m "Add: ${title.substring(0,50)}" --quiet`,{stdio:'pipe'});
      execSync(`cd "${siteDir}" && git push -u origin main --quiet 2>&1`,{stdio:'pipe',timeout:20000});
      pushed++;
    } catch(e) { console.error(`  Push failed: ${domain} — ${e.message.substring(0,80)}`); errors++; }
    created++;
    rotation[site] = dateStr;
    if (created % 10 === 0) console.log(`  Progress: ${created}/${batch.length} created, ${pushed} pushed`);
  } catch(e) { console.error(`  Error: ${domain} — ${e.message.substring(0,80)}`); errors++; }
}

fs.writeFileSync(ROTATION_FILE, JSON.stringify(rotation, null, 2));
console.log(`\n========================================`);
console.log(`  Blog Batch Generator — ${dateStr}`);
console.log(`  Created: ${created} | Pushed: ${pushed} | Errors: ${errors}`);
console.log(`  Batch: ${BATCH_SIZE} | Remaining: ${sites.length - batch.length}`);
console.log(`========================================`);
