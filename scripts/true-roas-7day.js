#!/usr/bin/env node
/**
 * True ROAS 7-Day Report — Bartact
 * Pulls Shopify orders (with note_attributes gclid check)
 * for the past 7 days and calculates gclid capture rate.
 * Google Ads spend pulled separately if credentials available.
 */

const https = require('https');
const fs = require('fs');

let CREDS = null;
try {
  CREDS = JSON.parse(fs.readFileSync('/home/ubuntu/.openclaw/workspace/.google-ads-credentials.json', 'utf8'));
} catch(e) {
  console.log('⚠️  Google Ads credentials not found — will report Shopify gclid data only');
}
const SHOPIFY_STORE = 'bartact.myshopify.com';
const SHOPIFY_TOKEN = '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';

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
  if (!CREDS) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: CREDS.refresh_token,
    client_id: CREDS.client_id, client_secret: CREDS.client_secret
  }).toString();
  const r = await httpRequest('oauth2.googleapis.com', '/token', 'POST',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body);
  const data = JSON.parse(r.body);
  if (!data.access_token) throw new Error(`Token refresh failed: ${r.body}`);
  CREDS.access_token = data.access_token;
  CREDS.token_expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();
  CREDS.updated = new Date().toISOString();
  fs.writeFileSync('/home/ubuntu/.openclaw/workspace/.google-ads-credentials.json', JSON.stringify(CREDS, null, 2));
  return data.access_token;
}

async function gaQuery(token, query) {
  if (!token || !CREDS) return [];
  const body = JSON.stringify({ query });
  const r = await httpRequest('googleads.googleapis.com',
    `/v23/customers/${CREDS.customer_id}/googleAds:searchStream`, 'POST', {
      'Authorization': `Bearer ${token}`, 'developer-token': CREDS.dev_token,
      'login-customer-id': CREDS.customer_id,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
    }, body);
  if (r.status !== 200) throw new Error(`GA query failed ${r.status}: ${r.body.substring(0, 500)}`);
  const chunks = JSON.parse(r.body);
  return Array.isArray(chunks) ? chunks.flatMap(c => c.results || []) : (chunks.results || []);
}

