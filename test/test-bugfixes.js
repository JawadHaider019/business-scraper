const http = require('http');
const { scrapeWebsite } = require('../src/scraper');
const { normalizeDimensionField, pruneLowConfidence, validateAndSanitizeStrategy } = require('../src/strategy');

// Multi-page mock simulating complete crawlingexpert.com scenario
const homepageHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CrawlingExpert - Web Scraping Platform</title>
  <meta name="description" content="Custom web scraping and crawling solutions for enterprises.">
  <meta name="keywords" content="bootstrap v5.3.2, premium, marketing, multipurpose">
  <meta property="og:site_name" content="CrawlingExpert">
</head>
<body>
  <header>
    <a href="/" class="navbar-brand">CrawlingExpert</a>
    <nav>
      <a href="/about-us">About Us</a>
      <a href="/solution/e-commerce-websites">E-Commerce Solution</a>
    </nav>
  </header>

  <main>
    <section class="hero">
      <h1>CrawlingExpert Web Scraping Solutions</h1>
      <p>CrawlingExpert is pre built for popular platforms Amazon, Google Maps, eBay, Yellow Pages, and business directories so you can get data without waiting for custom development timelines.</p>
      <p>Unlike custom built scraping projects, CrawlingExpert's scrapers are pre configured and available on a subscription basis.</p>
      <p>Streamline data retrieval processes and eliminate manual data entry tasks, allowing your team to focus on higher value activities.</p>
      <a href="/signup" class="cta">Sign up, select a scraper, and receive structured data the same day.</a>
    </section>

    <section class="pricing-overview">
      <h2>Built for Recurring Data Needs</h2>
      <p>Choose free trial, monthly, or annual plans to get regular data delivery.</p>
    </section>

    <section class="marketing-benefits">
      <p>Stay agile and responsive to market changes by accessing real time data from various online platforms, empowering you to adapt quickly to evolving trends and opportunities.</p>
    </section>

    <section class="metrics">
      <h2>With 18 years of experience, we have delivered business data to over 7460+ clients, configured 15,000+ websites, and served 51+ countries worldwide.</h2>
      <blockquote class="testimonial">
        <p>"The CrawlingExpert Technical Team is always there when you need them." - Support user</p>
      </blockquote>
    </section>
  </main>
</body>
</html>
`;

const aboutHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>About Us - CrawlingExpert</title>
</head>
<body>
  <main>
    <h2>About CrawlingExpert</h2>
    <p>CrawlingExpert assists in making strategic and competitive business decisions through web data collection and analytical insights.</p>
    <p>With 18 years of experience, our team is well versed in data collection, cleaning, and structuring.</p>
    <p>CrawlingExpert has embraced new technology adoption, offering cloud based crawling solutions instead of traditional offline web data scrapers.</p>
    <div class="support-info">
      <p>Our support team is accessible to our global customers through major communication channels such as email, click to call, and Skype.</p>
    </div>
  </main>
</body>
</html>
`;

const solutionHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>E-Commerce Solution - CrawlingExpert</title>
</head>
<body>
  <main>
    <h2>E-Commerce Data Extraction</h2>
    <p>Tell us the websites you want to scrape, Tell us your search criteria, Tell us the fields you want to extract, Tell us whether you need a custom e commerce website scraper or an ongoing data service, Receive the best solution matched to your business requirement.</p>
    <p>This can be scoped as a one time project or a regular service.</p>
  </main>
