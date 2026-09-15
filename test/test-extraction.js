const cheerio = require('cheerio');
const http = require('http');
const { scrapeWebsite } = require('../src/scraper');

// Sample test server serving rich dynamic HTML
const sampleHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ABC GmbH - Software &amp; Cloud Systems</title>
  <meta name="description" content="Example company offering enterprise software in Berlin.">
  <meta name="keywords" content="software, cloud, consulting">
  <meta property="og:site_name" content="ABC GmbH">
  <meta property="og:title" content="ABC GmbH - Innovation">
  <meta property="og:description" content="Example company offering enterprise software in Berlin.">
  <meta property="og:image" content="https://example.com/og-image.jpg">
  <meta property="og:url" content="https://example.com">
  <link rel="canonical" href="https://example.com">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "ABC GmbH",
    "legalName": "ABC GmbH",
    "description": "Example company specializing in modern cloud architecture.",
    "url": "https://example.com",
    "logo": "https://example.com/logo.png",
    "telephone": "+49 123 456789",
    "email": "info@example.com",
    "sameAs": [
      "https://www.linkedin.com/company/abc-gmbh",
      "https://twitter.com/abc_gmbh",
      "https://instagram.com/abc_gmbh",
      "https://facebook.com/abcgmbh"
    ],
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Hauptstraße 10",
      "postalCode": "10115",
      "addressLocality": "Berlin",
      "addressCountry": "Germany"
    },
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "opens": "09:00",
        "closes": "18:00"
      }
    ]
  }
  </script>
</head>
<body>
  <header>
    <a href="/" class="navbar-brand"><img src="/logo.png" alt="ABC GmbH Logo"></a>
  </header>
  <main>
    <h1>Welcome to ABC GmbH</h1>
    <p>Leading software engineering solutions.</p>
  </main>
  <footer>
    <div class="contact-info">
      <p>Email: <a href="mailto:info@example.com">info@example.com</a></p>
      <p>Phone: <a href="tel:+49123456789">+49 123 456789</a></p>
      <address>Hauptstraße 10, 10115 Berlin, Germany</address>
    </div>
  </footer>
</body>
</html>
`;

async function runTests() {
  console.log('🚀 Starting Local Test Server...');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(sampleHtml);
  });

  await new Promise(resolve => server.listen(4567, resolve));
  console.log('✅ Local test server running at http://localhost:4567');

  try {
    console.log('⏳ Running Playwright & Cheerio scrape on test server...');
    const result = await scrapeWebsite('http://localhost:4567');

    console.log('\n================ SCRAPE RESULT ================');
    console.log(JSON.stringify(result, null, 2));
    console.log('================================================\n');

    // Assertions
    const d = result.data;
    const checks = [
      ['Name is extracted', d.name === 'ABC GmbH'],
      ['Description is extracted', typeof d.description === 'string' && d.description.length > 0],
      ['Email is extracted', d.email === 'info@example.com'],
      ['Phone is extracted', d.phone === '+49 123 456789'],
      ['Street is extracted', d.street === 'Hauptstraße 10'],
      ['Postal code is extracted', d.postal_code === '10115'],
      ['City is extracted', d.city === 'Berlin'],
      ['Country is extracted', d.country === 'Germany'],
      ['Website is extracted', d.website.includes('example.com') || d.website.includes('localhost')],
      ['Logo is extracted', d.logo.includes('logo.png')],
      ['Social Links (LinkedIn)', d.social_links.linkedin === 'https://www.linkedin.com/company/abc-gmbh'],
      ['Social Links (Twitter)', d.social_links.twitter === 'https://twitter.com/abc_gmbh'],
      ['Opening hours present', d.opening_hours.length > 0]
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
      console.log('\n🎉 ALL EXTRACTION TESTS PASSED PERFECTLY!\n');
    } else {
      console.error('\n⚠️ Some extraction tests failed.\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runTests();
