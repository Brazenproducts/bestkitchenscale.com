#!/bin/bash
###############################################################################
# fix-github-pages-https.sh — Enable HTTPS on ALL affiliate site repos
#
# Phase 1: Re-set custom domain on every repo (triggers cert provisioning)
# Phase 2: Wait, then enable https_enforced on every repo
#
# GitHub needs ~15-60 min to provision certs after domain is set.
# Run Phase 1 first, then Phase 2 later (or this script does both with a wait).
#
# Usage:
#   ./scripts/fix-github-pages-https.sh           # Run both phases
#   ./scripts/fix-github-pages-https.sh phase1     # Only trigger cert provisioning
#   ./scripts/fix-github-pages-https.sh phase2     # Only enable HTTPS (after certs exist)
###############################################################################
set -uo pipefail

# Load GitHub token from secrets file if not already in environment
SECRETS_FILE="/home/ubuntu/.openclaw/secrets/github.env"
if [ -f "$SECRETS_FILE" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
fi

SITES_DIR="/home/ubuntu/.openclaw/workspace/sites"
TOKEN="${GITHUB_TOKEN:-}"
ORG="Brazenproducts"
PHASE="${1:-both}"
LOG="/tmp/https-fix-$(date -u +%Y%m%d-%H%M).log"
RATE_DELAY=1  # seconds between API calls to avoid rate limiting

echo "═══════════════════════════════════════════════════════" | tee "$LOG"
echo "  GitHub Pages HTTPS Fix — $(date -u '+%Y-%m-%d %H:%M UTC')" | tee -a "$LOG"
echo "  Phase: $PHASE" | tee -a "$LOG"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# Build list of all affiliate site repos
get_repo_name() {
  local site_dir="$1"
  local remote=$(git -C "$site_dir" remote get-url origin 2>/dev/null || true)
  # Extract repo name from remote URL (last part, strip .git)
  echo "$remote" | grep -oP '[^/]+\.git$' | sed 's/\.git$//' || true
}

get_domain() {
  local site_dir="$1"
  cat "$site_dir/CNAME" 2>/dev/null || basename "$site_dir"
}

###############################################################################
# PHASE 1: Re-set custom domains to trigger cert provisioning
###############################################################################
run_phase1() {
  echo "── Phase 1: Triggering cert provisioning ──" | tee -a "$LOG"
  local triggered=0
  local skipped=0
  local failed=0
  local already_https=0

  for site_dir in "$SITES_DIR"/*/; do
    [ -d "$site_dir/.git" ] || continue
    
    local site=$(basename "$site_dir")
    local repo=$(get_repo_name "$site_dir")
    local domain=$(get_domain "$site_dir")
    
    [ -z "$repo" ] && continue
    
    # Check if site has amazon links (is affiliate site)
    local has_amazon=$(grep -rl "amazon.com" "$site_dir"/*.html 2>/dev/null | head -1)
    [ -z "$has_amazon" ] && continue

    # Check current pages status
    local pages_json=$(curl -s -H "Authorization: token $TOKEN" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$ORG/$repo/pages" 2>/dev/null)
    
    local status=$(echo "$pages_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','none'))" 2>/dev/null || echo "none")
    local https=$(echo "$pages_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('https_enforced',False))" 2>/dev/null || echo "False")
    local cname=$(echo "$pages_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cname',''))" 2>/dev/null || echo "")
    
    if [ "$https" = "True" ]; then
      already_https=$((already_https + 1))
      continue
    fi
    
    if [ "$status" = "none" ] || [ "$status" = "null" ]; then
      # Pages not enabled at all — need to create it
      local create_resp=$(curl -s -w "%{http_code}" -o /dev/null -X POST \
        -H "Authorization: token $TOKEN" \
        -H "Accept: application/vnd.github+json" \
        -d "{\"source\": {\"branch\": \"main\", \"path\": \"/\"}}" \
        "https://api.github.com/repos/$ORG/$repo/pages" 2>/dev/null)
      
      if [ "$create_resp" = "201" ] || [ "$create_resp" = "409" ]; then
        # Now set the custom domain
        curl -s -o /dev/null -X PUT \
          -H "Authorization: token $TOKEN" \
          -H "Accept: application/vnd.github+json" \
          -d "{\"cname\": \"$domain\", \"source\": {\"branch\": \"main\", \"path\": \"/\"}}" \
          "https://api.github.com/repos/$ORG/$repo/pages" 2>/dev/null
        echo "  CREATED+DOMAIN: $site → $repo ($domain)" | tee -a "$LOG"
        triggered=$((triggered + 1))
      else
        echo "  FAIL CREATE: $site → $repo (HTTP $create_resp)" | tee -a "$LOG"
        failed=$((failed + 1))
      fi
    else
      # Pages exists but no HTTPS — re-set domain to trigger cert
      curl -s -o /dev/null -X PUT \
        -H "Authorization: token $TOKEN" \
        -H "Accept: application/vnd.github+json" \
        -d "{\"cname\": \"$domain\", \"source\": {\"branch\": \"main\", \"path\": \"/\"}}" \
        "https://api.github.com/repos/$ORG/$repo/pages" 2>/dev/null
      echo "  TRIGGERED: $site → $repo ($domain)" | tee -a "$LOG"
      triggered=$((triggered + 1))
    fi
    
    sleep "$RATE_DELAY"
  done

  echo "" | tee -a "$LOG"
  echo "Phase 1 complete: $triggered triggered, $already_https already HTTPS, $failed failed" | tee -a "$LOG"
}

###############################################################################
# PHASE 2: Enable HTTPS enforcement on all repos
###############################################################################
run_phase2() {
  echo "── Phase 2: Enabling HTTPS enforcement ──" | tee -a "$LOG"
  local enabled=0
  local cert_pending=0
  local already=0
  local failed=0

  for site_dir in "$SITES_DIR"/*/; do
    [ -d "$site_dir/.git" ] || continue
    
    local site=$(basename "$site_dir")
    local repo=$(get_repo_name "$site_dir")
    
    [ -z "$repo" ] && continue
    
    local has_amazon=$(grep -rl "amazon.com" "$site_dir"/*.html 2>/dev/null | head -1)
    [ -z "$has_amazon" ] && continue

    # Check current status
    local pages_json=$(curl -s -H "Authorization: token $TOKEN" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$ORG/$repo/pages" 2>/dev/null)
    
    local https=$(echo "$pages_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('https_enforced',False))" 2>/dev/null || echo "False")
    
    if [ "$https" = "True" ]; then
      already=$((already + 1))
      continue
    fi
    
    # Try to enable HTTPS
    local resp=$(curl -s -w "\n%{http_code}" -X PUT \
      -H "Authorization: token $TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -d "{\"https_enforced\": true}" \
      "https://api.github.com/repos/$ORG/$repo/pages" 2>/dev/null)
    
    local http_code=$(echo "$resp" | tail -1)
    local body=$(echo "$resp" | sed '$d')
    
    if [ "$http_code" = "204" ]; then
      echo "  ✅ ENABLED: $site → $repo" | tee -a "$LOG"
      enabled=$((enabled + 1))
    elif echo "$body" | grep -q "certificate does not exist"; then
      echo "  ⏳ CERT PENDING: $site → $repo" | tee -a "$LOG"
      cert_pending=$((cert_pending + 1))
    else
      echo "  ❌ FAILED: $site → $repo (HTTP $http_code)" | tee -a "$LOG"
      failed=$((failed + 1))
    fi
    
    sleep "$RATE_DELAY"
  done

  echo "" | tee -a "$LOG"
  echo "Phase 2 complete: $enabled enabled, $already already OK, $cert_pending certs pending, $failed failed" | tee -a "$LOG"
  
  if [ "$cert_pending" -gt 0 ]; then
    echo "" | tee -a "$LOG"
    echo "⚠️  $cert_pending sites still waiting for SSL certs." | tee -a "$LOG"
    echo "  GitHub needs 15-60 min to provision certs." | tee -a "$LOG"
    echo "  Re-run: ./scripts/fix-github-pages-https.sh phase2" | tee -a "$LOG"
  fi
}

###############################################################################
# MAIN
###############################################################################
case "$PHASE" in
  phase1)
    run_phase1
    ;;
  phase2)
    run_phase2
    ;;
  both)
    run_phase1
    echo "" | tee -a "$LOG"
    echo "Waiting 30 seconds before Phase 2 (certs need time)..." | tee -a "$LOG"
    sleep 30
    run_phase2
    ;;
  *)
    echo "Usage: $0 [phase1|phase2|both]"
    exit 1
    ;;
esac

echo "" | tee -a "$LOG"
echo "Full log: $LOG" | tee -a "$LOG"