</body>
</html>
`;

async function runBugTests() {
  console.log('🧪 Starting Bug & Regression Verification Suite (Testing R1-R7 and Pass 2 Sanitizer)...');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url === '/about-us') {
      res.end(aboutHtml);
    } else if (req.url === '/solution/e-commerce-websites') {
      res.end(solutionHtml);
    } else {
      res.end(homepageHtml);
    }
  });

  await new Promise(resolve => server.listen(4570, resolve));
  console.log('✅ Mock Website Server running on http://localhost:4570');

  try {
    const result = await scrapeWebsite('http://localhost:4570', { useAi: false });
    const d = result.data;
    const s = d.business_strategy;

    console.log('\n================ SCRAPED DATA ================');
    console.log('Meta Keywords:', JSON.stringify(d.meta.keywords));
    console.log('Vision:', JSON.stringify(s.vision, null, 2));
    console.log('Proof of Value:', JSON.stringify(s.proof_of_value, null, 2));
    console.log('Customer Pain:', JSON.stringify(s.customer_pain, null, 2));
    console.log('Differentiator:', JSON.stringify(s.differentiator, null, 2));
    console.log('Revenue Model:', JSON.stringify(s.revenue_model, null, 2));
    console.log('Current Alternatives:', JSON.stringify(s.current_alternatives, null, 2));
    console.log('Timing & Trends:', JSON.stringify(s.timing_and_trends, null, 2));
    console.log('Activation Strategy:', JSON.stringify(s.activation_strategy, null, 2));
    console.log('Retention Strategy:', JSON.stringify(s.retention_strategy, null, 2));
    console.log('Team & Roles:', JSON.stringify(s.team_and_roles, null, 2));
    console.log('How It Works:', JSON.stringify(s.how_it_works, null, 2));
    console.log('Competitive Landscape:', JSON.stringify(s.competitive_landscape, null, 2));
    console.log('Strategic Moat:', JSON.stringify(s.strategic_moat, null, 2));
    console.log('==============================================\n');

    // 1. Test live scraped output from pipeline
    const checks = [
      [
        'Bug 4 Fix: meta.keywords rejects theme boilerplate ("bootstrap v5.3.2...") to null',
        d.meta.keywords === null
      ],
      [
        'R1 Fix: vision extracts verbatim strategic vision, avoiding generic/hallucinated boilerplate',
        s.vision &&
        !s.vision.value.toLowerCase().includes('leading provider') &&
        s.vision.value.toLowerCase().includes('strategic and competitive')
      ],
      [
        'R2 Fix: proof_of_value preserves all 3 scale metrics (7460+ clients, 15,000+ websites, 51+ countries)',
        s.proof_of_value &&
        (
          (typeof s.proof_of_value.value === 'string' && s.proof_of_value.value.includes('7460+') && s.proof_of_value.value.includes('15,000+') && s.proof_of_value.value.includes('51+')) ||
          (typeof s.proof_of_value.value === 'object' && s.proof_of_value.value.social_proof_statement.includes('7460+') && s.proof_of_value.value.badges_and_metrics.some(b => b.includes('51+')))
        )
      ],
      [
        'R3 Fix: how_it_works is NOT null; extracts step workflow from process text',
        s.how_it_works !== null &&
        typeof s.how_it_works.value === 'string' &&
        s.how_it_works.value.includes('Tell us the websites')
      ],
      [
        'R4 Fix: revenue_model retains direct subscription evidence ("Choose free trial, monthly, or annual plans...")',
        s.revenue_model &&
        s.revenue_model.source_type === 'direct' &&
        s.revenue_model.evidence.length > 0 &&
        s.revenue_model.evidence.some(e => e.text.toLowerCase().includes('monthly') || e.text.toLowerCase().includes('annual') || e.text.toLowerCase().includes('trial'))
      ],
      [
        'R5 Fix: customer_pain does NOT cite differentiator sentence ("Unlike custom built..."); cites real pain',
        s.customer_pain &&
        !s.customer_pain.evidence.some(e => e.text.toLowerCase().includes('unlike custom built')) &&
        (s.customer_pain.value.toLowerCase().includes('manual') || s.customer_pain.evidence.some(e => e.text.toLowerCase().includes('manual data entry')))
      ],
      [
        'R6 Fix: retention_strategy does NOT cite support communication channels (email, Skype); cites recurring service',
        s.retention_strategy &&
        !s.retention_strategy.evidence.some(e => e.text.toLowerCase().includes('skype') || e.text.toLowerCase().includes('communication channels')) &&
        (s.retention_strategy.value.toLowerCase().includes('recurring') || s.retention_strategy.value.toLowerCase().includes('regular') || s.retention_strategy.value.toLowerCase().includes('ongoing') || s.retention_strategy.evidence.some(e => e.text.toLowerCase().includes('regular service') || e.text.toLowerCase().includes('ongoing data service')))
      ],
      [
        'R7 Fix: timing_and_trends is cleanly null or inferred 0.50 with empty evidence',
        s.timing_and_trends === null ||
        (s.timing_and_trends.source_type === 'inferred' && s.timing_and_trends.confidence === 0.50 && s.timing_and_trends.evidence.length === 0)
      ],
      [
        'Regression A: differentiator.value cleanly extracts the contrast sentence without mid-word cutoff',
        s.differentiator &&
        typeof s.differentiator.value === 'string' &&
        s.differentiator.evidence &&
        s.differentiator.evidence.length > 0 &&
        s.differentiator.evidence[0].text.includes('Unlike custom built')
      ],
      [
        'Regression B: how_it_works.evidence items do NOT contain fabricated "1. " prefixes',
        s.how_it_works &&
        Array.isArray(s.how_it_works.evidence) &&
        s.how_it_works.evidence.length > 0 &&
        s.how_it_works.evidence.every(e => !/^\s*\d{1,2}[.)\s-]/.test(e.text))
      ],
      [
        'Regression C: strategic_moat safely defaults to inferred 0.50 scale or evidence absence',
        s.strategic_moat &&
        s.strategic_moat.source_type === 'inferred' &&
        s.strategic_moat.confidence === 0.50 &&
        s.strategic_moat.evidence.length === 0
      ],
      [
        'Rule R3: competitive_landscape & timing_and_trends do NOT collide with current_alternatives evidence',
        (!s.competitive_landscape?.evidence?.length || !s.current_alternatives?.evidence?.some(e => s.competitive_landscape.evidence.some(ce => ce.text === e.text))) &&
        (!s.timing_and_trends?.evidence?.length || !s.current_alternatives?.evidence?.some(e => s.timing_and_trends.evidence.some(te => te.text === e.text)))
      ],
      [
        'Regression 2: current_alternatives does NOT steal differentiator contrast sentence',
        s.current_alternatives &&
        !s.current_alternatives.value.toLowerCase().includes('unlike custom built') &&
        (s.current_alternatives.value.toLowerCase().includes('traditional offline') || s.current_alternatives.value.toLowerCase().includes('custom-built'))
      ],
      [
        'Regression 3c: team_and_roles restored with 18 years experience evidence from about page',
        s.team_and_roles &&
        (JSON.stringify(s.team_and_roles.value).includes('18 years') || s.team_and_roles.evidence?.some(e => e.text?.includes('18 years')))
      ],
      [
        'Bug 5 Fix: competitive_landscape preserves standard 5-competitor category list',
        s.competitive_landscape.source_type === 'inferred' &&
        Array.isArray(s.competitive_landscape.competitors) &&
        s.competitive_landscape.competitors.length === 5
      ]
    ];

    // 2. Test Pass 2 LLM Simulated Hallucinated Input through validateAndSanitizeStrategy
    console.log('\n--- Testing Simulated LLM Regressions through validateAndSanitizeStrategy ---');
    const simulatedLlmOutput = {
      vision: {
        value: "To be a leading provider of cloud-based web data extraction solutions.", // R1 hallucination
        evidence: [{ text: "The idea is to keep on creating the Best Web Crawling Software SaaS Solution.", source: "http://localhost:4570/about-us" }],
        source_type: "direct",
        confidence: 0.95
      },
      proof_of_value: {
        value: "Over 7460 clients and 15,000 websites served.", // R2 dropped 51+ countries
        evidence: [{ text: "With 18 years of experience, we have delivered business data to over 7460+ clients, configured 15,000+ websites, and served 51+ countries worldwide.", source: "http://localhost:4570/" }],
        source_type: "direct",
        confidence: 0.95
      },
      how_it_works: null, // R3 null
      customer_pain: {
        value: "Scrapers are pre configured so you can get data quickly.",
        evidence: [{ text: "Unlike custom built scraping projects, CrawlingExpert's scrapers are pre configured so you can get data without waiting for custom development timelines.", source: "http://localhost:4570/" }], // R5 collision with differentiator
        source_type: "direct",
        confidence: 0.95
      },
      differentiator: {
        value: "Pre-configured scrapers eliminate custom development timelines.",
        evidence: [{ text: "Unlike custom built scraping projects, CrawlingExpert's scrapers are pre configured so you can get data without waiting for custom development timelines.", source: "http://localhost:4570/" }],
        source_type: "direct",
        confidence: 0.95
      },
      revenue_model: {
        value: "Subscription-based pricing.",
        evidence: [], // R4 empty evidence
        source_type: "inferred",
        confidence: 0.50
      },
      retention_strategy: {
        value: "Regular updates and customer support.",
        evidence: [{ text: "Our support team is accessible to our global customers through major communication channels such as email, click to call, and Skype.", source: "http://localhost:4570/about-us" }], // R6 support channels
        source_type: "direct",
        confidence: 0.95
      },
      timing_and_trends: {
        value: "Growing demand for real-time data extraction solutions.",
        evidence: [{ text: "Stay agile and responsive to market changes by accessing real time data from various online platforms, empowering you to adapt quickly to evolving trends and opportunities.", source: "http://localhost:4570/" }], // R7 product feature
        source_type: "direct",
        confidence: 0.95
      }
    };

    const mockPages = [
      { url: 'http://localhost:4570/', text: 'CrawlingExpert Web Scraping Solutions Unlike custom built scraping projects, CrawlingExpert\'s scrapers are pre configured so you can get data without waiting for custom development timelines. Eliminate manual data entry tasks and tedious copy-paste workflows. Choose free trial, monthly, or annual plans to get regular data delivery. Stay agile and responsive to market changes by accessing real time data from various online platforms. With 18 years of experience, we have delivered business data to over 7460+ clients, configured 15,000+ websites, and served 51+ countries worldwide.' },
      { url: 'http://localhost:4570/about-us', text: 'CrawlingExpert assists in making strategic and competitive business decisions through web data collection and analytical insights. With 18 years of experience, our team is well versed in data collection, cleaning, and structuring. CrawlingExpert has embraced new technology adoption, offering cloud based crawling solutions instead of traditional offline web data scrapers. Our support team is accessible to our global customers through major communication channels such as email, click to call, and Skype.' },
      { url: 'http://localhost:4570/solution/e-commerce-websites', text: 'Tell us the websites you want to scrape, Tell us your search criteria, Tell us the fields you want to extract, Tell us whether you need a custom e commerce website scraper or an ongoing data service, Receive the best solution matched to your business requirement. This can be scoped as a one time project or a regular service.' }
    ];

    const signals = {
      all_how_it_works_steps: [
        'Tell us the websites you want to scrape',
        'Tell us your search criteria',
        'Tell us the fields you want to extract',
        'Tell us whether you need a custom e commerce website scraper or an ongoing data service',
        'Receive the best solution matched to your business requirement'
      ]
    };

    const sanitized = validateAndSanitizeStrategy(simulatedLlmOutput, mockPages, 'http://localhost:4570/', signals);

    checks.push(
      [
        'Simulated R1 Sanitizer: Replaces invented "To be a leading provider" with genuine strategic vision',
        sanitized.vision.value.toLowerCase().includes('strategic and competitive') &&
        !sanitized.vision.value.toLowerCase().includes('leading provider')
      ],
      [
        'Simulated R2 Sanitizer: Restores missing 51+ countries in proof_of_value',
        sanitized.proof_of_value.value.includes('51+') &&
        sanitized.proof_of_value.value.includes('15,000+') &&
        sanitized.proof_of_value.value.includes('7460+')
      ],
      [
        'Simulated R3 Sanitizer: Reconstructs null how_it_works from signal step sequence',
        sanitized.how_it_works !== null &&
        sanitized.how_it_works.steps.length === 5 &&
        sanitized.how_it_works.source_type === 'direct'
      ],
      [
        'Simulated R4 Sanitizer: Restores direct revenue_model evidence from monthly/annual plans',
        sanitized.revenue_model.source_type === 'direct' &&
        sanitized.revenue_model.evidence.length > 0 &&
        sanitized.revenue_model.evidence[0].text.includes('monthly, or annual plans')
      ],
      [
        'Simulated R5 Sanitizer: Replaces differentiator collision in customer_pain with "eliminate manual data entry"',
        sanitized.customer_pain.source_type === 'direct' &&
        sanitized.customer_pain.evidence[0].text.includes('Eliminate manual data entry')
      ],
      [
        'Simulated R6 Sanitizer: Replaces support channels in retention_strategy with "regular service" / ongoing service',
        sanitized.retention_strategy.source_type === 'direct' &&
        !sanitized.retention_strategy.evidence[0].text.includes('Skype') &&
        (sanitized.retention_strategy.evidence[0].text.includes('regular service') || sanitized.retention_strategy.evidence[0].text.includes('ongoing data service'))
      ],
      [
        'Simulated R7 Sanitizer: Converts product marketing benefit in timing_and_trends to inferred 0.50 with empty evidence',
        sanitized.timing_and_trends.source_type === 'inferred' &&
        sanitized.timing_and_trends.confidence === 0.50 &&
        sanitized.timing_and_trends.evidence.length === 0
      ],
      [
        'Regressions 1 Fix: activation_strategy is never null when onboarding CTA exists on page',
        s.activation_strategy !== null &&
        s.activation_strategy.value.includes('Sign up, select a scraper') &&
        s.activation_strategy.source_type === 'direct'
      ],
      [
        'Regressions 1 Fix: conversion_funnel and acquisition_channels correctly default to null (off-site signals)',
        s.conversion_funnel === null &&
        s.acquisition_channels === null
      ],
      [
        'Regressions 2 Fix: core_offering source URL matches the homepage platform overview quote and extracts platform scrapers',
        s.core_offering &&
        s.core_offering.evidence.length > 0 &&
        s.core_offering.evidence[0].source === 'http://localhost:4570/' &&
        (s.core_offering.evidence[0].text.includes('pre built') || s.core_offering.evidence[0].text.includes('popular platforms'))
      ],
      [
        'Regressions 3 Fix: customer_pain value is grammatically clean and does NOT overreach (no "outdated information", no "and hinder")',
        s.customer_pain &&
        !s.customer_pain.value.toLowerCase().includes('outdated') &&
        !/\band\s+hinder\b/i.test(s.customer_pain.value) &&
        s.customer_pain.value.toLowerCase().includes('manual data entry')
      ]
    );

    let passed = 0;
    for (const [desc, ok] of checks) {
      if (ok) {
        console.log(`✅ [PASS] ${desc}`);
        passed++;
      } else {
        console.error(`❌ [FAIL] ${desc}`);
      }
    }

    console.log(`\nResults: ${passed} / ${checks.length} bug and regression checks passed!`);
    if (passed === checks.length) {
      console.log('🎉 ALL BUGS AND REGRESSIONS HAVE BEEN VERIFIED AND RESOLVED!');
    } else {
      process.exit(1);
    }
  } finally {
    server.close();
  }
}

runBugTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
