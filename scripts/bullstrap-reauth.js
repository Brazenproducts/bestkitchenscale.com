#!/usr/bin/env node
/**
 * Bull Strap Google Indexing API — Re-Authorization Script
 *
 * Run this when the refresh token expires (invalid_grant error).
 * It will print a URL — open it in a browser logged in as info@bullstrap.com,
 * approve access, then paste the code back here.
 *
 * Updates .bullstrap-indexing-credentials.json with the new refresh token.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CREDS_FILE = path.join(__dirname, '../.bullstrap-indexing-credentials.json');
const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));

const CLIENT_ID = creds.client_id;
const CLIENT_SECRET = creds.client_secret;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPE = 'https://www.googleapis.com/auth/indexing';

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n=== Bull Strap Google Indexing API — Re-Authorization ===\n');
console.log('1. Open this URL in a browser logged in as info@bullstrap.com:\n');
console.log(authUrl);
console.log('\n2. Approve access, then copy the authorization code shown.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('3. Paste the authorization code here: ', async (code) => {
  rl.close();
  code = code.trim();

  const postData = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  }).toString();

  const options = {
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = https.request(options, res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      const data = JSON.parse(body);
      if (data.error) {
        console.error('\n❌ Error:', data.error, data.error_description);
        process.exit(1);
      }
      if (!data.refresh_token) {
        console.error('\n❌ No refresh_token in response. Make sure you used prompt=consent.');
        console.error('Response:', JSON.stringify(data, null, 2));
        process.exit(1);
      }

      // Update credentials file
      const updated = {
        ...creds,
        refresh_token: data.refresh_token,
        token_type: data.token_type || 'Bearer'
      };
      fs.writeFileSync(CREDS_FILE, JSON.stringify(updated, null, 2));

      console.log('\n✅ Success! New refresh token saved to .bullstrap-indexing-credentials.json');
      console.log('You can now run the indexing script normally.');

      // Quick test
      console.log('\nTesting new token...');
      const testParams = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: 'refresh_token'
      }).toString();

      const testReq = https.request({
        hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }, res => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => {
          const t = JSON.parse(b);
          if (t.access_token) {
            console.log('✅ Token test passed — indexing API is ready.');
          } else {
            console.error('❌ Token test failed:', b);
          }
        });
      });
      testReq.write(testParams);
      testReq.end();
    });
  });
  req.on('error', e => { console.error('Request error:', e); process.exit(1); });
  req.write(postData);
  req.end();
});
