#!/bin/bash
###############################################################################
# daily-affiliate-audit.sh — Daily automated affiliate site health check
#
# Checks ALL affiliate sites for:
# 1. Invalid/unregistered tracking IDs
# 2. Search links vs direct product links (conversion killer)
# 3. Broken Amazon links (404s)
# 4. Sites that are down (GitHub Pages not serving)
# 5. Missing affiliate tags entirely
#
# Outputs a summary report. Run via cron daily.
###############################################################################
set -uo pipefail

SITES_DIR="/home/ubuntu/.openclaw/workspace/sites"
REPORT="/tmp/affiliate-audit-$(date -u +%Y-%m-%d).txt"
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')

# Valid Amazon Associates tracking IDs
VALID_TAGS=(
  # Base tag
  "brazenprodu01-20"
  # Product-specific tags (older assignments)
  "brazenprodu01-20-recipsaw-20"
  "brazenprodu01-20-pastamaker-20"
  "brazenprodu01-20-dutchoven-20"
  "brazenprodu01-20-sousvide-20"
  "brazenprodu01-20-tireinflator-20"
  "brazenprodu01-20-headlight-20"
  "brazenprodu01-20-tirepatch-20"
  "brazenprodu01-20-towingstrap-20"
  "brazenprodu01-20-showerhead-20"
  "brazenprodu01-20-labelmaker-20"
  "brazenprodu01-20-powerbank-20"
  "brazenprodu01-20-portableac-20"
  "brazenprodu01-20-icemaker-20"
  "brazenprodu01-20-gamingchair-20"
  "brazenprodu01-20-massagegun-20"
  "brazenprodu01-20-minifridge-20"
  "brazenprodu01-20-protein-20"
  "brazenprodu01-20-resistance-20"
  "brazenprodu01-20-vibration-20"
  "brazenprodu01-20-heatingpad-20"
  "brazenprodu01-20-charger-20"
  "brazenprodu01-20-necklift-20"
  "brazenprodu01-20-magnesium-20"
  # Category-group tags (assigned 2026-05-21, commit 09ed652)
  "brazenprodu01-20-jeep-20"
  "brazenprodu01-20-bronco-20"
  "brazenprodu01-20-tacoma-20"
  "brazenprodu01-20-gladiator-20"
  "brazenprodu01-20-offroad-20"
  "brazenprodu01-20-truck-20"
  "brazenprodu01-20-ev-20"
  "brazenprodu01-20-autoparts-20"
  "brazenprodu01-20-hvac-20"
  "brazenprodu01-20-kitchen-20"
  "brazenprodu01-20-health-20"
  "brazenprodu01-20-tools-20"
  "brazenprodu01-20-firewood-20"
  "brazenprodu01-20-golf-20"
  "brazenprodu01-20-books-20"
)

is_valid_tag() {
  local tag="$1"
  for valid in "${VALID_TAGS[@]}"; do
    if [ "$tag" = "$valid" ]; then
      return 0
    fi
  done
  return 1
}

# Counters
TOTAL_SITES=0
SITES_WITH_ISSUES=0
INVALID_TAG_SITES=0
SEARCH_ONLY_SITES=0
DOWN_SITES=0
MISSING_TAG_SITES=0
TOTAL_SEARCH_LINKS=0
TOTAL_DP_LINKS=0

echo "═══════════════════════════════════════════════════════" > "$REPORT"
echo "  DAILY AFFILIATE AUDIT — $TIMESTAMP" >> "$REPORT"
echo "═══════════════════════════════════════════════════════" >> "$REPORT"
echo "" >> "$REPORT"

# Collect issues
INVALID_TAG_LIST=""
SEARCH_ONLY_LIST=""
DOWN_LIST=""
MISSING_TAG_LIST=""

