require('dotenv').config();
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { scrapeWebsite, getBrowserInstance, closeBrowserInstance } = require('./scraper');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5000;

app.use(cors());
app.use(express.json());

// In-memory Job Store for Asynchronous Scraping
const jobs = new Map();
const MAX_JOBS = 5000;
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour TTL

function generateJobId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
}

// Periodic cleanup of stale jobs every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.createdAt > JOB_TTL_MS) {
            jobs.delete(id);
        }
    }
}, 10 * 60 * 1000).unref();

function runScrapeJob(jobId, url, options, includeRaw) {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = 'processing';

    scrapeWebsite(url, options)
        .then((result) => {
            job.status = 'done';
            job.data = includeRaw ? result.raw : result.data;
            job.completedAt = Date.now();
        })
        .catch((err) => {
            console.error(`[Scraper Job Error] Job: ${jobId} | URL: ${url} | Error:`, err.message);
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

    // Async Job Pattern (if explicitly requested via ?async=true or body { async: true })
    if (isAsync) {
        // Prune oldest if exceeding max capacity
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
        return res.json({
            success: true,
            data: includeRaw ? result.raw : result.data
        });
    } catch (err) {
        console.error(`[Scraper Error] URL: ${trimmedUrl} | Error:`, err.message);
        return res.status(500).json({
            success: false,
            error: err.message || 'An error occurred while scraping the website.'
        });
    }
});

// GET /api/scrape/:job_id - Polling endpoint for Bubble / background jobs
app.get(['/api/scrape/:job_id', '/api/jobs/:job_id'], (req, res) => {
    const { job_id } = req.params;
    const job = jobs.get(job_id);

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
    console.log(`Website Scraper API is running on http://localhost:${PORT}`);
    
    // Warm up Chromium instance in background
    getBrowserInstance()
        .then(() => console.log('🚀 Chromium browser instance warmed up and ready.'))
        .catch(err => console.warn('⚠️ Chromium background warmup warning:', err.message));
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use by another process.`);
    } else {
        console.error(`❌ Server error:`, err);
    }
});

// Graceful cleanup
process.on('SIGINT', async () => {
    console.log('Shutting down server and browser...');
    await closeBrowserInstance();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down server and browser...');
    await closeBrowserInstance();
    process.exit(0);
});

module.exports = { app, server, jobs, closeBrowserInstance, getBrowserInstance };

