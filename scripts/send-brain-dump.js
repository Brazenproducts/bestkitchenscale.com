#!/usr/bin/env node
/**
 * send-brain-dump.js
 * Daily brain dump email → walkwayinc@gmail.com
 * Compiles: MEMORY.md, today's daily notes, ads audit, cron job status,
 * credential health, site counts, and recent project activity.
 * Sends via info@brazenauto.com SMTP (Gmail app password).
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const net     = require('net');
const tls     = require('tls');

// ── PATHS ────────────────────────────────────────────────────────────────────
const WORKSPACE   = '/home/ubuntu/.openclaw/workspace';
const MEMORY_DIR  = path.join(WORKSPACE, 'memory');
const SMTP_CREDS  = path.join(WORKSPACE, '.brazenauto-smtp.json');
const MEMORY_MD   = path.join(WORKSPACE, 'MEMORY.md');
const TOOLS_MD    = path.join(WORKSPACE, 'TOOLS.md');
const ENV_FILE    = path.join(WORKSPACE, '.env');

const SITES_DIR   = path.join(WORKSPACE, 'sites/besttirepatch.com/sites');
const AFF_DIR     = path.join(WORKSPACE, 'sites/besttirepatch.com/affiliate-sites');
const SCRIPTS_DIR = path.join(WORKSPACE, 'sites/besttirepatch.com/scripts');

const CRED_FILES  = [
  { label: 'Gmail (brazenauto)',     path: path.join(WORKSPACE, '.gmail-brazenauto-credentials.json') },
  { label: 'Google Ads',             path: path.join(WORKSPACE, 'sites/besttirepatch.com/.google-ads-credentials.json') },
  { label: 'Bull Strap Indexing',    path: path.join(WORKSPACE, 'sites/besttirepatch.com/.bullstrap-indexing-credentials.json') },
  { label: 'Bartact Indexing',       path: path.join(WORKSPACE, 'sites/besttirepatch.com/.bartactinc-indexing-credentials.json') },
  { label: 'GCP Service Account',    path: path.join(WORKSPACE, '.gcp-service-account.json') },
];

// ── OPENCLAW GATEWAY CRON API ─────────────────────────────────────────────
const GATEWAY_SOCKET = '/tmp/openclaw-gateway.sock';
const GATEWAY_HTTP   = 'http://localhost:3434'; // fallback

// ── HELPERS ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function safeCount(dir) {
  try { return fs.readdirSync(dir).length; } catch { return '?'; }
}

function escHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToHtml(md) {
  if (!md) return '';
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4 style="color:#1a56db;margin:12px 0 4px">$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3 style="color:#1e3a8a;margin:14px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px">$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2 style="color:#1e3a8a;margin:16px 0 8px">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)(?=\n(?!<li>))/g, '<ul style="margin:4px 0;padding-left:20px">$1</ul>')
    .replace(/⚠️/g, '⚠️').replace(/✅/g, '✅').replace(/❌/g, '❌').replace(/🔴/g, '🔴')
    .replace(/\n{2,}/g, '</p><p style="margin:6px 0">')
    .replace(/^(?!<[hup])(.+)$/gm, '$1<br>');
}

// ── CRON JOB FETCH ────────────────────────────────────────────────────────────
// Hits the gateway's internal HTTP API to list cron jobs

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    }).on('error', reject);
  });
}

function httpGetLocal(port, path) {
  return new Promise((resolve, reject) => {
    const req = require('http').get({ hostname: 'localhost', port, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchCronJobs() {
  // Try gateway internal API on common ports
  for (const port of [3434, 3435, 8080]) {
    try {
      const data = await httpGetLocal(port, '/api/cron/jobs');
      if (data && (Array.isArray(data) || data.jobs)) return Array.isArray(data) ? data : data.jobs;
    } catch {}
  }
  return null;
}

// ── CREDENTIAL HEALTH ─────────────────────────────────────────────────────────

function checkCreds() {
  const results = [];
  for (const c of CRED_FILES) {
    if (!fs.existsSync(c.path)) {
      results.push({ label: c.label, status: 'MISSING', detail: 'file not found' });
      continue;
    }
    const j = readJson(c.path);
    if (!j) {
      results.push({ label: c.label, status: 'CORRUPT', detail: 'JSON parse failed' });
      continue;
    }
    // Check token expiry if present
    const expiry = j.token_expiry || j.expiry_date;
    if (expiry) {
      const exp = new Date(expiry);
      const now = new Date();
      const hoursLeft = (exp - now) / 3600000;
      if (hoursLeft < 0) {
        results.push({ label: c.label, status: '⚠️ EXPIRED', detail: `expired ${exp.toISOString()}` });
      } else if (hoursLeft < 2) {
        results.push({ label: c.label, status: '⚠️ EXPIRING', detail: `expires in ${hoursLeft.toFixed(1)}h` });
      } else {
        results.push({ label: c.label, status: '✅ OK', detail: `expires ${exp.toISOString().slice(0,16)}` });
      }
    } else {
      // Check if refresh_token exists
      const hasRT = !!(j.refresh_token || j.private_key);
      results.push({ label: c.label, status: hasRT ? '✅ OK' : '⚠️ NO RT', detail: hasRT ? 'refresh token present' : 'no refresh token' });
    }
  }
  return results;
}

// ── ENV KEY SUMMARY ───────────────────────────────────────────────────────────

function getEnvSummary() {
  const raw = readFile(ENV_FILE) || '';
  const keys = raw.split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => l.split('=')[0].trim())
    .filter(Boolean);
  return keys;
}

// ── SITE COUNTS ───────────────────────────────────────────────────────────────

function getSiteCounts() {
  let sites = 0, affSites = 0, scripts = 0;
  try { sites    = fs.readdirSync(SITES_DIR).length;   } catch {}
  try { affSites = fs.readdirSync(AFF_DIR).length;     } catch {}
  try { scripts  = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js') || f.endsWith('.sh') || f.endsWith('.py')).length; } catch {}
  return { sites, affSites, scripts };
}

// ── RECENT MEMORY FILES ───────────────────────────────────────────────────────

function getRecentMemory() {
  const todayStr = today();
  const files = [];

  // Today's daily notes
  const todayFile = path.join(MEMORY_DIR, `${todayStr}.md`);
  if (fs.existsSync(todayFile)) {
    files.push({ label: `Daily Notes — ${todayStr}`, content: readFile(todayFile) });
  }

  // Today's ads audit
  const adsFile = path.join(MEMORY_DIR, `ads-audit-${todayStr}.md`);
  if (fs.existsSync(adsFile)) {
    files.push({ label: `Google Ads Audit — ${todayStr}`, content: readFile(adsFile) });
  }

  // Yesterday
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const ydStr = yd.toISOString().slice(0, 10);
  const ydFile = path.join(MEMORY_DIR, `${ydStr}.md`);
  if (fs.existsSync(ydFile) && ydStr !== todayStr) {
    const content = readFile(ydFile);
    if (content && content.trim().length > 100) {
      files.push({ label: `Daily Notes — ${ydStr}`, content });
    }
  }

  // Weekly indexing (most recent)
  const weeklyFiles = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.startsWith('weekly-indexing-'))
    .sort().reverse().slice(0, 1);
  for (const f of weeklyFiles) {
    files.push({ label: `Weekly Indexing — ${f.replace('weekly-indexing-','').replace('.md','')}`, content: readFile(path.join(MEMORY_DIR, f)) });
  }

  return files;
}

// ── HTML EMAIL BUILDER ────────────────────────────────────────────────────────

function buildEmail(data) {
  const { todayStr, memory, cronJobs, credHealth, envKeys, siteCounts, recentFiles } = data;

  const section = (title, icon, color, body) => `
  <div style="margin:20px 0;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="background:${color};color:#fff;padding:10px 16px;font-weight:600;font-size:14px">
      ${icon} ${escHtml(title)}
    </div>
    <div style="background:#fff;padding:14px 16px;font-size:13px;line-height:1.6;color:#334155">
      ${body}
    </div>
  </div>`;

  const kv = (k, v, warn) => `
    <tr>
      <td style="padding:3px 8px;font-weight:600;color:#475569;white-space:nowrap">${escHtml(k)}</td>
      <td style="padding:3px 8px;color:${warn ? '#dc2626' : '#1e293b'}">${escHtml(v)}</td>
    </tr>`;

  // ── Credential health table ──
  const credRows = credHealth.map(c => {
    const warn = c.status.includes('MISSING') || c.status.includes('CORRUPT') || c.status.includes('EXPIRED');
    return kv(c.label, `${c.status} — ${c.detail}`, warn);
  }).join('');

  // ── Cron jobs table ──
  let cronHtml = '<p style="color:#64748b;font-style:italic">Gateway API not reachable — check cron status manually.</p>';
  if (cronJobs && cronJobs.length) {
    const rows = cronJobs.map(j => {
      const err  = j.state?.consecutiveErrors > 0;
      const name = j.name || j.id;
      const sched = j.schedule?.expr || j.schedule?.kind || '?';
      const last = j.state?.lastRunStatus || 'never';
      const errs = j.state?.consecutiveErrors || 0;
      const enabled = j.enabled !== false ? '✅' : '⏸';
      return `<tr style="background:${err ? '#fff1f2' : 'transparent'}">
        <td style="padding:3px 8px;white-space:nowrap">${enabled} ${escHtml(name)}</td>
        <td style="padding:3px 8px;font-family:monospace;font-size:11px">${escHtml(sched)}</td>
        <td style="padding:3px 8px;color:${err ? '#dc2626' : '#16a34a'}">${escHtml(last)}${errs ? ` (${errs} err)` : ''}</td>
      </tr>`;
    }).join('');
    cronHtml = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:4px 8px;text-align:left">Job</th>
        <th style="padding:4px 8px;text-align:left">Schedule</th>
        <th style="padding:4px 8px;text-align:left">Last Status</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ── Env keys list ──
  const envHtml = envKeys.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${envKeys.map(k => `<span style="background:#f1f5f9;padding:2px 8px;border-radius:3px;font-family:monospace;font-size:11px">${escHtml(k)}</span>`).join('')}</div>`
    : '<p style="color:#64748b">No .env file found.</p>';

  // ── Site counts ──
  const countsHtml = `<table style="border-collapse:collapse;font-size:13px">
    ${kv('Affiliate Sites (sites/)', `${siteCounts.sites} dirs`)}
    ${kv('Affiliate Sites (affiliate-sites/)', `${siteCounts.affSites} dirs`)}
    ${kv('Scripts', `${siteCounts.scripts} files`)}
  </table>`;

  // ── MEMORY.md (first 200 lines) ──
  const memLines = (memory || '').split('\n').slice(0, 200).join('\n');
  const memHtml  = `<pre style="font-size:11px;line-height:1.5;white-space:pre-wrap;color:#334155;background:#f8fafc;padding:12px;border-radius:4px;max-height:600px;overflow:auto">${escHtml(memLines)}</pre>`;

  // ── Recent files ──
  const recentHtml = recentFiles.map(f => `
    <details style="margin:8px 0;border:1px solid #e2e8f0;border-radius:4px">
      <summary style="padding:8px 12px;cursor:pointer;font-weight:600;background:#f8fafc;border-radius:4px">${escHtml(f.label)}</summary>
      <pre style="font-size:11px;line-height:1.5;white-space:pre-wrap;color:#334155;padding:12px;margin:0;max-height:500px;overflow:auto">${escHtml((f.content || '').slice(0, 8000))}</pre>
    </details>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Axl Brain Dump — ${todayStr}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:800px;margin:20px auto;padding:0 16px">

  <div style="background:linear-gradient(135deg,#1e3a8a,#1a56db);color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:22px">🧠 Axl Daily Brain Dump</h1>
    <p style="margin:6px 0 0;opacity:.85;font-size:14px">${todayStr} — Generated at ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC</p>
  </div>

  ${section('Credential Health', '🔑', '#059669', `<table style="width:100%;border-collapse:collapse">${credRows}</table>`)}
  ${section('Site & Script Counts', '📊', '#7c3aed', countsHtml)}
  ${section('Environment Keys (.env)', '🔐', '#0369a1', envHtml)}
  ${section('Cron Jobs', '⏰', '#b45309', cronHtml)}
  ${section('Recent Activity', '📝', '#0891b2', recentHtml || '<p style="color:#64748b">No recent files found.</p>')}
  ${section('MEMORY.md (first 200 lines)', '🧠', '#374151', memHtml)}

  <div style="text-align:center;padding:16px;color:#94a3b8;font-size:11px;margin-top:8px">
    Axl Affiliate Mailer · info@brazenauto.com · ${todayStr}
  </div>
</div>
</body>
</html>`;

  return html;
}

// ── SMTP SEND ─────────────────────────────────────────────────────────────────
// Pure Node SMTP via STARTTLS (no nodemailer dependency)

function smtpCommand(sock, cmd) {
  return new Promise((resolve, reject) => {
    sock.write(cmd + '\r\n');
    const handler = (data) => {
      const s = data.toString();
      const code = parseInt(s.slice(0, 3), 10);
      if (code >= 400) { sock.removeListener('data', handler); reject(new Error(`SMTP ${code}: ${s.trim()}`)); }
      else if (code >= 200 && code < 400) { sock.removeListener('data', handler); resolve(s); }
    };
    sock.on('data', handler);
  });
}

function waitFor(sock, codePrefix) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const handler = (data) => {
      buf += data.toString();
      const lines = buf.split('\r\n');
      for (const line of lines) {
        if (line.startsWith(codePrefix + ' ') || line.startsWith(codePrefix + '-')) {
          const code = parseInt(line.slice(0, 3), 10);
          if (code >= 400) { sock.removeListener('data', handler); reject(new Error(`SMTP error: ${line.trim()}`)); return; }
          if (line.startsWith(codePrefix + ' ')) { sock.removeListener('data', handler); resolve(buf); return; }
        }
      }
    };
    sock.on('data', handler);
  });
}

async function sendEmail(smtpCreds, to, subject, htmlBody) {
  const { host, port, user, pass } = smtpCreds;
  const from = smtpCreds.from || `Axl <${user}>`;

  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host, async () => {
      try {
        await waitFor(sock, '220');
        await smtpCommand(sock, `EHLO axl-braindump`);
        // Wait for multi-line EHLO response
        await new Promise(r => setTimeout(r, 300));

        // STARTTLS
        sock.write('STARTTLS\r\n');
        await waitFor(sock, '220');

        // Upgrade to TLS
        const tlsSock = tls.connect({ socket: sock, servername: host }, async () => {
          try {
            tlsSock.write('EHLO axl-braindump\r\n');
            await waitFor(tlsSock, '250');

            // AUTH LOGIN
            tlsSock.write('AUTH LOGIN\r\n');
            await waitFor(tlsSock, '334');
            tlsSock.write(Buffer.from(user).toString('base64') + '\r\n');
            await waitFor(tlsSock, '334');
            tlsSock.write(Buffer.from(pass).toString('base64') + '\r\n');
            await waitFor(tlsSock, '235');

            // MAIL FROM
            tlsSock.write(`MAIL FROM:<${user}>\r\n`);
            await waitFor(tlsSock, '250');

            // RCPT TO
            tlsSock.write(`RCPT TO:<${to}>\r\n`);
            await waitFor(tlsSock, '250');

            // DATA
            tlsSock.write('DATA\r\n');
            await waitFor(tlsSock, '354');

            // Headers + body
            const boundary = `boundary_${Date.now()}_axl`;
            const msgDate = new Date().toUTCString();
            const mime = [
              `From: ${from}`,
              `To: ${to}`,
              `Subject: ${subject}`,
              `Date: ${msgDate}`,
              `MIME-Version: 1.0`,
              `Content-Type: multipart/alternative; boundary="${boundary}"`,
              '',
              `--${boundary}`,
              'Content-Type: text/plain; charset=utf-8',
              '',
              'This is the Axl Daily Brain Dump. Please view in an HTML email client.',
              '',
              `--${boundary}`,
              'Content-Type: text/html; charset=utf-8',
              'Content-Transfer-Encoding: quoted-printable',
              '',
              htmlBody,
              '',
              `--${boundary}--`,
              '.',
              ''
            ].join('\r\n');

            tlsSock.write(mime + '\r\n');
            await waitFor(tlsSock, '250');

            tlsSock.write('QUIT\r\n');
            tlsSock.destroy();
            resolve({ ok: true });
          } catch (e) {
            tlsSock.destroy();
            reject(e);
          }
        });
        tlsSock.on('error', reject);
      } catch (e) {
        sock.destroy();
        reject(e);
      }
    });
    sock.on('error', reject);
    sock.setTimeout(20000, () => { sock.destroy(); reject(new Error('SMTP TCP timeout')); });
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const todayStr = today();
  console.log(`[brain-dump] Starting — ${todayStr}`);

  // Load SMTP creds
  if (!fs.existsSync(SMTP_CREDS)) {
    console.error('[brain-dump] FATAL: SMTP credentials not found at', SMTP_CREDS);
    process.exit(1);
  }
  const smtpCreds = readJson(SMTP_CREDS);
  if (!smtpCreds) {
    console.error('[brain-dump] FATAL: Could not parse SMTP credentials');
    process.exit(1);
  }

  // Collect data
  console.log('[brain-dump] Collecting data...');
  const memory      = readFile(MEMORY_MD) || '';
  const credHealth  = checkCreds();
  const envKeys     = getEnvSummary();
  const siteCounts  = getSiteCounts();
  const recentFiles = getRecentMemory();

  // Try to fetch cron jobs
  console.log('[brain-dump] Fetching cron jobs...');
  let cronJobs = null;
  try { cronJobs = await fetchCronJobs(); } catch { /* silent */ }
  console.log(`[brain-dump] Cron jobs: ${cronJobs ? cronJobs.length : 'unavailable'}`);

  // Build HTML
  console.log('[brain-dump] Building email...');
  const html = buildEmail({ todayStr, memory, cronJobs, credHealth, envKeys, siteCounts, recentFiles });

  // Send
  const to      = 'walkwayinc@gmail.com';
  const subject = `🧠 Axl Brain Dump — ${todayStr}`;
  console.log(`[brain-dump] Sending to ${to}...`);

  try {
    await sendEmail(smtpCreds, to, subject, html);
    console.log(`[brain-dump] ✅ Email sent successfully to ${to}`);
  } catch (e) {
    console.error('[brain-dump] ❌ Send failed:', e.message);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[brain-dump] Unhandled error:', e);
  process.exit(1);
});
