#!/usr/bin/env node
/**
 * Google Ads Daily Audit — Bartact
 * Runs at 9 AM PST daily via cron
 * Goal: maintain 3.0-3.5x TRUE SALES ROAS minimum, 4x+ target
 * ROAS = Google-attributed conversion value / Google Ads spend (honest number)
 * Shopify revenue shown as context only — never divide total Shopify rev by Google spend
 * NEVER suggests pausing campaigns — only budget adjustments
 */

require('dotenv').config({ path: '/home/ubuntu/.openclaw/workspace/.env' });
const https = require('https');
const fs = require('fs');

const CREDS_PATH = '/home/ubuntu/.openclaw/workspace/.google-ads-credentials.json';
if (!fs.existsSync(CREDS_PATH)) {
  console.log('AUDIT STATUS: credentials file missing at ' + CREDS_PATH);
  console.log('ACTION REQUIRED: Restore .google-ads-credentials.json to run this audit.');
  console.log('Audit skipped — credentials unavailable. No changes made.');
  process.exit(0);
}
const CREDS = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
const SHOPIFY_STORE = 'bartact.myshopify.com';
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN_BARTACT;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN_BARTACT || '8899729921:AAE7SIUmavgRuVV1mSIT1B6ViP_yHWShrx4';
const TELEGRAM_CHAT_ID = '7550065844';

async function sendTelegram(text) {
  const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' });
  try {
    await httpRequest('api.telegram.org', `/bot${TELEGRAM_TOKEN}/sendMessage`, 'POST',
      { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body);
  } catch (e) {
    console.error('Telegram send failed:', e.message);
  }
}

const TARGET_ROAS_MIN = 4.0;
const TARGET_ROAS_GOAL = 5.0;
const MIN_SPEND_TO_FLAG = 50; // flag zero-conv campaigns spending more than this (all-time)
const TREND_DAYS = 3; // days of consistent decline before flagging

// ── Helpers ──────────────────────────────────────────────────────────────────

function httpRequest(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: CREDS.refresh_token,
    client_id: CREDS.client_id, client_secret: CREDS.client_secret
  }).toString();
  const r = await httpRequest('oauth2.googleapis.com', '/token', 'POST',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body);
  const data = JSON.parse(r.body);
  if (!data.access_token) throw new Error(`Token refresh failed: ${r.body}`);

  // Save new access token
  CREDS.access_token = data.access_token;
  CREDS.token_expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
  CREDS.updated = new Date().toISOString();
  fs.writeFileSync('/home/ubuntu/.openclaw/workspace/.google-ads-credentials.json', JSON.stringify(CREDS, null, 2));
  return data.access_token;
}

async function gaQuery(token, query) {
  const body = JSON.stringify({ query });
  const r = await httpRequest('googleads.googleapis.com',
    `/v23/customers/${CREDS.customer_id}/googleAds:searchStream`, 'POST', {
      'Authorization': `Bearer ${token}`, 'developer-token': CREDS.dev_token,
      'login-customer-id': CREDS.customer_id,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
    }, body);
  if (r.status !== 200) throw new Error(`GA query failed ${r.status}: ${r.body.substring(0, 300)}`);
  const chunks = JSON.parse(r.body);
  return Array.isArray(chunks) ? chunks.flatMap(c => c.results || []) : (chunks.results || []);
}

