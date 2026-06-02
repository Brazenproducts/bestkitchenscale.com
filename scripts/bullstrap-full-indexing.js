#!/usr/bin/env node
// Bull Strap FULL Catalog Indexing — pushes ALL product URLs via Google Indexing API
// Runs multiple times daily, pushes up to 200/day (API quota)
// Uses the complete URL list from memory/bullstrap-all-urls-for-indexing.json

const https = require('https');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.join(__dirname, '..');
const CREDS_FILE = path.join(WORKSPACE, '.bullstrap-indexing-credentials.json');
const URLS_FILE = path.join(WORKSPACE, 'memory/bullstrap-all-urls-for-indexing.json');
const STATE_FILE = path.join(WORKSPACE, 'memory/bullstrap-full-indexing-state.json');
const LOG_PREFIX = '[FULL-INDEX]';
const DAILY_LIMIT = 199;
const BATCH_SIZE = 50; // Push in batches of 50 with small delays

function log(msg) { console.log(`${LOG_PREFIX} ${new Date().toISOString()} ${msg}`); }

function httpsReq(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getToken(creds) {
  const params = new URLSearchParams({
    client_id: creds.installed ? creds.installed.client_id : creds.client_id,
    client_secret: creds.installed ? creds.installed.client_secret : creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token'
  }).toString();
  const resp = await httpsReq({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, params);
  const data = JSON.parse(resp.body);
  if (!data.access_token) throw new Error('Token failed: ' + resp.body);
  return data.access_token;
}

async function pushUrl(token, url) {
  const body = JSON.stringify({ url, type: 'URL_UPDATED' });
  const resp = await httpsReq({
    hostname: 'indexing.googleapis.com', path: '/v3/urlNotifications:publish', method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  }, body);
  return resp.status;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // Load credentials
  const rawCreds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
  
  // Load full URL list
  if (!fs.existsSync(URLS_FILE)) {
    log('ERROR: No URL file at ' + URLS_FILE);
    process.exit(1);
  }
  const urlData = JSON.parse(fs.readFileSync(URLS_FILE, 'utf8'));
  const allUrls = urlData.urls || [];
  log(`Total URLs in catalog: ${allUrls.length}`);

  // Load state (which URLs have been pushed)
  let state = { pushed: [], lastRun: null, totalPushed: 0, dailyCount: 0, dailyDate: null };
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }

  // Reset daily count if new day
  const today = new Date().toISOString().slice(0, 10);
  if (state.dailyDate !== today) {
    state.dailyCount = 0;
    state.dailyDate = today;
  }

  // Check if we've hit daily limit
  const remaining = DAILY_LIMIT - state.dailyCount;
  if (remaining <= 0) {
    log(`Daily limit reached (${state.dailyCount}/${DAILY_LIMIT}). Next reset tomorrow.`);
    log(`Progress: ${state.totalPushed}/${allUrls.length} total (${(state.totalPushed/allUrls.length*100).toFixed(1)}%)`);
    process.exit(0);
  }

  // Find URLs not yet pushed
  const pushedSet = new Set(state.pushed);
  const toPush = allUrls.filter(u => !pushedSet.has(u));
  log(`Remaining to push: ${toPush.length} | Today's budget: ${remaining}`);

  if (toPush.length === 0) {
    log('ALL URLs PUSHED! Nothing to do.');
    process.exit(0);
  }

  // Get token
  const token = await getToken(rawCreds);
  log('Access token obtained');

  // Push URLs in multiple batches up to the daily remaining limit
  const urlsToProcess = toPush.slice(0, remaining);
  let ok = 0, errors = 0, quotaHit = false;

  for (let batchStart = 0; batchStart < urlsToProcess.length; batchStart += BATCH_SIZE) {
    const batch = urlsToProcess.slice(batchStart, batchStart + BATCH_SIZE);
    log(`Pushing batch ${Math.floor(batchStart/BATCH_SIZE)+1} (${batch.length} URLs)...`);
    for (const url of batch) {
      const status = await pushUrl(token, url);
      if (status === 200 || status === 202) {
        ok++;
        state.pushed.push(url);
        state.totalPushed++;
        state.dailyCount++;
      } else if (status === 429) {
        log(`QUOTA HIT after ${ok} pushes`);
        quotaHit = true;
        break;
      } else if (status === 403 || status === 404) {
        // Ghost URL — product no longer exists, mark as pushed so we skip it forever
        errors++;
        log(`Ghost URL (${status}) — skipping permanently: ${url}`);
        state.pushed.push(url); // mark as done so it never retries
        state.ghostCount = (state.ghostCount || 0) + 1;
      } else {
        errors++;
        log(`Error ${status} on ${url}`);
      }
      await sleep(200); // Small delay between requests
    }
    if (quotaHit) break;
    // Brief pause between batches
    if (batchStart + BATCH_SIZE < urlsToProcess.length) await sleep(1000);
  }

  state.lastRun = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));

  log(`Done: ${ok} pushed, ${errors} errors${quotaHit ? ', QUOTA HIT' : ''}`);
  log(`Progress: ${state.totalPushed}/${allUrls.length} (${(state.totalPushed/allUrls.length*100).toFixed(1)}%)`);
  log(`ETA at 199/day: ~${Math.ceil((allUrls.length - state.totalPushed) / 199)} days`);
}

main().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
