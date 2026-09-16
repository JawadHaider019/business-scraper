require('dotenv').config();
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}
const express = require('express');
const cors = require('cors');
const { scrapeWebsite, getBrowserInstance, closeBrowserInstance } = require('./scraper');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5000;

app.use(cors());
app.use(express.json());

// Root route to show the server is working
app.get('/', (req, res) => {
    res.send('Website Scraper is working! 🚀');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/api/scrape', async (req, res) => {
    const { url } = req.body;
    const includeRaw = req.query.format === 'raw' || req.query.include_raw === 'true' || req.body.include_raw === true || req.body.format === 'raw';

    if (!url || typeof url !== 'string' || !url.trim()) {
        return res.status(400).json({
            success: false,
            error: 'Missing required "url" parameter in request body.'
        });
    }

    try {
        const result = await scrapeWebsite(url, { ...req.body, ...req.query });
        return res.json({
            success: true,
            data: includeRaw ? result.raw : result.data
        });
    } catch (err) {
        console.error(`[Scraper Error] URL: ${url} | Error:`, err.message);
        return res.status(500).json({
            success: false,
            error: err.message || 'An error occurred while scraping the website.'
        });
    }
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
