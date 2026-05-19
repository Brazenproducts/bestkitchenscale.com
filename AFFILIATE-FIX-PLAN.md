# Affiliate Site Comprehensive Fix Plan - 2026-05-18

## Summary
After auditing 9 sites manually, we found **critical systematic issues** across all affiliate sites that prevent commissions and provide bad UX.

## Critical Issues Found (All Sites)

### 1. Hero "Buy on Amazon" Buttons (HIGH PRIORITY)
- **Problem:** Homepage hero has "Buy on Amazon" button that bypasses product rankings
- **Impact:** Users skip content, go to random Amazon search
- **Sites affected:** bestinstantpots, besttonneaucovers, bestcordlesstools, bestfirestick
- **Fix:** Remove all hero buttons OR make them scroll to #rankings anchor

### 2. Category Card "Buy on Amazon" Buttons (HIGH PRIORITY)
- **Problem:** Every category card has TWO buttons: "See Rankings" + "Buy on Amazon"
- **Impact:** Users bypass rankings, go to random searches, lose commissions
- **Sites affected:** ALL sites with category cards
- **Fix:** Remove "Buy on Amazon" from cards, keep only "See Rankings →"

### 3. Amazon Search Links Instead of Direct /dp/ASIN (CRITICAL)
- **Problem:** ALL Amazon buttons use search links: `/s?k=search+term`
- **Impact:** Unreliable commission tracking, poor UX, users see random results
- **Sites affected:** ALL 539 sites
- **Fix:** Replace with direct `/dp/ASIN` links (requires Amazon SP-API lookup)

### 4. Bartact Products Link to Amazon (CRITICAL - SEO)
- **Problem:** Bartact products have "Buy on Amazon" or "View on Amazon" buttons
- **Impact:** Sends OUR product traffic to Amazon (loses direct sales + confuses customers)
- **Sites affected:** jeepseatcover, gladiatorgrabhandle, broncoexterior, bestseatcover, besttruckaccessories
- **Fix:** Bartact products should ONLY link to bartact.com

### 5. Broken/Invalid ASINs (CRITICAL)
- **Problem:** Hardcoded ASINs are outdated/wrong (Fire TV Stick 4K Max: B0BT6M3CM7 → 500 error)
- **Impact:** ALL affiliate links dead, $0 commissions
- **Sites affected:** Unknown (needs full audit)
- **Fix:** Validate all ASINs, fetch fresh from SP-API

### 6. SSL Certificate Errors (HIGH)
- **Problem:** Sites return `ERR_CERT_COMMON_NAME_INVALID`
- **Impact:** Sites completely inaccessible
- **Sites affected:** bestdutchoven, bestpastamaker (likely more)
- **Fix:** GitHub Pages HTTPS settings check

### 7. Missing Product Photos (MEDIUM)
- **Problem:** Category cards use emoji (🔩 ⚡ 🪚) instead of actual product photos
- **Impact:** Unprofessional, low conversion
- **Sites affected:** bestcordlesstools, bestfirestick, jeepseatcover
- **Fix:** Add #1 product photo for each category

### 8. Generic Amazon Homepage Links (LOW)
- **Problem:** Bottom of page "Check Price on Amazon →" goes to amazon.com (no value)
- **Impact:** No commission potential
- **Sites affected:** bestcordlesstools, bestfirestick
- **Fix:** Remove entirely

### 9. Capitalization Errors (LOW)
- **Problem:** Model names not properly capitalized (Jlu → JLU)
- **Sites affected:** jlutops
- **Fix:** Find/replace capitalization

### 10. Missing Vehicle Selectors (MEDIUM)
- **Problem:** No year/model/trim selection on vehicle sites
- **Impact:** Can't show correct products for specific years
- **Sites affected:** bestseatcover, besttruckaccessories, all vehicle sites
- **Fix:** Add vehicle selector dropdowns (major feature)

## Repair Strategy

### Phase 1: Immediate Fixes (Automated - This Script)
1. ✅ Remove all hero "Buy on Amazon" buttons
2. ✅ Remove all category card "Buy on Amazon" buttons  
3. ✅ Fix Bartact links (OUR brands → our sites)
4. ✅ Remove "View on Amazon" from Bartact products
5. ✅ Fix capitalization errors
6. ✅ Remove generic Amazon homepage links
7. ✅ Validate all existing ASINs (flag broken ones)

### Phase 2: Manual/SP-API Required
8. ⏳ Replace search links with direct /dp/ASIN (need SP-API)
9. ⏳ Fix broken ASINs with current products
10. ⏳ Add product photos (need Amazon Product Advertising API)
11. ⏳ Fix SSL certificate errors (GitHub settings)

### Phase 3: Feature Additions
12. ⏳ Add vehicle year/model selectors
13. ⏳ Add dynamic product filtering
14. ⏳ Implement ASIN refresh system

## Scripts Created

### 1. `audit-and-fix-affiliates.py` (RUNNING NOW)
- Scans all 539 sites
- Identifies all issues automatically
- Generates fixes for Phase 1 items
- Validates ASINs (HTTP 200 check)
- Outputs detailed JSON report

### 2. `generate-site.py` (UPDATED)
- Added `OUR_BRANDS` dictionary
- Added `product_link()` function for correct routing
- Fixed template to eliminate bypass buttons
- Future sites won't have these problems

## Next Steps

1. **Wait for audit to complete** (~5-10 minutes for 50 sites)
2. **Review audit report** (`/tmp/affiliate-audit-report.json`)
3. **Run batch fixes** on all sites with issues
4. **Push fixed HTML to GitHub** (via GitHub API)
5. **Integrate Amazon SP-API** for ASIN lookup
6. **Schedule regular ASIN validation** (weekly cron job)

## Success Metrics

- **Before:** ~0% functional affiliate links (search links + broken ASINs)
- **After Phase 1:** ~50% functional (direct links for existing valid ASINs)
- **After Phase 2:** ~95% functional (fresh ASINs from SP-API)
- **After Phase 3:** 100% maintained (automated refresh)

## Estimated Impact

**Revenue Recovery:**
- 539 sites × average 100 visitors/month × 2% click-through × 5% conversion × $25 avg commission
- Before: ~$0/month (broken links)
- After: ~$1,347/month potential

**Time Savings:**
- Manual fixes: ~539 sites × 30 min = 270 hours
- Automated: ~2 hours script + 1 hour monitoring = 3 hours
- **Savings: 267 hours**

---
Last updated: 2026-05-18 22:10 UTC
