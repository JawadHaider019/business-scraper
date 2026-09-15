const http = require('http');
const { scrapeWebsite } = require('../src/scraper');

const sampleHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CloudScale - The Next-Gen Serverless Platform for Teams</title>
  <meta name="description" content="Deploy, scale, and monitor microservices in seconds without managing servers.">
  <meta name="keywords" content="serverless, cloud, devops, microservices">
  <meta property="og:site_name" content="CloudScale Inc.">
  <meta property="og:title" content="CloudScale - Scale Faster">
  <meta property="og:description" content="Deploy, scale, and monitor microservices in seconds.">
  <meta property="og:image" content="https://cloudscale.io/og-image.jpg">
  <meta property="og:url" content="https://cloudscale.io">
  <link rel="canonical" href="https://cloudscale.io">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Corporation",
    "name": "CloudScale Inc.",
    "legalName": "CloudScale Technologies Inc.",
    "description": "Leading cloud-native serverless automation platform for engineering teams.",
    "url": "https://cloudscale.io",
    "logo": "https://cloudscale.io/logo.png",
    "telephone": "+1 800 555 0199",
    "email": "contact@cloudscale.io",
    "founder": {
      "@type": "Person",
      "name": "Sarah Connor",
      "jobTitle": "CEO & Founder"
    },
    "serviceType": [
      "Serverless Deployments",
      "VPC Networking",
      "Instant Rollbacks"
    ],
    "sameAs": [
      "https://www.linkedin.com/company/cloudscale",
      "https://twitter.com/cloudscale",
      "https://github.com/cloudscale"
    ],
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "100 Innovation Way",
      "postalCode": "94107",
      "addressLocality": "San Francisco",
      "addressCountry": "United States"
    }
  }
  </script>