async function shopifyGet(path) {
  const r = await httpRequest(SHOPIFY_STORE, path, 'GET',
    { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' });
  return JSON.parse(r.body);
}

// Fetch ALL orders with pagination
async function fetchAllOrders(startDate, endDate) {
  let allOrders = [];
  let url = `/admin/api/2024-01/orders.json?status=any&created_at_min=${startDate}T00:00:00-07:00&created_at_max=${endDate}T23:59:59-07:00&limit=250&fields=id,name,total_price,financial_status,created_at,note_attributes`;
  
  while (url) {
    const r = await httpRequest(SHOPIFY_STORE, url, 'GET',
      { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' });
    
    const data = JSON.parse(r.body);
    if (data.orders) allOrders = allOrders.concat(data.orders);
    
    // Check for pagination link header
    const linkHeader = r.headers && r.headers.link;
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (match) {
        const nextUrl = new URL(match[1]);
        url = nextUrl.pathname + nextUrl.search;
      } else {
        url = null;
      }
    } else {
      url = null;
    }
    
    if (url) await new Promise(r => setTimeout(r, 500));
  }
  
  return allOrders;
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }
function fmtDateGA(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }

async function run() {
  const token = await getToken();
  const hasAdsData = !!token;
  
  // Period: past 7 full days (May 11-17 for a May 18 run)
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(today.getDate() - 1); // yesterday
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6); // 7 days back from yesterday
  
  const startStr = fmtDate(startDate);
  const endStr = fmtDate(endDate);
  const startGA = fmtDateGA(startDate);
  const endGA = fmtDateGA(endDate);
  
  console.log(`Period: ${startStr} to ${endStr} (7 days)`);
  console.log('');
  
  // Fetch Shopify orders with note_attributes
  console.log('Fetching Shopify orders...');
  const orders = await fetchAllOrders(startStr, endStr);
  console.log(`Found ${orders.length} total orders`);
  
  // Fetch Google Ads spend by day (if credentials available)
  let adsRows = [];
  if (hasAdsData) {
    console.log('Fetching Google Ads data...');
    adsRows = await gaQuery(token, `
      SELECT segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks
      FROM campaign
      WHERE segments.date BETWEEN '${startGA}' AND '${endGA}'
        AND campaign.status != 'REMOVED'
    `);
  } else {
    console.log('Skipping Google Ads data (no credentials)');
  }
  
  // Build daily ads data
  const adsByDay = {};
  for (const r of adsRows) {
    const d = r.segments.date;
    if (!adsByDay[d]) adsByDay[d] = { spend: 0, convs: 0, rev: 0, clicks: 0 };
    adsByDay[d].spend += (r.metrics.costMicros || 0) / 1e6;
    adsByDay[d].convs += parseFloat(r.metrics.conversions || 0);
    adsByDay[d].rev += parseFloat(r.metrics.conversionsValue || 0);
    adsByDay[d].clicks += parseInt(r.metrics.clicks || 0);
  }
  
  // Process orders by day with gclid detection
  const ordersByDay = {};
  let totalOrders = 0;
  let totalGclid = 0;
  let totalRevenue = 0;
  let gclidRevenue = 0;
  
  for (const order of orders) {
    if (order.financial_status === 'voided' || order.financial_status === 'refunded') continue;
    
    // Get order date in PST (Bartact is Pacific)
    const orderDate = new Date(order.created_at);
    // Adjust to PST by subtracting 7 hours (approximate)
    const pstDate = new Date(orderDate.getTime() - 7 * 60 * 60 * 1000);
    const dayKey = fmtDate(pstDate);
    
    if (!ordersByDay[dayKey]) ordersByDay[dayKey] = { orders: 0, gclid: 0, revenue: 0, gclidRevenue: 0 };
    
    const rev = parseFloat(order.total_price);
    const hasGclid = (order.note_attributes || []).some(a => 
      a.name && a.name.toLowerCase().includes('gclid') && a.value && a.value.length > 5
    );
    
    ordersByDay[dayKey].orders++;
    ordersByDay[dayKey].revenue += rev;
    totalOrders++;
    totalRevenue += rev;
    
    if (hasGclid) {
      ordersByDay[dayKey].gclid++;
      ordersByDay[dayKey].gclidRevenue += rev;
      totalGclid++;
      gclidRevenue += rev;
    }
  }
  
  // Calculate totals
  let totalSpend = Object.values(adsByDay).reduce((s, d) => s + d.spend, 0);
  let totalGoogleRev = Object.values(adsByDay).reduce((s, d) => s + d.rev, 0);
  
  const captureRate = totalOrders > 0 ? (totalGclid / totalOrders * 100) : 0;
  const trueROAS = totalSpend > 0 ? gclidRevenue / totalSpend : 0;
  const googleROAS = totalSpend > 0 ? totalGoogleRev / totalSpend : 0;
  
  // Print daily breakdown
  console.log('');
  console.log('=== DAILY BREAKDOWN ===');
  console.log('Date       | Orders | Gclid | Rate    | Spend    | Gclid Rev  | True ROAS');
  console.log('-----------|--------|-------|---------|----------|------------|----------');
  
  const allDays = new Set([...Object.keys(ordersByDay), ...Object.keys(adsByDay)]);
  const sortedDays = [...allDays].sort();
  
  for (const day of sortedDays) {
    const o = ordersByDay[day] || { orders: 0, gclid: 0, revenue: 0, gclidRevenue: 0 };
    const a = adsByDay[day] || { spend: 0 };
    const rate = o.orders > 0 ? (o.gclid / o.orders * 100).toFixed(1) : '0.0';
    const dayROAS = a.spend > 0 ? (o.gclidRevenue / a.spend).toFixed(2) : '0.00';
    console.log(`${day}  | ${String(o.orders).padStart(6)} | ${String(o.gclid).padStart(5)} | ${rate.padStart(5)}%  | $${a.spend.toFixed(0).padStart(6)} | $${o.gclidRevenue.toFixed(0).padStart(9)} | ${dayROAS}x`);
  }
  
  console.log('-----------|--------|-------|---------|----------|------------|----------');
  console.log(`TOTAL      | ${String(totalOrders).padStart(6)} | ${String(totalGclid).padStart(5)} | ${captureRate.toFixed(1).padStart(5)}%  | $${totalSpend.toFixed(0).padStart(6)} | $${gclidRevenue.toFixed(0).padStart(9)} | ${trueROAS.toFixed(2)}x`);
  
  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Period: ${startStr} to ${endStr}`);
  console.log(`Total Orders: ${totalOrders}`);
  console.log(`Orders with Gclid: ${totalGclid}`);
  console.log(`Gclid Capture Rate: ${captureRate.toFixed(1)}%`);
  console.log(`Total Shopify Revenue: $${totalRevenue.toFixed(2)}`);
  console.log(`Gclid-Tracked Revenue: $${gclidRevenue.toFixed(2)}`);
  console.log(`Total Ad Spend: $${totalSpend.toFixed(2)}`);
  console.log(`True ROAS (gclid/spend): ${trueROAS.toFixed(2)}x`);
  console.log(`Google Reported ROAS: ${googleROAS.toFixed(2)}x`);
  const gap = googleROAS > 0 ? ((googleROAS - trueROAS) / trueROAS * 100) : 0;
  console.log(`ROAS Gap: Google ${gap > 0 ? 'over' : 'under'}-reports by ${Math.abs(gap).toFixed(0)}%`);
  
  // Sample gclid note_attributes for validation
  console.log('');
  console.log('=== GCLID SAMPLES (first 5 orders with gclids) ===');
  let sampleCount = 0;
  for (const order of orders) {
    if (sampleCount >= 5) break;
    const gclidAttr = (order.note_attributes || []).find(a => 
      a.name && a.name.toLowerCase().includes('gclid') && a.value && a.value.length > 5
    );
    if (gclidAttr) {
      console.log(`  ${order.name}: ${gclidAttr.name} = ${gclidAttr.value.substring(0, 40)}... ($${order.total_price})`);
      sampleCount++;
    }
  }
  if (sampleCount === 0) {
    console.log('  ⚠️ No gclid note_attributes found on any orders!');
  }
  
  return { captureRate, trueROAS, googleROAS, totalOrders, totalGclid, totalSpend, gclidRevenue, totalRevenue };
}

run().catch(e => {
  console.error('Script failed:', e.message);
  process.exit(1);
});