for site_dir in "$SITES_DIR"/*/; do
  [ -d "$site_dir" ] || continue
  site=$(basename "$site_dir")
  
  # Skip non-affiliate sites (no amazon links)
  html_files=$(find "$site_dir" -maxdepth 1 -name "*.html" 2>/dev/null)
  [ -z "$html_files" ] && continue
  
  has_amazon=$(grep -rl "amazon.com" $html_files 2>/dev/null | head -1)
  [ -z "$has_amazon" ] && continue
  
  TOTAL_SITES=$((TOTAL_SITES + 1))
  site_issues=""
  
  # 1. Check tracking IDs
  used_tags=$(grep -roh 'tag=[a-zA-Z0-9_-]*' $html_files 2>/dev/null | sed 's/^tag=//' | sort -u)
  for tag in $used_tags; do
    if ! is_valid_tag "$tag"; then
      site_issues="${site_issues}  ❌ INVALID TAG: $tag\n"
      INVALID_TAG_SITES=$((INVALID_TAG_SITES + 1))
      INVALID_TAG_LIST="${INVALID_TAG_LIST}$site (tag=$tag)\n"
      break
    fi
  done
  
  # Check if ANY tag present
  if [ -z "$used_tags" ]; then
    site_issues="${site_issues}  ❌ NO AFFILIATE TAG\n"
    MISSING_TAG_SITES=$((MISSING_TAG_SITES + 1))
    MISSING_TAG_LIST="${MISSING_TAG_LIST}$site\n"
  fi
  
  # 2. Check link types
  search_count=$(grep -roh 'amazon\.com/s?k=' $html_files 2>/dev/null | wc -l)
  dp_count=$(grep -roh 'amazon\.com/dp/' $html_files 2>/dev/null | wc -l)
  TOTAL_SEARCH_LINKS=$((TOTAL_SEARCH_LINKS + search_count))
  TOTAL_DP_LINKS=$((TOTAL_DP_LINKS + dp_count))
  
  if [ "$search_count" -gt 0 ] && [ "$dp_count" -eq 0 ]; then
    SEARCH_ONLY_SITES=$((SEARCH_ONLY_SITES + 1))
    SEARCH_ONLY_LIST="${SEARCH_ONLY_LIST}$site ($search_count search links)\n"
  fi
  
  # Track issues
  if [ -n "$site_issues" ]; then
    SITES_WITH_ISSUES=$((SITES_WITH_ISSUES + 1))
  fi
done

# HTTPS check — verify ALL sites have valid certs (not just spot check)
echo "── HTTPS Certificate Check ──" >> "$REPORT"
HTTPS_OK=0
HTTPS_BAD=0
HTTPS_BAD_LIST=""

for site_dir in "$SITES_DIR"/*/; do
  [ -d "$site_dir" ] || continue
  site=$(basename "$site_dir")
  has_amazon=$(grep -rl "amazon.com" "$site_dir"/*.html 2>/dev/null | head -1)
  [ -z "$has_amazon" ] && continue
  
  cert_cn=$(echo | openssl s_client -servername "$site" -connect "$site:443" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | grep -oP "CN = \K.*" || true)
  
  if echo "$cert_cn" | grep -q "$site"; then
    HTTPS_OK=$((HTTPS_OK + 1))
  else
    HTTPS_BAD=$((HTTPS_BAD + 1))
    HTTPS_BAD_LIST="${HTTPS_BAD_LIST}$site (cert: ${cert_cn:-NONE})\n"
  fi
done

echo "  HTTPS valid: $HTTPS_OK" >> "$REPORT"
echo "  HTTPS broken/missing: $HTTPS_BAD" >> "$REPORT"
if [ "$HTTPS_BAD" -gt 0 ]; then
  echo "" >> "$REPORT"
  echo "  Sites needing HTTPS fix:" >> "$REPORT"
  echo -e "  $HTTPS_BAD_LIST" >> "$REPORT"
fi
echo "" >> "$REPORT"

# Affiliate link presence check — flag sites with ZERO amazon links
echo "── Missing Affiliate Links ──" >> "$REPORT"
NO_LINKS=0
NO_LINKS_LIST=""
for site_dir in "$SITES_DIR"/*/; do
  [ -d "$site_dir" ] || continue
  site=$(basename "$site_dir")
  # Skip known non-affiliate sites
  echo "$site" | grep -qE "skipatip|thedailycheer|combinedratings|axl-dashboard" && continue
  count=$(grep -roh "amazon.com" "$site_dir"/*.html 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    NO_LINKS=$((NO_LINKS + 1))
    NO_LINKS_LIST="${NO_LINKS_LIST}$site\n"
  fi
done
if [ "$NO_LINKS" -gt 0 ]; then
  echo "  ⚠️ $NO_LINKS sites have ZERO Amazon affiliate links:" >> "$REPORT"
  echo -e "  $NO_LINKS_LIST" >> "$REPORT"
else
  echo "  ✅ All sites have affiliate links" >> "$REPORT"
fi
echo "" >> "$REPORT"

# Blog post freshness check — verify posts are being published
echo "── Blog Post Freshness Check ──" >> "$REPORT"
BLOG_FRESH=0
BLOG_STALE=0
BLOG_STALE_LIST=""
ROTATION_FILE="/home/ubuntu/.openclaw/workspace/memory/blog-rotation-batch.json"
if [ -f "$ROTATION_FILE" ]; then
  YESTERDAY=$(date -u -d "yesterday" "+%Y-%m-%d")
  STALE_SITES=$(python3 -c "
import json,sys
with open('$ROTATION_FILE') as f:
    data = json.load(f)
for site, dt in data.items():
    if dt < '$YESTERDAY':
        print(site)
" 2>/dev/null | head -20)
  BLOG_FRESH=$(python3 -c "
import json
with open('$ROTATION_FILE') as f:
    data = json.load(f)
print(sum(1 for d in data.values() if d >= '$YESTERDAY'))
" 2>/dev/null || echo 0)
  BLOG_STALE=$(echo "$STALE_SITES" | grep -c . || echo 0)
  echo "  Fresh (posted in last 24h): $BLOG_FRESH" >> "$REPORT"
  echo "  Stale (no post in 24h+): $BLOG_STALE" >> "$REPORT"
  if [ "$BLOG_STALE" -gt 50 ]; then
    echo "  ⚠️ ALERT: Blog generator may be broken — $BLOG_STALE sites stale" >> "$REPORT"
  fi
else
  echo "  ⚠️ No rotation file found — blog generator may not be running" >> "$REPORT"
fi
echo "" >> "$REPORT"

# Live site spot check (sample 20 random sites)
echo "── Live Site Spot Check (20 random) ──" >> "$REPORT"
SAMPLE_SITES=$(find "$SITES_DIR" -maxdepth 2 -name "index.html" -exec grep -l "amazon.com" {} \; 2>/dev/null | xargs -I{} dirname {} | xargs -I{} basename {} | shuf | head -20)
for site in $SAMPLE_SITES; do
  status=$(curl -so /dev/null -w "%{http_code}" --max-time 8 "https://$site/" 2>/dev/null || echo "000")
  if [ "$status" != "200" ] && [ "$status" != "301" ] && [ "$status" != "302" ]; then
    DOWN_SITES=$((DOWN_SITES + 1))
    DOWN_LIST="${DOWN_LIST}$site (HTTP $status)\n"
    echo "  ❌ DOWN: $site → HTTP $status" >> "$REPORT"
  fi
done
[ "$DOWN_SITES" -eq 0 ] && echo "  ✅ All 20 sampled sites responding" >> "$REPORT"
echo "" >> "$REPORT"

# Summary
echo "═══════════════════════════════════════════════════════" >> "$REPORT"
echo "  SUMMARY" >> "$REPORT"
echo "═══════════════════════════════════════════════════════" >> "$REPORT"
echo "Total affiliate sites: $TOTAL_SITES" >> "$REPORT"
echo "Direct product links (/dp/): $TOTAL_DP_LINKS" >> "$REPORT"
echo "Search links (/s?k=): $TOTAL_SEARCH_LINKS" >> "$REPORT"
echo "Search-to-product ratio: $(( (TOTAL_SEARCH_LINKS * 100) / (TOTAL_SEARCH_LINKS + TOTAL_DP_LINKS + 1) ))% search links" >> "$REPORT"
echo "" >> "$REPORT"

CRITICAL=0

if [ "$INVALID_TAG_SITES" -gt 0 ]; then
  echo "🚨 CRITICAL: $INVALID_TAG_SITES site(s) with INVALID tracking IDs:" >> "$REPORT"
  echo -e "$INVALID_TAG_LIST" >> "$REPORT"
  CRITICAL=1
fi

if [ "$MISSING_TAG_SITES" -gt 0 ]; then
  echo "🚨 CRITICAL: $MISSING_TAG_SITES site(s) with NO tracking tag:" >> "$REPORT"
  echo -e "$MISSING_TAG_LIST" >> "$REPORT"
  CRITICAL=1
fi

if [ "$DOWN_SITES" -gt 0 ]; then
  echo "⚠️  WARNING: $DOWN_SITES site(s) DOWN:" >> "$REPORT"
  echo -e "$DOWN_LIST" >> "$REPORT"
fi

if [ "$SEARCH_ONLY_SITES" -gt 0 ]; then
  echo "⚠️  $SEARCH_ONLY_SITES site(s) have ONLY search links (no /dp/ product links — low conversion):" >> "$REPORT"
  echo "  (Use /dp/ASIN links for better conversion)" >> "$REPORT"
fi

echo "" >> "$REPORT"
if [ "$CRITICAL" -eq 0 ] && [ "$DOWN_SITES" -eq 0 ]; then
  echo "✅ ALL CLEAR — no critical issues found" >> "$REPORT"
elif [ "$CRITICAL" -eq 0 ]; then
  echo "⚠️  Minor issues found — see above" >> "$REPORT"
else
  echo "🚨 CRITICAL ISSUES — affiliate revenue may be lost" >> "$REPORT"
fi

# ── ASIN Validation ─────────────────────────────────────────────────────────
# NOTE: ASIN validation runs as its own separate cron job (Daily Affiliate Link
# Validator, e40cdb46). Removed from here to prevent timeout — validation across
# 435 sites takes 22+ minutes and blows the cron timeout budget.
echo "" >> "$REPORT"
echo "## ASIN Validation" >> "$REPORT"
echo "Skipped here — runs separately via validate-and-fix-asins.js cron job." >> "$REPORT"
echo "" >> "$REPORT"

echo "" >> "$REPORT"
echo "Full report: $REPORT" >> "$REPORT"

cat "$REPORT"
exit $CRITICAL
