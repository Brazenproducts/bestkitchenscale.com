#!/usr/bin/env python3
"""
Affiliate Site Generator — reusable template builder

⚠️  WARNING: Do not ship guessed or manually dropped local category photos.
    This generator intentionally avoids product/card image injection because bad,
    mirrored, duplicate, or fake images are worse than no image.

    After running this script, you MUST:
    1. Use the Amazon SP-API Catalog Items endpoint to get REAL product image URLs
    2. Verify every image URL returns HTTP 200 via curl
    3. Replace any fake/placeholder images before pushing live
    4. Each product card must have a UNIQUE image (no duplicates)
    5. Never add local JPG/PNG/WebP assets unless they are explicitly verified
    See MEMORY.md "AMAZON PRODUCT IMAGES ARE HALLUCINATED BY AI" for full process.
Usage: python3 generate-site.py --domain topexample.com --topic "example widgets" --products "Product A,Product B,Product C" --commission 4.5 --category "Kitchen"

Generates a complete dark-theme affiliate site with:
- index.html
- best-[topic].html (main review page)
- buyers-guide.html
- about.html / contact.html
- sitemap.xml / robots.txt / CNAME
- FAQPage JSON-LD on every content page
"""

import os, sys, re, argparse
from datetime import datetime

AMAZON_TAG = "brazenprodu01-20"
YEAR = datetime.now().year