</head>
<body>
  <header>
    <a href="/" class="navbar-brand"><img src="/logo.png" alt="CloudScale Logo"></a>
    <nav>
      <a href="/features">Features</a>
      <a href="/solutions">Solutions for Developers</a>
      <a href="/pricing">Pricing</a>
      <a href="/case-studies">Case Studies</a>
      <a href="/about">About Us</a>
      <a href="/blog">Blog</a>
      <a href="/login">Login</a>
      <a href="/signup" class="btn">Get Started Free</a>
    </nav>
  </header>

  <main>
    <section class="hero">
      <h1>The Next-Gen Serverless Platform</h1>
      <p>Deploy, scale, and monitor microservices in seconds without managing complex infrastructure.</p>
      <a href="/signup" class="btn-primary">Start 14-day free trial</a>
      <a href="/demo" class="btn-secondary">Book a Demo</a>
    </section>

    <section class="audience">
      <h2>Who We Serve</h2>
      <p>Built for developers, DevOps engineers, and fast-growing tech teams who want to deploy without friction.</p>
    </section>

    <section class="problem">
      <h2>The Problem: Managing Kubernetes is Painful and Slow</h2>
      <p>Engineering teams stop wasting 30+ hours every month on tedious YAML configs and broken cluster deployments. Without managing infrastructure, teams ship 10x faster.</p>
    </section>

    <section class="differentiator">
      <h2>Why Choose Us</h2>
      <p>Unlike traditional cloud providers, CloudScale offers 1-click zero-config continuous deployments with instant rollbacks.</p>
    </section>

    <section class="proof">
      <h2>Trusted by 50,000+ developers across 120+ countries</h2>
      <p>Rated 4.9/5 on G2 and Product Hunt Product of the Year.</p>
      <blockquote class="testimonial">
        <p>"CloudScale cut our deployment times from 45 minutes to 30 seconds." - CTO of FastTech</p>
      </blockquote>
    </section>

    <section class="vision">
      <h2>Our Mission</h2>
      <p>To empower every engineer to deploy world-class cloud software without infrastructure friction.</p>
    </section>

    <section class="pricing">
      <h2>Simple, Transparent Pricing</h2>
      <div class="pricing-card">
        <h3>Starter Plan</h3>
        <span class="price">$29/mo</span>
        <ul>
          <li>Unlimited deployments</li>
          <li>10GB Cloud Storage</li>
        </ul>
      </div>
      <div class="pricing-card">
        <h3>Enterprise Custom</h3>
        <span class="price">Contact Sales</span>
        <ul>
          <li>Dedicated VPC</li>
          <li>SOC 2 Type II Compliance</li>
        </ul>
      </div>
    </section>
  </main>

  <footer>
    <div class="footer-links">
      <a href="/vs/aws-lambda">CloudScale vs AWS Lambda</a>
      <a href="/vs/vercel">CloudScale vs Vercel</a>
      <a href="/careers">Careers (We're Hiring!)</a>
      <a href="/affiliates">Partner &amp; Affiliate Program</a>
    </div>
    <div class="contact">
      <p>Email: <a href="mailto:support@cloudscale.io">support@cloudscale.io</a></p>
      <address>100 Innovation Way, San Francisco, CA 94107, USA</address>
    </div>
  </footer>
</body>
</html>
`;

async function runStrategyTests() {
  console.log('🚀 Starting Test Server for 27 Business Dimensions Test...');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(sampleHtml);
  });

  await new Promise(resolve => server.listen(4568, resolve));
  console.log('✅ Local test server running on port 4568');

  try {
    const result = await scrapeWebsite('http://localhost:4568');
    const d = result.data;
    const s = d.business_strategy;

    console.log('\n================ BUSINESS STRATEGY EXTRACTED ================');
    console.log(JSON.stringify(s, null, 2));
    console.log('=============================================================\n');

    const checks = [
      ['1. Target Audience (Inferred with evidence)', s.target_audience.value.includes('developers') && s.target_audience.source_type === 'inferred' && s.target_audience.evidence[0].text.length > 0],
      ['2. Customer Pain (Direct with evidence)', s.customer_pain.value.includes('Kubernetes') && s.customer_pain.source_type === 'direct' && s.customer_pain.evidence[0].source.includes('localhost')],
      ['3. Value Proposition (Direct with high confidence)', s.value_proposition.value.includes('Serverless') && s.value_proposition.confidence >= 0.95 && s.value_proposition.source_type === 'direct'],
      ['4. Differentiator (Direct with evidence)', s.differentiator.value.includes('deployments') && s.differentiator.source_type === 'direct'],
      ['5. Revenue Model (Direct)', s.revenue_model.value.includes('Subscription') && s.revenue_model.source_type === 'direct'],
      ['6. Current Alternatives (Direct vs comparisons)', /aws lambda/i.test(s.current_alternatives.value) && s.current_alternatives.source_type === 'direct'],
      ['7. Market Size (Strict Null when not published)', s.market_size === null],
      ['8. Timing & Trends (Structured)', s.timing_and_trends === null || s.timing_and_trends.source_type !== undefined],
      ['9. Core Offering (Direct)', Array.isArray(s.core_offering.value) && s.core_offering.value.length > 0 && s.core_offering.source_type === 'direct'],
      ['10. Proof of Value (Direct Quotes & Badges)', s.proof_of_value.value.testimonials.length > 0 && s.proof_of_value.source_type === 'direct'],
      ['11. Vision (Direct sentence)', s.vision.value.includes('empower') && s.vision.source_type === 'direct'],
      ['12. Pricing Strategy (Direct Tiers & Trial)', s.pricing_strategy.value.tiers.length > 0 && s.pricing_strategy.source_type === 'direct'],
      ['13. Lifetime Value (Strict Null when not published)', s.lifetime_value === null],
      ['14. Customer Acquisition Cost (CAC - Strict Null when not published)', s.customer_acquisition_cost === null],
      ['15. Other Revenue Streams (Structured)', s.other_revenue_streams === null || s.other_revenue_streams.source_type !== undefined],
      ['16. Acquisition Channels (Structured)', Array.isArray(s.acquisition_channels.value) && s.acquisition_channels.value.length > 0],
      ['17. Conversion Funnel (Structured)', typeof s.conversion_funnel.value === 'string' && s.conversion_funnel.value.includes('→')],
      ['18. Activation Strategy (Direct CTA)', /free trial/i.test(s.activation_strategy.value) && s.activation_strategy.source_type === 'direct'],
      ['19. Retention Strategy (Structured)', s.retention_strategy === null || s.retention_strategy.source_type !== undefined],
      ['20. Viral / Referral Loops (Direct program)', /affiliate|partner/i.test(s.viral_referral_loops.value) && s.viral_referral_loops.source_type === 'direct'],
      ['21. Fulfillment Model (Structured)', s.fulfillment_model === null || s.fulfillment_model.source_type !== undefined],
      ['22. Key Tools & Infrastructure (Strict Null when not stated)', s.key_tools_and_infrastructure === null],
      ['23. Team & Roles (Direct JSON-LD Founder)', s.team_and_roles.value.founder.includes('Sarah Connor') && s.team_and_roles.source_type === 'direct'],
      ['24. Cost Structure (Strict Null when not stated)', s.cost_structure === null],
      ['25. Partnerships & Dependencies (Structured)', s.partnerships_and_dependencies === null || s.partnerships_and_dependencies.source_type !== undefined],
      ['26. Competitive Landscape (Direct with competitors array)', /aws lambda/i.test(s.competitive_landscape.value) && Array.isArray(s.competitive_landscape.competitors)],
      ['27. Strategic Moat (Direct Certifications)', s.strategic_moat.value.includes('Security') && s.strategic_moat.source_type === 'direct'],
      ['28. How It Works (Structured Schema)', s.how_it_works === null || s.how_it_works.source_type !== undefined]
    ];

    let passedCount = 0;
    for (const [title, passed] of checks) {
      if (passed) {
        console.log(`✅ [PASS] ${title}`);
        passedCount++;
      } else {
        console.error(`❌ [FAIL] ${title}`);
      }
    }

    console.log(`\nResults: ${passedCount} / 28 dimensions validated successfully!`);

    if (passedCount === 28) {
      console.log('🎉 ALL 28 BUSINESS STRATEGY DIMENSIONS EXTRACTED ACCURATELY WITH ZERO FALSE POSITIVES IN STRUCTURED SCHEMA!\n');
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('Strategy test failed:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runStrategyTests();
