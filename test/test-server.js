const http = require('http');
require('dotenv').config();
const { server, closeBrowserInstance } = require('../src/server');

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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testServer() {
  await sleep(1000);
  console.log('🧪 Testing Express API Server Endpoints...\n');

  try {
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

    // 1b. Test GET /health
    console.log('Testing GET /health ...');
    const healthRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/health',
      method: 'GET'
    });
    console.log('Status:', healthRes.status, 'Response:', healthRes.data);
    if (healthRes.status !== 200 || healthRes.data.status !== 'ok') {
      throw new Error('Health check failed');
    }
    console.log('✅ Health check passed\n');

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

    // 3. Test Default Direct Scrape Mode: POST /api/scrape -> directly returns { success: true, data: { ... } }
    console.log('Testing Direct Scrape (Default): POST /api/scrape with url="https://example.com" ...');
    const directRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/scrape',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ url: 'https://example.com' }));

    console.log('Status:', directRes.status);
    console.log('Result Success:', directRes.data.success);
    console.log('Extracted Company/Domain Name:', directRes.data.data?.name);

    if (directRes.status !== 200 || !directRes.data.success || !directRes.data.data?.name) {
      throw new Error('Direct scrape failed');
    }
    console.log('✅ Direct scrape endpoint passed (Returned scrape data directly!)\n');

    // 4. Test Optional Async Job Flow: POST /api/scrape?async=true -> returns job_id in <1s -> poll GET /api/scrape/:job_id
    console.log('Testing Optional Async Job Pattern: POST /api/scrape?async=true with url="https://example.com" ...');
    const startTime = Date.now();
    const queueRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: '/api/scrape?async=true',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ url: 'https://example.com' }));
    const queueDuration = Date.now() - startTime;

    console.log(`Status: ${queueRes.status} (returned in ${queueDuration}ms)`);
    console.log('Queue Response:', queueRes.data);

    if (queueRes.status !== 202 || !queueRes.data.success || !queueRes.data.job_id) {
      throw new Error('Async job queuing failed');
    }
    console.log(`✅ Job successfully queued with ID: ${queueRes.data.job_id} in ${queueDuration}ms (<1s)\n`);

    const jobId = queueRes.data.job_id;

    // Poll GET /api/scrape/:job_id
    console.log(`Polling GET /api/scrape/${jobId} until status is "done" ...`);
    let pollAttempts = 0;
    let jobCompleted = false;
    let jobResult = null;

    while (pollAttempts < 30) {
      pollAttempts++;
      await sleep(2000);

      const pollRes = await makeRequest({
        hostname: 'localhost',
        port: PORT,
        path: `/api/scrape/${jobId}`,
        method: 'GET'
      });

      console.log(`Poll #${pollAttempts} - Status: ${pollRes.data.status}`);

      if (pollRes.data.status === 'done') {
        jobCompleted = true;
        jobResult = pollRes.data;
        break;
      } else if (pollRes.data.status === 'failed') {
        throw new Error(`Job failed: ${pollRes.data.error}`);
      }
    }

    if (!jobCompleted || !jobResult || !jobResult.data || !jobResult.data.name) {
      throw new Error('Polling job did not complete with valid extracted data');
    }

    console.log('Async Polled Data Name:', jobResult.data.name);
    console.log('✅ Async Job Polling Flow passed successfully!\n');

    console.log('🎉 ALL SERVER API TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (server && server.close) {
      server.close();
    }
    await closeBrowserInstance();
  }
}

testServer()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