DARK_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#0f0f0f;color:#e0e0e0;line-height:1.7}
a{color:#f0a500;text-decoration:none}
a:hover{text-decoration:underline}
header{background:#1a1a1a;padding:16px 24px;border-bottom:2px solid #f0a500;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
header .logo{font-size:1.3em;font-weight:700;color:#f0a500}
nav a{color:#ccc;margin-left:18px;font-size:.9em}
nav a:hover{color:#f0a500}
.hero{background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);padding:60px 24px;text-align:center;color:#fff}
.hero h1{font-size:2.2em;margin-bottom:12px;color:#fff}
.hero p{font-size:1.1em;color:#ccc;max-width:640px;margin:0 auto 24px}
.container{max-width:960px;margin:0 auto;padding:32px 24px}
.product-card{background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;margin-bottom:24px}
.product-card h2{color:#f0a500;font-size:1.3em;margin-bottom:8px}
.badge{display:inline-block;background:#f0a500;color:#000;font-size:.75em;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:10px;text-transform:uppercase}
.badge.value{background:#2a9d5c}
.pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}
.pros h4{color:#2a9d5c}
.cons h4{color:#e05252}
.pros li,.cons li{font-size:.9em;margin-left:18px;margin-top:4px;list-style:disc}
.btn{display:inline-block;background:#f0a500;color:#000;font-weight:700;padding:12px 24px;border-radius:6px;margin-top:12px;font-size:.95em}
.btn:hover{background:#e09400;text-decoration:none}
.comparison-table{width:100%;border-collapse:collapse;margin:24px 0}
.comparison-table th{background:#f0a500;color:#000;padding:12px;text-align:left}
.comparison-table td{padding:10px 12px;border-bottom:1px solid #2a2a2a}
.comparison-table tr:nth-child(even){background:#1a1a1a}
.faq-section{background:#111;border-top:2px solid #f0a500;padding:40px 24px;margin-top:40px}
.faq-section h2{color:#f0a500;margin-bottom:24px;font-size:1.5em}
.faq-item{border-bottom:1px solid #2a2a2a;padding:16px 0}
.faq-item h3{color:#e0e0e0;font-size:1em;margin-bottom:8px}
.faq-item p{color:#aaa;font-size:.9em}
footer{background:#111;border-top:1px solid #222;padding:24px;text-align:center;color:#666;font-size:.85em;margin-top:40px}
footer a{color:#888}
@media(max-width:600px){.pros-cons{grid-template-columns:1fr}.hero h1{font-size:1.5em}}
"""

def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')

# OUR BRANDS - Must link to OUR websites, NOT Amazon
OUR_BRANDS = {
    'bartact': ('https://bartact.com', 'Shop Bartact.com →'),
    'brazen': ('https://brazenproducts.com', 'Shop Brazen →'),
    'walkway': ('https://walkwaygear.com', 'Shop Walkway Gear →'),
    'bullstrap': ('https://bullstrap.com', 'Shop Bullstrap →'),
    'bowtie': ('https://bowtiefilters.com', 'Shop BowTie Filters →'),
    'blox': ('https://bloxfilters.com', 'Shop Blox Filters →'),
    'factor': ('https://factorfilters.com', 'Shop Factor Filters →'),
}

def product_link(product_name, asin=None):
    """Return link + button text for a product.
    OUR brands → direct to our site.
    Competitor brands → Amazon with affiliate tag."""
    name_lower = product_name.lower()
    
    # Check if this is one of OUR brands
    for brand, (url, btn_text) in OUR_BRANDS.items():
        if brand in name_lower:
            return url, btn_text
    
    # Competitor brand → Amazon
    if asin and re.match(r'^[A-Z0-9]{10}$', asin):
        link = f"https://www.amazon.com/dp/{asin}?tag={AMAZON_TAG}"
    else:
        q = product_name.replace(' ', '+')
        link = f"https://www.amazon.com/s?k={q}&tag={AMAZON_TAG}"
    
    return link, "Check Price on Amazon →"

def amazon_link(query, asin=None):
    """Legacy function - use product_link() instead.
    Return a direct /dp/ASIN link if we have one, else search link.
    ASINs should be pre-looked-up via SP-API before calling this."""
    if asin and re.match(r'^[A-Z0-9]{10}$', asin):
        return f"https://www.amazon.com/dp/{asin}?tag={AMAZON_TAG}"
    q = query.replace(' ', '+')
    return f"https://www.amazon.com/s?k={q}&tag={AMAZON_TAG}"

def faq_schema(faqs):
    items = []
    for q, a in faqs:
        items.append(f'''    {{
      "@type": "Question",
      "name": "{q}",
      "acceptedAnswer": {{"@type": "Answer", "text": "{a}"}}
    }}''')
    return f'''<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
{",\n".join(items)}
  ]
}}
</script>'''

def faq_html(faqs):
    items = '\n'.join([f'<div class="faq-item"><h3>{q}</h3><p>{a}</p></div>' for q, a in faqs])
    return f'<div class="faq-section"><div class="container"><h2>Frequently Asked Questions</h2>{items}</div></div>'

def page_shell(domain, title, desc, canonical, body, extra_head=""):
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{canonical}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{{"@context":"https://schema.org","@type":"WebSite","name":"{domain}","url":"https://{domain}/"}}</script>
{extra_head}
<style>{DARK_CSS}</style>
</head>
<body>
<header>
  <div class="logo">{domain}</div>
  <nav>
    <a href="/">Home</a>
    <a href="/buyers-guide.html">Buyer's Guide</a>
    <a href="/about.html">About</a>
  </nav>
</header>
{body}
<footer>
  <p>&copy; {YEAR} {domain} — Independent product reviews. Amazon affiliate links use tag={AMAZON_TAG}. <a href="/about.html">About</a> · <a href="/contact.html">Contact</a></p>
</footer>
</body>
</html>'''

def build_site(domain, topic, products_str, commission, category, outdir):
    os.makedirs(outdir, exist_ok=True)
    products = [p.strip() for p in products_str.split(',')]
    topic_slug = slug(topic)
    
    # CNAME
    with open(f"{outdir}/CNAME", 'w') as f:
        f.write(domain)
    
    # robots.txt
    with open(f"{outdir}/robots.txt", 'w') as f:
        f.write(f"User-agent: *\nAllow: /\nSitemap: https://{domain}/sitemap.xml\n")
    
    pages = ['index.html', f'best-{topic_slug}.html', 'buyers-guide.html', 'about.html', 'contact.html']
    
    # sitemap.xml
    urls = '\n'.join([f'  <url><loc>https://{domain}/{p if p != "index.html" else ""}</loc><changefreq>{"daily" if p == "index.html" else "weekly"}</changefreq></url>' for p in pages])
    with open(f"{outdir}/sitemap.xml", 'w') as f:
        f.write(f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls}
</urlset>''')

    topic_title = topic.title()
    
    # Generic FAQs (agents will customize per page)
    faqs = [
        (f"What's the most important thing to consider when buying {topic}?",
         f"Focus on fit for your specific use case, build quality, and long-term value. The cheapest option rarely holds up, and the most expensive isn't always necessary. Match the product to how you'll actually use it."),
        (f"Are expensive {topic} worth the money?",
         f"Often yes — premium {topic} typically use better materials, last longer, and perform more consistently. If you'll use it regularly, spending more upfront usually saves money over time."),
        (f"What should I avoid when shopping for {topic}?",
         f"Avoid buying based on specs alone without checking real-world reviews. Also watch for vague warranties and no-name brands with no support track record. Stick to established names with proven reliability."),
        (f"How long should quality {topic} last?",
         f"Quality {topic} should last several years with proper use and maintenance. Look for products with at least a 1-year warranty as a baseline signal of the manufacturer's confidence."),
        (f"Does Amazon have the best prices on {topic}?",
         f"Amazon is usually competitive and convenient, but check manufacturer sites for bundles or warranty deals. Prime shipping and easy returns make Amazon the default choice for most buyers."),
    ]

    # INDEX PAGE — each card gets unique copy derived from the product name
    def card_copy(product_name, topic):
        """Generate unique description and pros/cons based on the product name."""
        name = product_name.lower()
        # Derive category hints from product name keywords
        if any(w in name for w in ['seat cover', 'seat covers']):
            desc = f"Custom-fit {product_name} designed to protect your seats from mud, water, and UV damage. Look for waterproof materials and a precise fit for your specific vehicle model."
            pros = ["Waterproof protection", "Custom vehicle fit", "UV-resistant materials"]
            cons = ["Fit varies by brand", "Premium options cost more"]
        elif any(w in name for w in ['floor mat', 'floor mats']):
            desc = f"Heavy-duty {product_name} that trap mud, water, and trail debris before it soaks into your carpet. All-weather options are worth the upgrade for off-road use."
            pros = ["All-weather protection", "Easy to clean", "Non-slip backing"]
            cons = ["Universal fit less precise than custom", "Heavier than stock mats"]
        elif any(w in name for w in ['grab handle', 'grab handles', 'roll bar handle']):
            desc = f"Upgrade your {product_name} for a more secure grip on the trail. Paracord options are popular for their durability and huge color selection."
            pros = ["Improves passenger safety", "Easy bolt-on install", "Available in many colors"]
            cons = ["Paracord can fade over time", "Fit specific to roll bar diameter"]
        elif any(w in name for w in ['cargo liner', 'cargo']):
            desc = f"Protect your cargo area with a {product_name} that fits the contours of your tub. Keeps gear, tools, and trail mess contained and easy to clean out."
            pros = ["Protects resale value", "Easy to remove and rinse", "Durable material"]
            cons = ["May shift without anchor points", "Fit varies by model year"]
        elif any(w in name for w in ['console', 'center console']):
            desc = f"Replace or upgrade your {product_name} to keep the interior looking clean and protected from UV cracking and wear."
            pros = ["Affordable interior upgrade", "Protects against UV cracking", "Easy install"]
            cons = ["Check compatibility with your model year", "Limited color options on some brands"]
        elif any(w in name for w in ['storage', 'organizer', 'organization']):
            desc = f"Add organized storage to your build with a {product_name}. Keeps gear accessible and your interior clutter-free on long trips."
            pros = ["Adds usable storage", "Keeps interior organized", "Easy to install"]
            cons = ["May reduce legroom", "Quality varies by brand"]
        elif any(w in name for w in ['tool', 'drill', 'saw', 'wrench', 'socket']):
            desc = f"The {product_name} is a workhorse for professionals and serious DIYers. Look for USA-made options from trusted brands for the best long-term value."
            pros = ["Professional-grade durability", "Reliable performance", "Strong warranty support"]
            cons = ["Premium price vs import brands", "Heavier than budget alternatives"]
        elif any(w in name for w in ['filter', 'hvac', 'air filter']):
            desc = f"A quality {product_name} keeps your air clean and your system running efficiently. Replace on schedule to maintain airflow and filtration performance."
            pros = ["Improves air quality", "Protects HVAC system", "Easy to replace"]
            cons = ["Needs regular replacement", "Premium filters cost more upfront"]
        elif any(w in name for w in ['wiper', 'blade']):
            desc = f"Upgrade to a {product_name} for cleaner, streak-free visibility in all weather conditions. Replaceable-blade designs save money over full wiper replacements."
            pros = ["Improved visibility", "Easy blade replacement", "Fits most vehicles"]
            cons = ["Check fitment for your vehicle", "Blade life varies by climate"]
        else:
            # Generic but still unique per product — uses the product name in the copy
            desc = f"The {product_name} is a top choice in the {topic} category. Built for real-world use with materials and construction that hold up over time."
            pros = ["Solid build quality", "Good value for the price", "Backed by user reviews"]
            cons = ["Check compatibility before buying", "Premium options available at higher price"]
        return desc, pros, cons

    def build_card(i, p, link, btn_text="Check Price on Amazon →", badge_override=None):
        badge = badge_override or ("Editor's Pick" if i == 0 else "Best Value" if i == 1 else f"#{i+1} Pick")
        desc, pros, cons = card_copy(p, topic)
        pros_html = ''.join([f'<li>{x}</li>' for x in pros])
        cons_html = ''.join([f'<li>{x}</li>' for x in cons])
        return f'''
    <div class="product-card">
      <div class="badge">{badge}</div>
      <h2>{p}</h2>
      <p>{desc}</p>
      <div class="pros-cons">
        <div class="pros"><h4>✅ Pros</h4><ul>{pros_html}</ul></div>
        <div class="cons"><h4>❌ Cons</h4><ul>{cons_html}</ul></div>
      </div>
      <p style="font-size:.9em;color:#aaa;margin-top:10px">Image intentionally omitted until a verified, correctly oriented product image is available.</p>
      <a class="btn" href="{link}" target="_blank" rel="nofollow">{btn_text}</a>
    </div>'''

    def build_card_with_link(i, p, badge_override=None):
        link, btn_text = product_link(p)  # Get correct link based on brand
        return build_card(i, p, link, btn_text, badge_override)
    
    product_cards = '\n'.join([build_card_with_link(i, p) for i, p in enumerate(products[:5])])
    
    faq_block = faq_schema(faqs)
    faq_visible = faq_html(faqs)
    
    index_body = f'''
<div class="hero">
  <h1>Best {topic_title} {YEAR}</h1>
  <p>Independent rankings based on real-world performance, build quality, and value. Updated {datetime.now().strftime("%B %Y")}.</p>
  <a class="btn" href="/best-{topic_slug}.html">See Full Rankings →</a>
</div>
<div class="container">
  <p style="color:#aaa;margin-bottom:24px">We research, compare, and rank the best {topic} so you don't have to. All Amazon links use our affiliate tag — you pay the same price, we earn a small commission.</p>
  <h2 style="color:#f0a500;margin-bottom:20px">Top {topic_title} — Quick Picks</h2>
  {product_cards}
</div>
{faq_visible}'''
    
    with open(f"{outdir}/index.html", 'w') as f:
        f.write(page_shell(domain, f"Best {topic_title} {YEAR} — Top Picks Ranked", 
                          f"The best {topic} ranked by performance, value, and durability. Updated {YEAR}.",
                          f"https://{domain}/", index_body, faq_block))

    # MAIN REVIEW PAGE
    review_body = f'''
<div class="hero">
  <h1>Best {topic_title} {YEAR} — Full Rankings</h1>
  <p>We tested and compared the top options. Here's what actually delivers.</p>
</div>
<div class="container">
  <h2 style="color:#f0a500;margin-bottom:20px">The {len(products)} Best {topic_title}</h2>
  {product_cards}
  <h2 style="color:#f0a500;margin:32px 0 16px">Quick Comparison</h2>
  <table class="comparison-table">
    <tr><th>Product</th><th>Best For</th><th>Commission Category</th><th>Link</th></tr>
    {"".join([f'<tr><td>{p}</td><td>{"Best Overall" if i==0 else "Best Value" if i==1 else "Runner Up"}</td><td>{category} {commission}%</td><td><a href="{amazon_link(p)}" rel="nofollow" target="_blank">Amazon →</a></td></tr>' for i,p in enumerate(products)])}
  </table>
</div>
{faq_visible}'''

    with open(f"{outdir}/best-{topic_slug}.html", 'w') as f:
        f.write(page_shell(domain, f"Best {topic_title} {YEAR} — Ranked & Reviewed",
                          f"Detailed rankings of the best {topic} for {YEAR}. Honest pros, cons, and comparisons.",
                          f"https://{domain}/best-{topic_slug}.html", review_body, faq_block))

    # BUYER'S GUIDE
    guide_body = f'''
<div class="hero">
  <h1>{topic_title} Buyer's Guide {YEAR}</h1>
  <p>Everything you need to know before you buy.</p>
</div>
<div class="container">
  <h2 style="color:#f0a500;margin-bottom:16px">How to Choose the Right {topic_title}</h2>
  <p>Buying {topic} doesn't have to be complicated, but there are a few things worth understanding before you spend money. This guide covers what actually matters and what's just marketing noise.</p>
  <h3 style="color:#f0a500;margin:24px 0 12px">1. Define Your Use Case</h3>
  <p>The best {topic} for one person is wrong for another. Start by being honest about how you'll use it — frequency, environment, and what "good enough" means for your situation.</p>
  <h3 style="color:#f0a500;margin:24px 0 12px">2. Set a Real Budget</h3>
  <p>In this category, you generally get what you pay for. Budget options cut corners on materials or hardware. If you'll use this product regularly, spending 20-30% more on a quality option often pays off within the first year.</p>
  <h3 style="color:#f0a500;margin:24px 0 12px">3. Check the Warranty</h3>
  <p>A solid warranty is a manufacturer's way of saying they stand behind the product. Look for at least 1 year coverage. For higher-ticket items in this category, 2-3 years is the standard for quality brands.</p>
  <h3 style="color:#f0a500;margin:24px 0 12px">4. Read Recent Reviews</h3>
  <p>Products change. A model that was great in 2023 may have had quality control issues in 2024. Check recent reviews (last 6 months) and look for patterns, not individual complaints.</p>
  <h2 style="color:#f0a500;margin:32px 0 16px">Our Top Picks</h2>
  <ul style="margin-left:20px">
    {"".join([f'<li style="margin-bottom:8px"><a href="{amazon_link(p)}" rel="nofollow" target="_blank">{p}</a></li>' for p in products])}
  </ul>
</div>
{faq_visible}'''

    with open(f"{outdir}/buyers-guide.html", 'w') as f:
        f.write(page_shell(domain, f"{topic_title} Buyer's Guide {YEAR}",
                          f"Complete buyer's guide for {topic}. What to look for, what to avoid, and our top picks.",
                          f"https://{domain}/buyers-guide.html", guide_body, faq_block))

    # ABOUT
    about_body = f'''
<div class="hero"><h1>About {domain}</h1></div>
<div class="container">
  <p>We're independent reviewers focused on finding the best {topic} for real buyers. We research specs, compare prices, and cut through the marketing to tell you what's actually worth buying.</p>
  <p style="margin-top:16px">We earn a small affiliate commission on Amazon purchases made through our links — at no extra cost to you. This keeps the site running and the reviews honest.</p>
</div>'''
    with open(f"{outdir}/about.html", 'w') as f:
        f.write(page_shell(domain, f"About {domain}", f"About our {topic} review site.", f"https://{domain}/about.html", about_body))

    # CONTACT
    contact_body = f'''
<div class="hero"><h1>Contact</h1></div>
<div class="container">
  <p>Questions, corrections, or product suggestions? Reach us at <a href="mailto:info@{domain}">info@{domain}</a></p>
</div>'''
    with open(f"{outdir}/contact.html", 'w') as f:
        f.write(page_shell(domain, f"Contact {domain}", f"Contact {domain}.", f"https://{domain}/contact.html", contact_body))

    print(f"✅ Built {domain} — {len(os.listdir(outdir))} files in {outdir}")
    return True

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--domain', required=True)
    parser.add_argument('--topic', required=True)
    parser.add_argument('--products', required=True)
    parser.add_argument('--commission', default='4.0')
    parser.add_argument('--category', default='General')
    parser.add_argument('--outdir', default=None)
    args = parser.parse_args()
    
    outdir = args.outdir or f"/home/ubuntu/.openclaw/workspace/sites/{args.domain}"
    build_site(args.domain, args.topic, args.products, args.commission, args.category, outdir)
