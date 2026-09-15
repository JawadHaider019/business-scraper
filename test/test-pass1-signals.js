const http = require('http');
const { scrapeWebsite } = require('../src/scraper');

const homepageHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CrawlingExpert - Data Extraction Platform</title>
  <meta name="description" content="Extract unstructured web data reliably.">
</head>
<body>
  <header>
    <h1>CrawlingExpert Web Scraping Solutions</h1>
    <nav>
      <ul>
        <li><a href="/about-us">About Us</a></li>
        <li><a href="/how-it-works">How It Works</a></li>
        <li><a href="/pricing">Pricing Plans</a></li>
      </ul>
    </nav>
  </header>

  <main>
    <section class="hero">
      <p>Unlike custom built scraping projects, CrawlingExpert's scrapers are pre configured and available on a subscription basis.</p>
      <p>CrawlingExpert has embraced new technology adoption, offering cloud based crawling solutions instead of traditional offline web data scrapers.</p>
    </section>

    <div class="card what-we-do">
      <h2>What CrawlingExpert Does</h2>
      <p>Ready to Use, Not Custom Built. CrawlingExpert is pre built. Choose free trial, monthly, or annual plans.</p>
    </div>

    <section class="faq-fields">
      <h2>Fields and Numbering</h2>
      <p>01 Basic Identity</p>
      <p>02 Professional Background</p>
      <p>03 Product Details</p>
      <p>06 Website Specifications</p>
      <p>09 Customer Insights</p>
    </section>

    <section class="stats">
      <p>Trusted by 7460+ clients across 51+ countries with 15,000+ websites scraped daily and over 500 projects completed.</p>
    </section>
  </main>

  <footer>
    <p>© 2026 CrawlingExpert. Footer Link: <a href="/terms">Terms</a></p>
  </footer>
</body>
</html>
`;

const aboutHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CrawlingExpert</title>
</head>
<body>
  <header>
    <h1>CrawlingExpert</h1>
    <nav>
      <a href="/">Home</a>
      <a href="/about-us">About Us</a>
      <a href="/pricing">Pricing</a>
    </nav>
  </header>
  <main>
    <h2>About Our Web Scraping Company</h2>
    <p>CrawlingExpert assists in making strategic and competitive business decisions through web data collection and analytical insights.</p>
  </main>
</body>
</html>
`;

const pricingHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Amazon Scraper Pricing - CrawlingExpert</title>
</head>
<body>
  <header>
    <h1>Amazon Scraper Pricing</h1>
  </header>
  <main>
    <div class="card fragment">
      Choose a free trial, monthly rental, or annual rental.
    </div>

    <!-- Wrapper container matching card selectors -->
    <div class="pricing-grid pricing">
      <h2>Amazon Scraper Pricing</h2>
      <div class="pricing-card">
        <h3>Free Trial</h3>
        <div class="price">Free</div>
        <ul>
          <li>100 free requests</li>
          <li>Sample CSV export</li>
        </ul>
        <a href="/signup">Start Free Trial</a>
      </div>

      <div class="pricing-card">
        <h3>Monthly Rental</h3>
        <div class="price">$59/mo</div>
        <ul>
          <li>Unlimited scrapes</li>
          <li>API and Webhook support</li>
        </ul>
        <a href="/checkout">Subscribe Now</a>
      </div>

      <div class="pricing-card">
        <h3>Annual Rental</h3>
        <div class="price">$499/yr</div>
        <ul>
          <li>All monthly features</li>
          <li>Priority 24/7 support</li>
        </ul>
        <a href="/checkout">Subscribe Now</a>
      </div>
    </div>

    <!-- Step divs for workflow fallback test -->
    <div class="step-container">
      <div class="step">1 Access the Tool and choose your target data sources.</div>
      <div class="step">2 Define Search Parameters and custom filters.</div>
      <div class="step">3 Initiate Data Extraction via cloud scrapers.</div>
      <div class="step">4 Export Data into structured JSON or CSV feeds.</div>
    </div>

    <section class="prefix-test">
      <div>01 OEM &amp; Manufacturer Details Capture accurate OEM Name, OEM SKU Number, and Brand metadata.</div>
      <div>01 OEM &amp; Manufacturer Details</div>
      <div>02 Product Dimensions Capture weight, height, and unit measurements accurately.</div>
    </section>
  </main>
</body>
</html>
`;

const howItWorksHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>How It Works - CrawlingExpert</title>
</head>
<body>
  <header>
    <h1>Our Data Extraction Workflow</h1>
  </header>
  <main>
    <h2>How It Works</h2>
    <div>1 Access the Tool and choose your target data sources.</div>
    <div>2 Define Search Parameters and custom filters.</div>
    <div>3 Initiate Data Extraction via cloud scrapers.</div>
    <div>4 Export Data into structured JSON or CSV feeds.</div>
    <h2>Next Steps</h2>
    <p>Get in touch with our team to start your crawl.</p>
  </main>
</body>
</html>
`;

