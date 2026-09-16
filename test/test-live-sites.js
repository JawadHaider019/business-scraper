const { scrapeWebsite } = require('../src/scraper');

async function testLiveTarget(url) {
  console.log(`\n================ TESTING LIVE TARGET: ${url} ================`);
  try {
    const start = Date.now();
    const result = await scrapeWebsite(url, { timeout: 30000 });
    const duration = ((Date.now() - start) / 1000).toFixed(1);

    if (!result.success) {
      console.error(`❌ Scrape failed for ${url}`);
      return;
    }

    const d = result.data;
    const s = d.business_strategy;

    console.log(`⏱️ Scrape completed in ${duration}s`);
    console.log(`📄 Discovered & Crawled Pages (${d.crawled_pages.length}):`);
    d.crawled_pages.forEach(p => console.log(`   - [${p.type}] ${p.url}`));

    console.log('\n--- Company Metadata ---');
    console.log(`Name:        ${d.name}`);
    console.log(`Email:       ${d.email}`);
    console.log(`Phone:       ${d.phone}`);
    console.log(`Address:     ${d.address}`);

    console.log('\n--- Business Strategy Dimensions (Zero False Positives) ---');
    console.log(`Target Audience:     ${s.target_audience}`);
    console.log(`Value Proposition:   ${s.value_proposition}`);
    console.log(`Core Offering:       ${JSON.stringify(s.core_offering)}`);
    console.log(`Revenue Model:       ${s.revenue_model}`);
    console.log(`Current Alternatives:${s.current_alternatives}`);
    console.log(`Vision:              ${s.vision}`);
    console.log(`Proof of Value:      ${JSON.stringify(s?.proof_of_value?.badges_and_metrics || s?.proof_of_value?.value || s?.proof_of_value)}`);
    console.log(`Hard Fields (CAC):   ${s?.customer_acquisition_cost}`);
    console.log(`Hard Fields (LTV):   ${s?.lifetime_value}`);
    console.log(`Activation Strategy: ${s?.activation_strategy}`);
    console.log(`How It Works:        ${typeof s?.how_it_works === 'object' ? JSON.stringify(s?.how_it_works) : s?.how_it_works}`);

    // Verify critical assertions
    if (s?.core_offering && Array.isArray(s.core_offering) && s.core_offering.some(o => /case\s*studies|about/i.test(o))) {
      console.error('❌ FAIL: core_offering contains non-offering items!');
    } else {
      console.log('✅ PASS: core_offering is cleanly filtered.');
    }

    if (s?.current_alternatives && typeof s.current_alternatives === 'string' && /excel|google\s*sheets/i.test(s.current_alternatives)) {
      console.error('❌ FAIL: current_alternatives contains false positive spreadsheet match!');
    } else {
      console.log('✅ PASS: current_alternatives contains no spreadsheet false positives.');
    }

  } catch (err) {
    console.error(`Error scraping ${url}:`, err.message);
  }
}

async function main() {
  await testLiveTarget('https://jawumitech.com');
  await testLiveTarget('https://crawlingexpert.com');
}

main();
