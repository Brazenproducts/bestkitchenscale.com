# Affiliate Audit Summary — 2026-05-18 14:01 UTC

## Overall Status: ⚠️ Minor Issues (No Critical)

### Key Metrics
- **Total affiliate sites:** 370
- **Blog freshness:** 370/370 posted in last 24h ✅
- **Direct product links (/dp/):** 526
- **Search links (/s?k=):** 8,704 (94% search — ongoing low-conversion concern)

### Tag Health ✅
- **Invalid tags:** 0
- **Missing tags:** 0

### HTTPS Status ⚠️
- **HTTPS valid:** 342
- **HTTPS broken/missing:** 28
- Ran `fix-github-pages-https.sh both`:
  - 12 sites had cert provisioning triggered
  - 6 certs pending (GitHub needs 15-60 min)
  - 6 failed with HTTP 404 (likely repo naming mismatches):
    - bestdutchoven.com, bestpastamaker.com, bestreciprocatingsaw.com
    - bestsousvide.com, besttireinflator.com, utvaccessory.com
  - 357 already had HTTPS working
- **Remaining non-cert sites** (hyphenated `-com` domains without DNS): autopartsreviewed-com, autoshipfilter-com, besthomefilter-com, besthvacfilter-com, bestofficefilter-com, bestwindshieldwiper-com, furnaceprefilter-com, homehvacfilters-com, hvachomefilters-com, subscriptionfilter-com, tacomaseats-com, tacticalseatcovers-com, topoffroadstores-com

### Site Availability
- **1 site down in spot check:** besthvacfilter-com (HTTP 000 — DNS not resolving, `-com` domain)
- Other 19/20 sampled sites all responding ✅

### Missing Affiliate Links ⚠️
- 42 sites listed with zero Amazon links (mix of non-affiliate content sites, brace-expansion artifacts in find output, and sites pending link injection)

### Search-Only Links ⚠️
- 352 sites have ONLY search links (no /dp/ product links)
- Known ongoing issue — conversion improvement opportunity

### Script Fix
- Fixed `$ROOT` unbound variable in `daily-affiliate-audit.sh` line 187 (blog rotation check)
- Changed to absolute path `/home/ubuntu/.openclaw/workspace/memory/blog-rotation-batch.json`
- Committed locally (workspace remote doesn't match a scripts repo, so not pushed upstream)

### Action Items (Non-Critical)
1. Re-run `fix-github-pages-https.sh phase2` in ~30 min for the 6 pending certs
2. Investigate the 6 HTTPS enforcement failures (404s — may need repo name fixes)
3. The `-com` domain sites likely need actual domain registration/DNS setup
4. Gradual migration from search links to /dp/ product links for better conversion
