const https = require('https');

function measureRequest(url, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const start = Date.now();
    console.log(`\n==================================================`);
    console.log(`📡 [${new Date().toISOString()}] Sending ${method} to ${url}...`);
    if (body) {
      console.log(`📦 Payload: ${JSON.stringify(body)}`);
    }
    
    const parsed = new URL(url);
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + (parsed.search || ''),
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`⏱️ Status: ${res.statusCode} | Total Time: ${elapsed}s`);
        console.log(`📄 Response Preview:\n${data.slice(0, 500)}`);
        resolve({ status: res.statusCode, elapsed, data });
      });
    });

    req.on('error', (err) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.error(`❌ Request error after ${elapsed}s:`, err.message);
      resolve({ error: err.message, elapsed });
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Checking Render Deployed Service: https://scraper-rx2k.onrender.com');

  // Test 1: Root ping (check cold start / server availability)
  console.log('\n--- 1. Testing Root Ping (GET /) ---');
  await measureRequest('https://scraper-rx2k.onrender.com/');

  // Test 2: Scrape single small site (example.com)
  console.log('\n--- 2. Testing Simple Scrape (POST /api/scrape - example.com) ---');
  await measureRequest('https://scraper-rx2k.onrender.com/api/scrape', 'POST', {
    url: 'https://example.com'
  });

  // Test 3: Scrape multi-page real site (crawlingexpert.com)
  console.log('\n--- 3. Testing Real Multi-Page Scrape (POST /api/scrape - crawlingexpert.com) ---');
  await measureRequest('https://scraper-rx2k.onrender.com/api/scrape', 'POST', {
    url: 'https://crawlingexpert.com'
  });
}

runTests();
