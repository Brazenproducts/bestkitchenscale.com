#!/usr/bin/env node
// Deploy contact.html stub to every live affiliate repo + scrub exposed emails.
// Access key is a placeholder; run update-contact-form-key.js later to swap in real one.
// Template includes site identity + URL fields so inbound emails clearly show which website generated the lead.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE_ROOT = '/home/ubuntu/.openclaw/workspace/sites/besttirepatch.com';
const TEMPLATE = fs.readFileSync(path.join(SITE_ROOT, 'reference/affiliate-contact-form-template.html'), 'utf8');
const PLACEHOLDER_KEY = 'SET_ME_ACCESS_KEY';

// Only live *.com repos at top level (not affiliate-sites/ mirrors)
const sites = fs.readdirSync(SITE_ROOT).filter(d => {
  try {
    return d.endsWith('.com') &&
      fs.statSync(path.join(SITE_ROOT, d)).isDirectory() &&
      fs.existsSync(path.join(SITE_ROOT, d, '.git')) &&
      fs.existsSync(path.join(SITE_ROOT, d, 'index.html'));
  } catch { return false; }
}).sort();

// Sites with currently-exposed emails that must be scrubbed
const emailScrubMap = {
  'info@brazenauto.com': '/contact.html',
  'hello@autopartsreviewed.com': '/contact.html',
};

const results = [];

for (const site of sites) {
  const dir = path.join(SITE_ROOT, site);
  const changes = [];

  // Build site-specific contact page
  const siteName = site
    .replace(/\.com$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  const contactHtml = TEMPLATE
    .replace(/\{\{SITE_NAME\}\}/g, siteName)
    .replace(/\{\{SITE_DOMAIN\}\}/g, site)
    .replace(/\{\{WEB3FORMS_KEY\}\}/g, PLACEHOLDER_KEY);

  const contactPath = path.join(dir, 'contact.html');
  const existing = fs.existsSync(contactPath) ? fs.readFileSync(contactPath, 'utf8') : null;
  if (existing !== contactHtml) {
    fs.writeFileSync(contactPath, contactHtml);
    changes.push('wrote contact.html');
  }

  // Walk all HTML files and scrub exposed emails + mailtos
  const htmlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'contact.html');
  for (const f of htmlFiles) {
    const p = path.join(dir, f);
    let txt = fs.readFileSync(p, 'utf8');
    const before = txt;

    // Replace mailto:<any>@<any> with href="/contact.html"
    txt = txt.replace(/mailto:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '/contact.html');

    // Replace visible email addresses we want to scrub
    for (const [email, replacement] of Object.entries(emailScrubMap)) {
      const rx = new RegExp(email.replace(/[.+]/g, ch => '\\' + ch), 'g');
      // Replace with "our contact form" link text + /contact.html href
      txt = txt.replace(rx, '<a href="/contact.html">our contact form</a>');
    }

    if (txt !== before) {
      fs.writeFileSync(p, txt);
      changes.push(`scrubbed ${f}`);
    }
  }

  // Update sitemap.xml if present — add <url>contact.html</url> entry if missing
  const smPath = path.join(dir, 'sitemap.xml');
  if (fs.existsSync(smPath)) {
    let sm = fs.readFileSync(smPath, 'utf8');
    if (!/\/contact\.html</.test(sm)) {
      const today = new Date().toISOString().slice(0,10);
      const entry = `  <url><loc>https://${site}/contact.html</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>\n`;
      sm = sm.replace(/<\/urlset>/, entry + '</urlset>');
      fs.writeFileSync(smPath, sm);
      changes.push('updated sitemap.xml');
    }
  }

  if (changes.length === 0) {
    results.push({ site, changes: ['no-op'] });
    continue;
  }

  // git commit + push
  try {
    execSync(`cd ${dir} && git add -A`, { stdio: 'pipe' });
    const msg = 'Add central contact form stub + scrub exposed emails (Web3Forms key pending)';
    execSync(`cd ${dir} && git -c user.email=axl@brazenproducts.local -c user.name=Axl commit -m "${msg}"`, { stdio: 'pipe' });
    execSync(`cd ${dir} && git pull --rebase origin main 2>&1`, { stdio: 'pipe' });
    const pushOut = execSync(`cd ${dir} && git push origin HEAD 2>&1`, { encoding: 'utf8' });
    const sha = execSync(`cd ${dir} && git rev-parse --short HEAD`, { encoding: 'utf8' }).trim();
    results.push({ site, changes, sha, pushed: true });
    console.log(`✓ ${site}  ${sha}  (${changes.join(', ')})`);
  } catch (e) {
    results.push({ site, changes, error: e.stderr?.toString() || e.message });
    console.log(`✗ ${site}  error: ${(e.stderr?.toString() || e.message).slice(0, 120)}`);
  }
}

fs.writeFileSync('/tmp/contact-form-deploy.json', JSON.stringify(results, null, 2));
console.log(`\nDone. Results saved to /tmp/contact-form-deploy.json`);
console.log(`\nSites touched: ${results.filter(r => r.pushed).length}`);
console.log(`Errors: ${results.filter(r => r.error).length}`);
console.log(`No-ops: ${results.filter(r => r.changes[0] === 'no-op').length}`);
