const { scrapeWebsite } = require('../src/scraper');

async function testCrawlingExpert() {
  console.log('Testing scrape on https://crawlingexpert.com ...');
  try {
    const result = await scrapeWebsite('https://crawlingexpert.com', { timeout: 35000 });
    const s = result.data.business_strategy;

    console.log('\n================ CRAWLINGEXPERT EXTRACTED RESULT ================');
    console.log('target_audience:              ', JSON.stringify(s.target_audience, null, 2));
    console.log('customer_pain:                ', JSON.stringify(s.customer_pain, null, 2));
    console.log('differentiator:               ', JSON.stringify(s.differentiator, null, 2));
    console.log('vision:                       ', JSON.stringify(s.vision, null, 2));
    console.log('core_offering:                ', JSON.stringify(s.core_offering, null, 2));
    console.log('revenue_model:                ', JSON.stringify(s.revenue_model, null, 2));
    console.log('activation_strategy:          ', JSON.stringify(s.activation_strategy, null, 2));
    console.log('retention_strategy:           ', JSON.stringify(s.retention_strategy, null, 2));
    console.log('team_and_roles:               ', JSON.stringify(s.team_and_roles, null, 2));
    console.log('fulfillment_model:            ', JSON.stringify(s.fulfillment_model, null, 2));
    console.log('key_tools_and_infrastructure: ', JSON.stringify(s.key_tools_and_infrastructure, null, 2));
    console.log('acquisition_channels:         ', JSON.stringify(s.acquisition_channels, null, 2));
    console.log('conversion_funnel:            ', JSON.stringify(s.conversion_funnel, null, 2));
    console.log('how_it_works:                 ', JSON.stringify(s.how_it_works, null, 2));
    console.log('pricing_strategy:             ', JSON.stringify(s.pricing_strategy, null, 2));
    console.log('proof_of_value:               ', JSON.stringify(s.proof_of_value, null, 2));
    console.log('=================================================================\n');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testCrawlingExpert();
