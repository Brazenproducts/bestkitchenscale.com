#!/usr/bin/env node
/**
 * DOMAIN PROTECTION VALIDATOR
 * 
 * Checks if a domain is protected before building.
 * Usage: node check-protected.js <domain>
 * Exit codes: 0 = safe, 1 = PROTECTED (do not build)
 */

const fs = require('fs');
const path = require('path');

const PROTECTED_FILE = path.join(__dirname, 'PROTECTED_DOMAINS.md');

function loadProtectedDomains() {
  try {
    const content = fs.readFileSync(PROTECTED_FILE, 'utf8');
    const domains = [];
    
    // Extract all domains from markdown
    // Matches: "- domain.com" or "- **domain.com**" or "**domain.com**"
    const lines = content.split('\n');
    for (const line of lines) {
      // Match lines like "- **domain.com**" or "- domain.com"
      const match1 = line.match(/^-\s+\*\*([a-z0-9.-]+\.[a-z]+)\*\*/);
      const match2 = line.match(/^-\s+([a-z0-9.-]+\.[a-z]+)/);
      
      if (match1) {
        domains.push(match1[1].toLowerCase());
      } else if (match2) {
        domains.push(match2[1].toLowerCase());
      }
    }
    
    return domains;
  } catch (err) {
    console.error('⚠️  WARNING: Could not read PROTECTED_DOMAINS.md');
    return [];
  }
}

function isProtected(domain) {
  const protected = loadProtectedDomains();
  const checkDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  
  return protected.includes(checkDomain);
}

// CLI usage
if (require.main === module) {
  const domain = process.argv[2];
  
  if (!domain) {
    console.error('Usage: node check-protected.js <domain>');
    process.exit(2);
  }
  
  if (isProtected(domain)) {
    console.error(`🚨 PROTECTED DOMAIN: ${domain}`);
    console.error('❌ This domain is a live business. DO NOT BUILD OVER IT.');
    console.error('📋 See PROTECTED_DOMAINS.md for full list.');
    process.exit(1);
  } else {
    console.log(`✅ ${domain} - Safe to build`);
    process.exit(0);
  }
}

module.exports = { isProtected, loadProtectedDomains };