async function shopifyGet(path) {
  const r = await httpRequest(SHOPIFY_STORE, path, 'GET',
    { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' });
  return JSON.parse(r.body);
}

async function mutateBudget(token, resourceName, newDailyMicros) {
  const body = JSON.stringify({
    operations: [{ update: { resourceName, amountMicros: newDailyMicros }, updateMask: 'amountMicros' }]
  });
  const r = await httpRequest('googleads.googleapis.com',
    `/v23/customers/${CREDS.customer_id}/campaignBudgets:mutate`, 'POST', {
      'Authorization': `Bearer ${token}`, 'developer-token': CREDS.dev_token,
      'login-customer-id': CREDS.customer_id,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
    }, body);
  return JSON.parse(r.body);
}

function fmtDate(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function fmtDateISO(d) { return d.toISOString().slice(0, 10); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const token = await getToken();
  const today = new Date();

  // Date ranges
  const dow = today.getDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - mondayOffset);
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const threeDaysAgo = new Date(today); threeDaysAgo.setDate(today.getDate() - 3);

  const todayStr = fmtDate(today);
  const thisMondayStr = fmtDate(thisMonday);
  const lastMondayStr = fmtDate(lastMonday);
  const lastSundayStr = fmtDate(lastSunday);
  const yesterdayStr = fmtDate(yesterday);
  const threeDaysAgoStr = fmtDate(threeDaysAgo);

  // ── 1. Fetch Google Ads data ──
  const [twRows, lwRows, dailyRows, budgetRows] = await Promise.all([
    // This week by campaign
    gaQuery(token, `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${thisMondayStr}' AND '${todayStr}' AND campaign.status != 'REMOVED'`),
    // Last week by campaign
    gaQuery(token, `SELECT campaign.name, metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${lastMondayStr}' AND '${lastSundayStr}' AND campaign.status != 'REMOVED'`),
    // Last 7 days by day (for trend detection)
    gaQuery(token, `SELECT segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks FROM campaign WHERE segments.date BETWEEN '${threeDaysAgoStr}' AND '${yesterdayStr}' AND campaign.status = 'ENABLED'`),
    // Current budgets
    gaQuery(token, `SELECT campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros FROM campaign WHERE campaign.status = 'ENABLED' ORDER BY campaign_budget.amount_micros DESC`),
  ]);

  // ── 2. Fetch Shopify orders for true revenue ──
  const [shopifyTW, shopifyLW] = await Promise.all([
    shopifyGet(`/admin/api/2024-01/orders.json?status=any&created_at_min=${fmtDateISO(thisMonday)}T00:00:00-07:00&created_at_max=${fmtDateISO(today)}T23:59:59-07:00&limit=250&fields=id,total_price,financial_status,created_at`),
    shopifyGet(`/admin/api/2024-01/orders.json?status=any&created_at_min=${fmtDateISO(lastMonday)}T00:00:00-07:00&created_at_max=${fmtDateISO(lastSunday)}T23:59:59-07:00&limit=250&fields=id,total_price,financial_status,created_at`),
  ]);

  function shopifyRevenue(orders) {
    return (orders || [])
      .filter(o => o.financial_status !== 'voided' && o.financial_status !== 'refunded')
      .reduce((s, o) => s + parseFloat(o.total_price), 0);
  }

  const shopifyRevTW = shopifyRevenue(shopifyTW.orders);
  const shopifyRevLW = shopifyRevenue(shopifyLW.orders);
  const shopifyOrdersTW = (shopifyTW.orders || []).filter(o => o.financial_status !== 'voided').length;
  const shopifyOrdersLW = (shopifyLW.orders || []).filter(o => o.financial_status !== 'voided').length;

  // ── 3. Roll up campaign data ──
  function rollup(rows) {
    const m = {};
    for (const r of rows) {
      const n = r.campaign.name;
      if (!m[n]) m[n] = { spend: 0, clicks: 0, convs: 0, rev: 0 };
      m[n].spend += (r.metrics.costMicros || 0) / 1e6;
      m[n].clicks += parseInt(r.metrics.clicks || 0);
      m[n].convs += parseFloat(r.metrics.conversions || 0);
      m[n].rev += parseFloat(r.metrics.conversionsValue || 0);
    }
    return m;
  }

  const tw = rollup(twRows);
  const lw = rollup(lwRows);

  const totalSpendTW = Object.values(tw).reduce((s, c) => s + c.spend, 0);
  const totalRevTW = Object.values(tw).reduce((s, c) => s + c.rev, 0);
  const totalSpendLW = Object.values(lw).reduce((s, c) => s + c.spend, 0);

  // Google-attributed ROAS (the only honest number — don't attribute all Shopify revenue to Google)
  const googleRoasTW = totalSpendTW > 0 ? totalRevTW / totalSpendTW : 0;
  const googleRoasLW = totalSpendLW > 0 ? Object.values(lw).reduce((s,c)=>s+c.rev,0) / totalSpendLW : 0;
  // Shopify total shown separately as context only — NOT divided by Google spend
  const trueRoasTW = googleRoasTW; // alias for flag logic below
  const trueRoasLW = googleRoasLW;

  // ── 4. Daily trend (last 3 days) ──
  const byDay = {};
  for (const r of dailyRows) {
    const d = r.segments.date;
    if (!byDay[d]) byDay[d] = { spend: 0, convs: 0, rev: 0 };
    byDay[d].spend += (r.metrics.costMicros || 0) / 1e6;
    byDay[d].convs += parseFloat(r.metrics.conversions || 0);
    byDay[d].rev += parseFloat(r.metrics.conversionsValue || 0);
  }

  // ── 5. Budget map ──
  const budgets = {};
  for (const r of budgetRows) {
    budgets[r.campaign.name] = {
      resourceName: r.campaignBudget.resourceName,
      daily: (r.campaignBudget.amountMicros || 0) / 1e6
    };
  }
  const totalDailyBudget = Object.values(budgets).reduce((s, b) => s + b.daily, 0);

  // ── 6. Identify actions needed ──
  const actions = [];
  const flags = [];

  // Load boost state once before campaign loop
  const boostStateFile = `/home/ubuntu/.openclaw/workspace/memory/ads-boost-state.json`;
  let boostState = {};
  try { boostState = JSON.parse(fs.readFileSync(boostStateFile, 'utf8')); } catch(e) {}

  // Flag: overall ROAS below minimum
  if (trueRoasTW < TARGET_ROAS_MIN && totalSpendTW > 200) {
    flags.push(`⚠️ TRUE SALES ROAS this week: ${trueRoasTW.toFixed(2)}x — BELOW ${TARGET_ROAS_MIN}x minimum`);
  }

  // Per-campaign analysis
  for (const [name, m] of Object.entries(tw)) {
    if (m.spend < 20) continue; // too little data
    const roas = m.spend > 0 ? m.rev / m.spend : 0;
    const lwM = lw[name] || { spend: 0, rev: 0, convs: 0 };
    const lwRoas = lwM.spend > 0 ? lwM.rev / lwM.spend : 0;

    // Zero convs on significant spend — only cut if campaign has been running >7 days
    // (gives new campaigns time to gather data after fixes like Display Network disable)
    const isNew = name.includes('NEW');
    const spendThreshold = isNew ? 150 : MIN_SPEND_TO_FLAG; // higher bar for new campaigns
    if (m.convs === 0 && m.spend > spendThreshold && !isNew) {
      flags.push(`🔴 ${name}: $${m.spend.toFixed(0)} spent this week, 0 conversions`);
      if (budgets[name] && budgets[name].daily > 30) {
        const newBudget = Math.max(20, Math.round(budgets[name].daily * 0.6));
        actions.push({ name, type: 'reduce', from: budgets[name].daily, to: newBudget, reason: '0 convs on significant spend' });
      }
    } else if (m.convs === 0 && m.spend > spendThreshold && isNew) {
      flags.push(`⚠️ ${name} (NEW): $${m.spend.toFixed(0)} spent, 0 conversions — monitoring, give it a full week post-Display-fix before cutting`);
    }

    // Strong ROAS — consider boosting (max 1 boost per day, cap at $100/day)
    const MAX_AUTO_BUDGET = 100;
    const alreadyBoostedToday = boostState[name] === fmtDateISO(today);
    if (roas >= TARGET_ROAS_GOAL && m.spend > 50 && budgets[name] && budgets[name].daily < MAX_AUTO_BUDGET && !alreadyBoostedToday) {
      const newBudget = Math.min(budgets[name].daily * 1.3, budgets[name].daily + 20, MAX_AUTO_BUDGET);
      if (newBudget > budgets[name].daily + 5) {
        actions.push({ name, type: 'boost', from: budgets[name].daily, to: Math.round(newBudget), reason: `${roas.toFixed(1)}x ROAS this week` });
      }
    }
  }

  // ── 7. Apply budget actions ──
  const applied = [];

  for (const action of actions) {
    if (!budgets[action.name]) continue;
    try {
      const r = await mutateBudget(token, budgets[action.name].resourceName, action.to * 1e6);
      if (r.results) {
        applied.push(action);
        if (action.type === 'boost') {
          boostState[action.name] = fmtDateISO(today);
        }
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      flags.push(`❌ Failed to update budget for ${action.name}: ${e.message}`);
    }
  }

  // Save boost state so we don't double-boost same day
  try { fs.writeFileSync(boostStateFile, JSON.stringify(boostState, null, 2)); } catch(e) {}

  // ── 8. Build report ──
  const lines = [];
  lines.push(`📊 BARTACT GOOGLE ADS DAILY AUDIT — ${fmtDateISO(today)}`);
  lines.push('');

  // True ROAS summary
  lines.push('━━━ GOOGLE-ATTRIBUTED ROAS ━━━');
  lines.push(`This week: $${totalSpendTW.toFixed(0)} spend → **${googleRoasTW.toFixed(2)}x ROAS** (Google-attributed conversions only)`);
  lines.push(`Last week: $${totalSpendLW.toFixed(0)} spend → **${googleRoasLW.toFixed(2)}x ROAS**`);
  lines.push(`Shopify total this week: $${shopifyRevTW.toFixed(0)} revenue, ${shopifyOrdersTW} orders (includes ALL channels — do NOT divide by Google spend)`);
  lines.push(`Google-reported ROAS this week: ${googleRoasTW.toFixed(2)}x`);
  lines.push(`Target: ${TARGET_ROAS_MIN}x min / ${TARGET_ROAS_GOAL}x goal`);
  lines.push('');

  // Daily trend
  lines.push('━━━ DAILY TREND (last 3 days) ━━━');
  for (const [day, d] of Object.entries(byDay).sort()) {
    const roas = d.spend > 0 ? (d.rev / d.spend).toFixed(2) : '0.00';
    lines.push(`  ${day}: $${d.spend.toFixed(0)} spend | ${d.convs.toFixed(1)} convs | $${d.rev.toFixed(0)} rev | ${roas}x ROAS`);
  }
  lines.push('');

  // Campaign breakdown this week
  lines.push('━━━ CAMPAIGNS THIS WEEK ━━━');
  for (const [name, m] of Object.entries(tw).sort((a, b) => b[1].spend - a[1].spend)) {
    if (m.spend < 1) continue;
    const roas = m.spend > 0 ? (m.rev / m.spend).toFixed(2) : '0.00';
    const budget = budgets[name] ? `$${budgets[name].daily}/day` : '';
    lines.push(`  ${name} [${budget}]: $${m.spend.toFixed(0)} spend | ${m.clicks} clicks | ${m.convs.toFixed(1)} convs | $${m.rev.toFixed(0)} rev | ${roas}x`);
  }
  lines.push('');

  // Flags
  if (flags.length) {
    lines.push('━━━ FLAGS ━━━');
    flags.forEach(f => lines.push(`  ${f}`));
    lines.push('');
  }

  // Actions taken
  if (applied.length) {
    lines.push('━━━ BUDGET ADJUSTMENTS MADE ━━━');
    applied.forEach(a => lines.push(`  ${a.type === 'boost' ? '📈' : '📉'} ${a.name}: $${a.from}/day → $${a.to}/day (${a.reason})`));
    lines.push('');
  } else {
    lines.push('━━━ BUDGET ADJUSTMENTS ━━━');
    lines.push('  No automatic adjustments made today.');
    lines.push('');
  }

  lines.push(`💰 Total daily budget: $${totalDailyBudget.toFixed(0)}/day`);

  const report = lines.join('\n');
  console.log(report);

  // Save to file
  const outPath = `/home/ubuntu/.openclaw/workspace/memory/ads-audit-${fmtDateISO(today)}.md`;
  fs.writeFileSync(outPath, `# Google Ads Audit ${fmtDateISO(today)}\n\n\`\`\`\n${report}\n\`\`\`\n`);
  console.log(`\nSaved to ${outPath}`);

  // Build Telegram summary
  const roasEmoji = googleRoasTW >= TARGET_ROAS_GOAL ? '✅' : googleRoasTW >= TARGET_ROAS_MIN ? '⚠️' : '🔴';
  const tgLines = [
    `${roasEmoji} *Bartact Ads — ${fmtDateISO(today)}*`,
    `Spend: $${totalSpendTW.toFixed(0)} | ROAS: ${googleRoasTW.toFixed(2)}x (target: ${TARGET_ROAS_MIN}x+)`,
    `Shopify revenue: $${shopifyRevTW.toFixed(0)} (${shopifyOrdersTW} orders, all channels)`,
    '',
  ];

  if (flags.length) {
    tgLines.push('*Flags:*');
    flags.forEach(f => tgLines.push(f));
    tgLines.push('');
  }

  if (applied.length) {
    tgLines.push('*Budget changes:*');
    applied.forEach(a => tgLines.push(`${a.type === 'boost' ? '📈' : '📉'} ${a.name}: $${a.from} → $${a.to}/day`));
    tgLines.push('');
  }

  // Top 3 campaigns by spend
  const topCamps = Object.entries(tw).sort((a,b) => b[1].spend - a[1].spend).slice(0, 3);
  tgLines.push('*Top campaigns:*');
  for (const [name, m] of topCamps) {
    if (m.spend < 1) continue;
    const roas = m.spend > 0 ? (m.rev / m.spend).toFixed(2) : '0.00';
    const short = name.length > 28 ? name.slice(0, 25) + '...' : name;
    tgLines.push(`• ${short}: $${m.spend.toFixed(0)} @ ${roas}x`);
  }

  // Action prompt — list anything needing a decision
  const actionItems = [];

  // Campaigns with zero convs and meaningful spend
  for (const [name, m] of Object.entries(tw)) {
    if (m.spend >= 30 && m.convs === 0) {
      actionItems.push(`• ${name} — $${m.spend.toFixed(0)} spent, 0 conversions (pause or cut?)`);
    }
  }

  // Campaigns below 2x ROAS with meaningful spend
  for (const [name, m] of Object.entries(tw)) {
    if (m.spend >= 50 && m.convs > 0) {
      const roas = m.rev / m.spend;
      if (roas < 2.0) {
        actionItems.push(`• ${name} — $${m.spend.toFixed(0)} spent, ${roas.toFixed(2)}x ROAS (cut budget?)`);
      }
    }
  }

  // Overall ROAS below target
  if (googleRoasTW < TARGET_ROAS_MIN && totalSpendTW > 200) {
    tgLines.push('');
    tgLines.push(`Overall ROAS is ${googleRoasTW.toFixed(2)}x — below the ${TARGET_ROAS_MIN}x minimum.`);
  }

  if (actionItems.length > 0) {
    tgLines.push('');
    tgLines.push('*What do you want to do with these?*');
    actionItems.forEach(a => tgLines.push(a));
  } else {
    tgLines.push('');
    tgLines.push('Everything looks clean today. No action needed from you.');
  }

  await sendTelegram(tgLines.join('\n'));
  console.log('Telegram report sent.');
}

run().catch(async e => {
  console.error('Audit failed:', e.message);
  try {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN_BARTACT || '8899729921:AAE7SIUmavgRuVV1mSIT1B6ViP_yHWShrx4';
    const body = JSON.stringify({ chat_id: '7550065844', text: `🚨 *Bartact Ads audit FAILED*\n${new Date().toISOString().slice(0,10)}\nError: ${e.message}`, parse_mode: 'Markdown' });
    const https2 = require('https');
    await new Promise((res, rej) => {
      const req = https2.request({ hostname: 'api.telegram.org', path: `/bot${TELEGRAM_TOKEN}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => { r.resume(); r.on('end', res); });
      req.on('error', rej); req.write(body); req.end();
    });
  } catch (_) {}
  process.exit(1);
});
