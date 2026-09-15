const http = require('http');
require('dotenv').config();

const PORT = process.env.PORT || 5000;

async function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function testServer() {
  console.log('🧪 Testing Express API Server Endpoints...\n');

  // 1. Test GET /
  console.log('Testing GET / ...');
  const rootRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/',
    method: 'GET'
  });
  console.log('Status:', rootRes.status, 'Response:', rootRes.data);
  if (rootRes.status !== 200) {
    throw new Error('Root check failed');
  }
  console.log('✅ Root check passed\n');

  // 2. Test POST /api/scrape with missing URL
  console.log('Testing POST /api/scrape with missing URL (validation check) ...');
  const invalidRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/scrape',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({}));
  console.log('Status:', invalidRes.status, 'Response:', invalidRes.data);
  if (invalidRes.status !== 400 || invalidRes.data.success !== false) {
    throw new Error('Validation check failed');
  }
  console.log('✅ Validation check passed\n');

  // 3. Test POST /api/scrape with real URL (example.com)
  console.log('Testing POST /api/scrape with url="https://example.com" ...');
  const scrapeRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/scrape',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ url: 'https://example.com' }));
  console.log('Status:', scrapeRes.status);
  console.log('Result Success:', scrapeRes.data.success);
  console.log('Result Data Name:', scrapeRes.data.data?.name);

  if (scrapeRes.status !== 200 || !scrapeRes.data.success || !scrapeRes.data.data.name) {
    throw new Error('Live scrape failed');
  }
  console.log('✅ Live scrape endpoint passed\n');

  console.log('🎉 ALL SERVER API TESTS PASSED SUCCESSFULLY!');
}

testServer().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
