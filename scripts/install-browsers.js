const { execSync } = require('child_process');

// Force playwright to install browsers inside node_modules directory so Render keeps it during runtime
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

try {
  console.log('🚀 Installing Playwright Chromium browser into node_modules (PLAYWRIGHT_BROWSERS_PATH=0)...');
  execSync('npx playwright install chromium', {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' }
  });
  console.log('✅ Playwright Chromium installed successfully!');
} catch (error) {
  console.error('❌ Failed to install Playwright browser:', error.message);
  process.exit(1);
}
