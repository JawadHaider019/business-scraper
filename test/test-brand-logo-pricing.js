const http = require('http');
const { scrapeWebsite } = require('../src/scraper');

const sampleHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CrawlingExpert - Top Web Scraping Tools &amp; Data Extraction Services</title>
  <meta name="description" content="Leading web scraping platform for automated data extraction.">
  <meta property="og:site_name" content="CrawlingExpert">
  <meta property="og:title" content="CrawlingExpert - Top Web Scraping Tools">
  <meta property="og:description" content="Leading web scraping platform.">
  <meta property="og:url" content="https://crawlingexpert.com">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "DataCrops Software Private Limited",
    "legalName": "DataCrops Software Private Limited",
    "description": "Parent software company provider.",
    "url": "https://crawlingexpert.com",
    "logo": "https://crawlingexpert.com/path-to-your-logo.png",
    "telephone": "+1 800 555 0199",
    "email": "support@crawlingexpert.com"
  }
  </script>
</head>
<body>
  <header>
    <a href="/" class="navbar-brand">
      <img src="/images/crawling-logo.png" alt="CrawlingExpert Logo">
    </a>
  </header>

  <main>
    <h1>Enterprise Web Scraping Solutions</h1>
    <p>Automate your data pipeline at scale.</p>

    <section class="pricing">
      <h2>Scraper Pricing</h2>
      
      <!-- Card 1: Has price and features, but NO plan name heading -->
      <div class="pricing-card">
        <span class="price">$29/month</span>
        <ul>
          <li>Basic Identity</li>
          <li>Contact Information</li>
          <li>Location Details</li>
          <li>CSV Export</li>
        </ul>
      </div>

      <!-- Card 2: Has distinct features, but NO plan name heading -->
      <div class="pricing-card">
        <span class="price">$29/month</span>
        <ul>
          <li>Business Name &amp; Category</li>
          <li>Address &amp; Phone Number</li>
          <li>Website URL</li>
          <li>CSV Export</li>
        </ul>
      </div>

      <!-- Card 3: Has explicit plan name heading -->
      <div class="pricing-card">
        <h3 class="plan-name">Pro Enterprise Plan</h3>
        <span class="price">$99/month</span>
        <ul>
          <li>All Scrapers Included</li>
          <li>Dedicated IP Proxies</li>
          <li>24/7 Priority Support</li>
        </ul>
      </div>
    </section>
  </main>
</body>
</html>
`;

async function runTests() {
  console.log('🚀 Starting Test Server for Brand, Logo, and Pricing Plan Fixes...');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(sampleHtml);
  });

  await new Promise(resolve => server.listen(4569, resolve));
  console.log('✅ Test server running at http://localhost:4569');

  try {
    const result = await scrapeWebsite('http://localhost:4569');
    const d = result.data;
    const pricingVal = d.business_strategy?.pricing_strategy?.value || d.business_strategy?.pricing_strategy || {};
    const tiers = pricingVal.tiers || [];
    const products = pricingVal.products || [];

    console.log('\n================ SCRAPE VERIFICATION RESULT ================');
    console.log('Name:    ', d.name);
    console.log('Logo:    ', d.logo);
    console.log('Pricing Products:', JSON.stringify(products, null, 2));
    console.log('Pricing Tiers:   ', JSON.stringify(tiers, null, 2));
    console.log('============================================================\n');

    const checks = [
      // 1. Brand name priority check
      [
        'Brand name is CrawlingExpert (prioritized over JSON-LD parent company DataCrops)',
        d.name === 'CrawlingExpert'
      ],
      // 2. Logo validation check
      [
        'Logo rejected placeholder "path-to-your-logo.png" and fell back to real <img>',
        d.logo === 'http://localhost:4569/images/crawling-logo.png'
      ],
      // 3. Pricing plan name check
      [
        'Pricing extraction does NOT invent "Standard Plan" for unlabelled Card 1 (name is null)',
        tiers.length >= 2 && tiers[0].name === null && tiers[0].price === '$29/month'
      ],
      [
        'Pricing extraction does NOT invent "Standard Plan" for unlabelled Card 2 (name is null)',
        tiers.length >= 2 && tiers[1].name === null && tiers[1].price === '$29/month'
      ],
      [
        'Explicit plan heading "Pro Enterprise Plan" is extracted accurately when present',
        tiers.some(t => t.name === 'Pro Enterprise Plan' && t.price === '$99/month')
      ],
      // 4. Products separation check
      [
        'Pricing strategy includes separated products array with plans',
        Array.isArray(products) && products.length > 0 && products[0].plans && products[0].plans.length > 0
      ]
    ];

    let allPassed = true;
    for (const [name, passed] of checks) {
      if (passed) {
        console.log(`✅ [PASS] ${name}`);
      } else {
        console.error(`❌ [FAIL] ${name}`);
        allPassed = false;
      }
    }

    if (allPassed) {
      console.log('\n🎉 ALL TARGET FIXES INCLUDING PRODUCT SEPARATION VERIFIED AND PASSED PERFECTLY!\n');
    } else {
      console.error('\n⚠️ Some verification tests failed.\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runTests();
