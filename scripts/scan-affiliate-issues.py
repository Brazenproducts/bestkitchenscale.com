#!/usr/bin/env python3
"""
Scan all affiliate sites for common issues:
1. Using Bartact CDN images (this is OK)
2. Using Amazon search links instead of /dp/ASIN product links (BAD - low commission)
3. Broken/404 images
4. Missing affiliate tag

Usage: python3 scan-affiliate-issues.py
"""

import requests
import json
import re
from collections import defaultdict

GITHUB_TOKEN = "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"
CORRECT_TAG = "brazenprodu01-20"

issues = defaultdict(list)

# Get all repos
headers = {"Authorization": f"token {GITHUB_TOKEN}"}
repos = []
for page in range(1, 6):  # First 500 repos
    r = requests.get(f"https://api.github.com/users/brazenproducts/repos?per_page=100&page={page}", headers=headers)
    if r.status_code != 200:
        break
    batch = r.json()
    if not batch:
        break
    repos.extend([repo['name'] for repo in batch])

print(f"Found {len(repos)} repos")
print(f"Scanning first 50 for common issues...\n")

checked = 0
for repo_name in repos[:50]:  # Sample first 50
    domain = repo_name.replace('-com', '.com')
    if not domain.endswith('.com'):
        continue
    
    try:
        # Check if site is live
        r = requests.get(f"https://{domain}/", timeout=5)
        if r.status_code != 200:
            issues[domain].append(f"Site not responding: {r.status_code}")
            continue
        
        html = r.text
        checked += 1
        
        # Check for Amazon search links (bad)
        search_links = re.findall(r'href="https://www\.amazon\.com/s\?k=[^"]+', html)
        if search_links:
            issues[domain].append(f"❌ {len(search_links)} Amazon SEARCH links (should be /dp/ASIN)")
        
        # Check for ASIN product links (good)
        asin_links = re.findall(r'href="https://www\.amazon\.com/dp/[A-Z0-9]{10}', html)
        if asin_links:
            issues[domain].append(f"✅ {len(asin_links)} direct ASIN links (good!)")
        
        # Check affiliate tag
        if CORRECT_TAG not in html:
            issues[domain].append("⚠️  Missing affiliate tag brazenprodu01-20")
        
        # Check for Bartact CDN images (informational only)
        bartact_imgs = re.findall(r'src="https://bartact\.com/cdn/[^"]+', html)
        if bartact_imgs:
            issues[domain].append(f"ℹ️  {len(bartact_imgs)} Bartact CDN images (OK)")
        
        # Check for broken image patterns
        placeholder_imgs = re.findall(r'alt="[^"]*product category[^"]*"', html)
        if placeholder_imgs:
            issues[domain].append(f"⚠️  {len(placeholder_imgs)} placeholder images")
        
    except Exception as e:
        issues[domain].append(f"Error scanning: {str(e)[:50]}")

print(f"\nScanned {checked} live sites\n")
print("="*60)

# Print summary
search_link_sites = [d for d, errs in issues.items() if any('SEARCH links' in e for e in errs)]
print(f"\n🚨 {len(search_link_sites)} sites with Amazon SEARCH links (need /dp/ASIN fixes):")
for d in search_link_sites[:10]:
    print(f"  - {d}")
if len(search_link_sites) > 10:
    print(f"  ... and {len(search_link_sites) - 10} more")

# Save full report
with open('/tmp/affiliate-issues-report.json', 'w') as f:
    json.dump(dict(issues), f, indent=2)

print(f"\nFull report saved to: /tmp/affiliate-issues-report.json")
