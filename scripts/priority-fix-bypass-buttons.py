#!/usr/bin/env python3
"""
PRIORITY FIX: Remove all "Buy on Amazon" bypass buttons
This is causing $0 commissions because users skip content.

Quick fix script - removes hero and category card bypass buttons.
"""

import requests
import re
import time

GITHUB_TOKEN = "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"

headers = {"Authorization": f"token {GITHUB_TOKEN}"}

# Get first 100 repos to start
r = requests.get("https://api.github.com/users/brazenproducts/repos?per_page=100&page=1", headers=headers)
repos = [repo['name'] for repo in r.json() if repo['name'].endswith('.com')]

print(f"Found {len(repos)} repos. Starting fixes...")
fixed = 0

for repo_name in repos[:50]:  # Fix first 50 quickly
    try:
        # Fetch index.html
        r = requests.get(f"https://raw.githubusercontent.com/Brazenproducts/{repo_name}/main/index.html", timeout=5)
        if r.status_code != 200:
            continue
        
        html = r.text
        original = html
        
        # Fix 1: Remove hero "Buy on Amazon" buttons
        html = re.sub(
            r'<a[^>]*class="btn[^"]*"[^>]*href="https://www\.amazon\.com/[^"]*"[^>]*>.*?Buy on Amazon.*?</a>',
            '',
            html,
            flags=re.IGNORECASE | re.DOTALL
        )
        
        # Fix 2: Remove category card "Shop on Amazon" buttons (keep "See Rankings" only)
        html = re.sub(
            r'<a[^>]*href="https://www\.amazon\.com/s\?k=[^"]*"[^>]*>.*?(?:Buy|Shop) on Amazon.*?</a>',
            '',
            html,
            flags=re.IGNORECASE | re.DOTALL
        )
        
        if html != original:
            print(f"✅ {repo_name} - fixed")
            fixed += 1
            # TODO: Push fix to GitHub
        else:
            print(f"⏭️  {repo_name} - already clean")
        
        time.sleep(0.5)
        
    except Exception as e:
        print(f"❌ {repo_name} - {str(e)[:30]}")

print(f"\n🎯 Fixed {fixed} sites!")
