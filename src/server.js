// src/server.js
require('dotenv').config();
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { scrapeWebsite, getBrowserInstance, closeBrowserInstance } = require('./scrape');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const log = {
  info: (...a) => LOG_LEVEL !== 'silent' && console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
};

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5000;

app.use(cors());
app.use(express.json());

// In-memory Job Store for Asynchronous Scraping
const jobs = new Map();
const MAX_JOBS = 5000;
const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateJobId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
}

// Periodic cleanup of stale jobs every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}, 60 * 1000).unref();

function trimForClient(rawData) {
  if (!rawData || typeof rawData !== 'object') return rawData;
  const {
    name,
    description,
    email,
    phone,
    address,
    website,
    logo,
    social_links,
    meta,
    business_strategy,
    crawled_pages
  } = rawData;

  return {
    name: name || null,
    description: description || null,
    email: email || null,
    phone: phone || null,
    address: address || null,
    website: website || null,
    logo: logo || null,
    social_links: social_links || null,
    meta: meta || null,
    business_strategy: business_strategy || null,
    crawled_pages: crawled_pages || []
  };
}

function runScrapeJob(jobId, url, options, includeRaw) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = 'processing';

  scrapeWebsite(url, options)
    .then((result) => {
      job.status = 'done';
      const outputData = includeRaw ? result.raw : trimForClient(result.data);
      job.data = outputData;
      job.completedAt = Date.now();
      log.info(`job completed: ${jobId}`);
    })
    .catch((err) => {
      log.error(`job failed: ${jobId} | error:`, err.message);
      job.status = 'failed';
      job.error = err.message || 'An error occurred while scraping the website.';
      job.completedAt = Date.now();
    });
}

// Root route to show the server is working
app.get('/', (req, res) => {
  res.send('Website Scraper is working! 🚀');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), active_jobs: jobs.size });
});

// POST /api/scrape - Direct Scrape (default) or Async Job (when async=true is specified)
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  const includeRaw = req.query.format === 'raw' || req.query.include_raw === 'true' || req.body.include_raw === true || req.body.format === 'raw';
  const isAsync = req.query.async === 'true' || req.body.async === true;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing required "url" parameter in request body.'
    });
  }

  const trimmedUrl = url.trim();
  log.info(`request received: POST /api/scrape ${trimmedUrl}`);

  // Async Job Pattern (if explicitly requested via ?async=true or body { async: true })
  if (isAsync) {
    if (jobs.size >= MAX_JOBS) {
      const oldestKey = jobs.keys().next().value;
      if (oldestKey) jobs.delete(oldestKey);
    }

    const jobId = generateJobId();
    const job = {
      id: jobId,
      url: trimmedUrl,
      status: 'pending',
      createdAt: Date.now(),
      completedAt: null,
      data: null,
      error: null
    };

    jobs.set(jobId, job);
    log.info(`job queued: ${jobId}`);

    // Run scraper in background
    runScrapeJob(jobId, trimmedUrl, { ...req.body, ...req.query }, includeRaw);

    return res.status(202).json({
      success: true,
      job_id: jobId,
      status: 'pending',
      message: 'Scrape job queued successfully.'
    });
  }

  // Default Direct Execution Mode: Scrapes and returns data directly in the response
  try {
    const result = await scrapeWebsite(trimmedUrl, { ...req.body, ...req.query });
    const outputData = includeRaw ? result.raw : trimForClient(result.data);
    log.info(`job completed: direct request ${trimmedUrl}`);
    return res.json({
      success: true,
      data: outputData
    });
  } catch (err) {
    log.error(`request error: ${trimmedUrl} | error:`, err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'An error occurred while scraping the website.'
    });
  }
});

// GET /api/scrape/:job_id - Polling endpoint
app.get(['/api/scrape/:job_id', '/api/jobs/:job_id'], (req, res) => {
  const { job_id } = req.params;
  const job = jobs.get(job_id);

  res.set('Cache-Control', 'public, max-age=300');

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found or expired.'
    });
  }

  if (job.status === 'done') {
    return res.json({
      success: true,
      job_id: job.id,
      status: 'done',
      data: job.data,
      created_at: job.createdAt,
      completed_at: job.completedAt
    });
  }

  if (job.status === 'failed') {
    return res.json({
      success: false,
      job_id: job.id,
      status: 'failed',
      error: job.error,
      created_at: job.createdAt,
      completed_at: job.completedAt
    });
  }

  return res.json({
    success: true,
    job_id: job.id,
    status: job.status,
    created_at: job.createdAt
  });
});

const server = app.listen(PORT, () => {
  log.info(`Website Scraper API running on http://localhost:${PORT}`);
  
  getBrowserInstance()
    .then(() => log.info('Chromium browser warmed up'))
    .catch(err => log.warn('Chromium background warmup warning:', err.message));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`Port ${PORT} is already in use.`);
  } else {
    log.error(`Server error:`, err);
  }
});

process.on('SIGINT', async () => {
  log.info('Shutting down server and browser...');
  await closeBrowserInstance();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log.info('Shutting down server and browser...');
  await closeBrowserInstance();
  process.exit(0);
});