async function runPass1SignalsTest() {
  console.log('🧪 Starting Pass 1 Refined Signals & Crawl Deduplication Test...');

  let requestCount = {
    home: 0,
    about: 0,
    pricing: 0,
    howItWorks: 0
  };

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url === '/about-us' || req.url === '/about-us/') {
      requestCount.about++;
      res.end(aboutHtml);
    } else if (req.url === '/pricing' || req.url === '/pricing/') {
      requestCount.pricing++;
      res.end(pricingHtml);
    } else if (req.url === '/how-it-works' || req.url === '/how-it-works/') {
      requestCount.howItWorks++;
      res.end(howItWorksHtml);
    } else {
      requestCount.home++;
      res.end(homepageHtml);
    }
  });

  await new Promise(resolve => server.listen(4575, resolve));
  console.log('✅ Server running on http://localhost:4575');

  try {
    const result = await scrapeWebsite('http://localhost:4575', { useAi: false });
    const d = result.data;
    const raw = result.raw;

    console.log('\n================ SIGNALS & PAGES_BY_TYPE EXTRACTED ================');
    console.log('Crawled pages:', JSON.stringify(d.crawled_pages, null, 2));
    console.log('plan_cards:', JSON.stringify(d.signals.all_plan_cards, null, 2));
    console.log('page_headings:', JSON.stringify(d.signals.all_page_headings, null, 2));
    console.log('pricing strategy tiers:', JSON.stringify(d.business_strategy.pricing_strategy, null, 2));
    console.log('====================================================================\n');

    const checks = [
      [
        'Bug 1: about-us is crawled exactly once',
        d.crawled_pages.filter(p => p.url.includes('/about-us')).length === 1 && requestCount.about === 1
      ],
      [
        'Fix A: Scoped content extraction removes nav/footer junk from list_items on homepage',
        !raw.pages_by_type.homepage[0].list_items.some(li => /About Us|How It Works|Pricing Plans/i.test(li))
      ],
      [
        'Fix B: Structured plan_cards extracted ($59/mo, $499/yr, Free Trial)',
        Array.isArray(d.signals.all_plan_cards) &&
        d.signals.all_plan_cards.some(c => c.price && c.price.includes('$59')) &&
        d.signals.all_plan_cards.some(c => c.price && c.price.includes('$499'))
      ],
      [
        'Fix B (Wrapper & Fragment Rejection): exactly 3 real plans extracted, 0 on homepage, 0 wrappers',
        raw.pages_by_type.homepage[0].plan_cards.length === 0 &&
        d.signals.all_plan_cards.length === 3 &&
        !d.signals.all_plan_cards.some(c => /pricing|choose a free trial|what crawlingexpert does/i.test(c.name || ''))
      ],
      [
        'Output Separation: raw has pages_by_type (~2500 lines for Pass 2), summary is lean (~300 lines for Postman)',
        Boolean(raw.pages_by_type && !d.pages_by_type && d.business_strategy && d.signals && d.meta)
      ],
      [
        'Fix B: Pricing strategy integrates plan_cards into structured tiers',
        d.business_strategy.pricing_strategy &&
        d.business_strategy.pricing_strategy.value &&
        d.business_strategy.pricing_strategy.value.tiers &&
        d.business_strategy.pricing_strategy.value.tiers.some(t => t.price && t.price.includes('$59'))
      ],
      [
        'Fix C: Numbered item prefix deduplication collapses shorter prefixes',
        raw.signals.all_numbered_items.some(item => item.includes('Capture accurate OEM Name')) &&
        !raw.signals.all_numbered_items.includes('01 OEM & Manufacturer Details')
      ],
      [
        'Fix D: Fallback page_heading uses h2 when h1 matches brand name ("CrawlingExpert" -> "About Our Web Scraping Company")',
        d.signals.all_page_headings.some(p => p.url.includes('/about-us') && p.heading === 'About Our Web Scraping Company')
      ],
      [
        'Bug 3: numeric_claims preserves genuine business claims and filters FAQ numbering',
        d.signals.all_numeric_claims.some(c => c.includes('7460+')) &&
        d.signals.all_numeric_claims.some(c => c.includes('15,000+')) &&
        !d.signals.all_numeric_claims.some(c => /03|06|09/i.test(c))
      ],
      [
        'Bug 4: contrast_sentences captures expanded sentence',
        d.signals.all_contrast_sentences.some(s =>
          s.includes('Unlike custom built scraping projects') &&
          s.includes('pre configured and available on a subscription basis')
        )
      ],
      [
        'Pass 2 Integration: current_alternatives has direct source_type and valid evidence',
        d.business_strategy.current_alternatives.source_type === 'direct' &&
        d.business_strategy.current_alternatives.evidence.length > 0 &&
        Boolean(d.business_strategy.current_alternatives.validation.reasoning)
      ],
      [
        'Pass 2 Integration: how_it_works dimension receives fallback steps',
        Boolean(d.business_strategy.how_it_works.value && d.business_strategy.how_it_works.value.length >= 4)
      ],
      [
        'Win 1: how_it_works_by_page is dropped from signals',
        d.signals.how_it_works_by_page === undefined
      ],
      [
        'Win 3 & 4: Compact validation (reasoning only, no min_confidence_threshold) and collapsed null fields',
        d.business_strategy.market_size === null &&
        d.business_strategy.current_alternatives.validation.min_confidence_threshold === undefined &&
        d.business_strategy.current_alternatives.validation.has_evidence === undefined
      ]
    ];

    let passed = 0;
    for (const [title, ok] of checks) {
      if (ok) {
        console.log(`✅ [PASS] ${title}`);
        passed++;
      } else {
        console.error(`❌ [FAIL] ${title}`);
      }
    }

    console.log(`\nResults: ${passed} / ${checks.length} Pass 1 signal checks passed!`);
    if (passed === checks.length) {
      console.log('🎉 ALL FIXES (A, B, C, D) & PASS 1 ENHANCEMENTS PASSING 100%!\n');
    } else {
      process.exit(1);
    }
  } finally {
    server.close();
  }
}

runPass1SignalsTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
