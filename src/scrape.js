// src/scrape.js — Playwright + Cheerio hybrid scraper
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}
const { chromium } = require('playwright');
const cheerio = require('cheerio');
const { URL } = require('url');
const { uniqFlat, extractPage } = require('./extractors');
const { deriveStrategy } = require('./deriveStrategy');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const log = {
  info: (...a) => LOG_LEVEL !== 'silent' && console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
};

const MAX_PAGES = parseInt(process.env.MAX_PAGES, 10) || 8;

let globalBrowser = null;
let globalBrowserPromise = null;

async function getBrowserInstance() {
  const isHeadless =
    process.env.PLAYWRIGHT_HEADLESS !== 'false' &&
    process.env.PUPPETEER_HEADLESS !== 'false' &&
    process.env.HEADLESS !== 'false';

  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }

  if (globalBrowserPromise) {
    return globalBrowserPromise;
  }

  globalBrowserPromise = (async () => {
    try {
      const browser = await chromium.launch({
        headless: isHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--no-zygote',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-domain-reliability',
          '--disable-extensions',
          '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
          '--disable-ipc-flooding-protection',
          '--disable-renderer-backgrounding',
          '--disable-sync',
          '--force-color-profile=srgb',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run'
        ]
      });

      browser.on('disconnected', () => {
        globalBrowser = null;
        globalBrowserPromise = null;
      });

      globalBrowser = browser;
      return browser;
    } catch (err) {
      globalBrowser = null;
      globalBrowserPromise = null;
      throw err;
    }
  })();

  return globalBrowserPromise;
}

async function closeBrowserInstance() {
  if (globalBrowser) {
    try {
      await globalBrowser.close();
    } catch {}
    globalBrowser = null;
    globalBrowserPromise = null;
  }
}

function normalizeUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    throw new Error('A valid URL string is required');
  }

  let trimmed = inputUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.protocol}//${parsed.host}${cleanPath}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

function resolveUrl(relativeOrAbsolute, baseUrl) {
  if (!relativeOrAbsolute || typeof relativeOrAbsolute !== 'string') return null;
  const trimmed = relativeOrAbsolute.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('#')) return null;

  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return trimmed;
  }
}

function cleanText(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function extractTextWithSpaces($, element) {
  if (!element || element.length === 0) return '';
  const clone = element.clone();
  clone.find('br, p, div, h1, h2, h3, h4, h5, h6, li, section, article, header, footer, blockquote, span, button, a').after(' ');
  return clone.text().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isValidAssetUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('#')) return false;

  const placeholderPattern = /path-to-your-logo|your-logo|placeholder|example\.com|default-logo|logo-placeholder|dummy|temp-logo|sample-logo|demo-logo|logo_placeholder|insert-logo|replace-with-your-logo|test-logo/i;
  if (placeholderPattern.test(trimmed)) return false;

  return true;
}

function extractJsonLd($) {
  const jsonLdData = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text().trim();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        jsonLdData.push(...parsed);
      } else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
        jsonLdData.push(...parsed['@graph']);
      } else {
        jsonLdData.push(parsed);
      }
    } catch {}
  });
  return jsonLdData;
}

function findOrganizationInJsonLd(jsonLdList) {
  const orgTypes = /^(Organization|Corporation|LocalBusiness|Store|Restaurant|MedicalBusiness|ProfessionalService|LegalService|FinancialService|GeneralContractor|Company|AutoRepair|TravelAgency|Dentist|Hotel|RealEstateAgent|HomeAndConstructionBusiness|WebSite)$/i;

  let match = jsonLdList.find(item => {
    const type = item['@type'];
    if (typeof type === 'string') return orgTypes.test(type) && !/^WebSite$/i.test(type);
    if (Array.isArray(type)) return type.some(t => orgTypes.test(t) && !/^WebSite$/i.test(t));
    return false;
  });

  if (!match) {
    match = jsonLdList.find(item => {
      const type = item['@type'];
      if (typeof type === 'string' && orgTypes.test(type)) return true;
      if (Array.isArray(type)) return type.some(t => orgTypes.test(t));
      return item.name && (item.address || item.telephone || item.contactPoint || item.logo || item.serviceType);
    });
  }

  return match || null;
}

const JUNK_KEYWORDS = /bootstrap|tailwind|premium|multipurpose|template|theme|v\d+\.\d+|html5|css3|admin/i;
const THEME_BOILERPLATE_REGEX = /bootstrap|v\d+\.\d+|multipurpose|html5|css3|themeforest|envato|template|admin\s*dashboard/i;

function extractMetaTags($, baseUrl) {
  const rawKeywords = cleanText($('meta[name="keywords" i]').attr('content')) || '';
  let cleanKeywords = null;
  if (rawKeywords) {
    if (!THEME_BOILERPLATE_REGEX.test(rawKeywords)) {
      const tokens = rawKeywords
        .split(',')
        .map(k => cleanText(k))
        .filter(k => k && !JUNK_KEYWORDS.test(k) && k.length > 2 && !/^(premium|multipurpose|marketing|responsive|clean)$/i.test(k));
      if (tokens.length > 0) {
        cleanKeywords = tokens.join(', ');
      }
    }
  }

  return {
    title: cleanText($('title').first().text()) || null,
    description: cleanText($('meta[name="description" i]').attr('content')) || null,
    keywords: cleanKeywords,
    og_title: cleanText($('meta[property="og:title" i]').attr('content')) || null,
    og_description: cleanText($('meta[property="og:description" i]').attr('content')) || null,
    og_image: resolveUrl($('meta[property="og:image" i]').attr('content'), baseUrl),
    og_site_name: cleanText($('meta[property="og:site_name" i]').attr('content')) || null,
    og_url: resolveUrl($('meta[property="og:url" i]').attr('content'), baseUrl),
    twitter_title: cleanText($('meta[name="twitter:title" i]').attr('content')) || null,
    twitter_description: cleanText($('meta[name="twitter:description" i]').attr('content')) || null,
    twitter_image: resolveUrl($('meta[name="twitter:image" i]').attr('content'), baseUrl),
    canonical: resolveUrl($('link[rel="canonical" i]').attr('href'), baseUrl),
    favicon: resolveUrl($('link[rel="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]').first().attr('href'), baseUrl)
  };
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}$/;
  if (!emailRegex.test(trimmed)) return false;
  const fileExts = /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|ico|mp4|webm|vue|jsx?)$/i;
  if (fileExts.test(trimmed)) return false;
  if (/^(sentry|webpack|bootstrap|cloudflare|git|wix|schema|googleapis|example|test|domain)/i.test(trimmed)) return false;
  return true;
}

function matchEmails(text) {
  if (!text || typeof text !== 'string') return [];
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|org|net|io|co|ai|tech|app|dev|biz|info|edu|gov|de|uk|us|pk|in|ca|au|fr|nl|es|it|me|agency|solutions|cloud|digital|studio|[a-z]{2,8})\b/gi;
  const matches = text.match(regex) || [];
  return [...new Set(matches.map(m => m.trim().toLowerCase()).filter(isValidEmail))];
}

function extractEmail(pages, jsonLdList) {
  for (const p of pages) {
    const mailtoLinks = [];
    p.$('a[href^="mailto:" i]').each((_, el) => {
      const href = p.$(el).attr('href');
      if (!href) return;
      const cleanMail = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (isValidEmail(cleanMail)) mailtoLinks.push(cleanMail);
    });
    if (mailtoLinks.length > 0) return mailtoLinks[0];
  }

  for (const item of jsonLdList) {
    if (item.email && typeof item.email === 'string' && isValidEmail(item.email)) return item.email;
    if (item.contactPoint && item.contactPoint.email && isValidEmail(item.contactPoint.email)) return item.contactPoint.email;
  }

  for (const p of pages) {
    const contactText = extractTextWithSpaces(p.$, p.$('footer, .footer, #footer, #contact, .contact, #impressum, .impressum, address'));
    const matches = matchEmails(contactText);
    if (matches.length > 0) return matches[0];
  }

  for (const p of pages) {
    const matches = matchEmails(p.text);
    if (matches.length > 0) return matches[0];
  }

  return null;
}

function extractPhone(pages, jsonLdList) {
  for (const item of jsonLdList) {
    if (item.telephone && typeof item.telephone === 'string') return cleanText(item.telephone);
    if (item.contactPoint && item.contactPoint.telephone) return cleanText(item.contactPoint.telephone);
    if (Array.isArray(item.contactPoints)) {
      const cp = item.contactPoints.find(p => p.telephone);
      if (cp && cp.telephone) return cleanText(cp.telephone);
    }
  }

  for (const p of pages) {
    const telLinks = [];
    p.$('a[href^="tel:" i]').each((_, el) => {
      const text = cleanText(p.$(el).text());
      const href = p.$(el).attr('href');
      const cleanTel = text && /\d{4,}/.test(text.replace(/\D/g, '')) ? text : (href ? href.replace(/^tel:/i, '').trim() : null);
      if (cleanTel) {
        const digitsOnly = cleanTel.replace(/\D/g, '');
        if (digitsOnly.length >= 8 && digitsOnly.length <= 18) {
          telLinks.push(cleanTel);
        }
      }
    });
    if (telLinks.length > 0) return telLinks[0];
  }

  for (const p of pages) {
    const contactText = extractTextWithSpaces(p.$, p.$('header, footer, .footer, #footer, #contact, .contact, address, .header-contact'));
    const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{1,4})?/g;
    const matches = contactText.match(phoneRegex) || [];
    for (const match of matches) {
      const cleanMatch = cleanText(match);
      const digitsOnly = cleanMatch ? cleanMatch.replace(/\D/g, '') : '';
      if (digitsOnly.length >= 9 && digitsOnly.length <= 15 && !/^\d{5}$/.test(digitsOnly)) {
        if (!/^(19|20)\d{2}/.test(cleanMatch)) {
          return cleanMatch;
        }
      }
    }
  }

  return null;
}

function extractAddress(pages, jsonLdList) {
  let street = null;
  let postal_code = null;
  let city = null;
  let country = null;
  let fullAddress = null;

  for (const item of jsonLdList) {
    if (item.address) {
      const addr = item.address;
      if (typeof addr === 'object') {
        street = cleanText(addr.streetAddress) || null;
        postal_code = cleanText(addr.postalCode) || null;
        city = cleanText(addr.addressLocality) || null;
        country = cleanText(addr.addressCountry ? (typeof addr.addressCountry === 'object' ? addr.addressCountry.name : addr.addressCountry) : null);
        const parts = [street, postal_code ? `${postal_code} ${city || ''}`.trim() : city, country].filter(Boolean);
        if (parts.length > 0) fullAddress = parts.join(', ');
        break;
      } else if (typeof addr === 'string') {
        fullAddress = cleanText(addr);
        break;
      }
    }
  }

  if (!street || !postal_code || !city) {
    for (const p of pages) {
      const addressBlock = extractTextWithSpaces(p.$, p.$('address, .address, .contact-address, #impressum, .impressum'));
      if (addressBlock && addressBlock.length > 5) {
        const deMatch = addressBlock.match(/(?:([A-Za-zäöüÄÖÜß\s.-]+(?:\s\d+[\w/-]*)))[,\s]+(\d{4,5})\s+([A-Za-zäöüÄÖÜß\s.-]+)(?:[,\s]+([A-Za-zäöüÄÖÜß\s.-]+))?/);
        if (deMatch) {
          if (!street && deMatch[1]) street = cleanText(deMatch[1]);
          if (!postal_code && deMatch[2]) postal_code = cleanText(deMatch[2]);
          if (!city && deMatch[3]) city = cleanText(deMatch[3]);
          if (!country && deMatch[4]) country = cleanText(deMatch[4]);
        }

        const usMatch = addressBlock.match(/(\d+\s+[\w\s.,#-]+),\s*([\w\s]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)(?:,\s*([\w\s]+))?/);
        if (usMatch) {
          if (!street && usMatch[1]) street = cleanText(usMatch[1]);
          if (!city && usMatch[2]) city = cleanText(usMatch[2]);
          if (!postal_code && usMatch[4]) postal_code = cleanText(usMatch[4]);
          if (!country && usMatch[5]) country = cleanText(usMatch[5]);
        }

        if (!fullAddress && (street || postal_code || city)) {
          fullAddress = addressBlock;
        }
      }
    }
  }

  if (!fullAddress && (street || postal_code || city || country)) {
    const parts = [street, postal_code && city ? `${postal_code} ${city}` : (postal_code || city), country].filter(Boolean);
    fullAddress = parts.join(', ');
  }

  return {
    street: street || null,
    postal_code: postal_code || null,
    city: city || null,
    country: country || null,
    address: fullAddress || null
  };
}

function extractLogoAndImages(pages, jsonLdList, meta, baseUrl) {
  let logo = null;
  const images = [];

  for (const item of jsonLdList) {
    if (item.logo) {
      const candidate = typeof item.logo === 'string' ? resolveUrl(item.logo, baseUrl) : resolveUrl(item.logo?.url, baseUrl);
      if (candidate && isValidAssetUrl(candidate)) {
        logo = candidate;
        break;
      }
    }
    if (!logo && item.image) {
      const candidate = typeof item.image === 'string' ? resolveUrl(item.image, baseUrl) : resolveUrl(item.image?.url, baseUrl);
      if (candidate && isValidAssetUrl(candidate)) {
        logo = candidate;
        break;
      }
    }
  }

  if (!logo) {
    const logoSelectors = [
      'header img[src*="logo" i]',
      'nav img[src*="logo" i]',
      'a.navbar-brand img',
      'a.logo img',
      'a[class*="brand" i] img',
      '.site-logo img',
      'header .custom-logo',
      'img.custom-logo',
      'header img[alt*="logo" i]',
      'nav img[alt*="logo" i]',
      'img[src*="logo" i]',
      'img[alt*="logo" i]'
    ];

    for (const p of pages) {
      if (logo) break;
      for (const sel of logoSelectors) {
        const el = p.$(sel).first();
        if (el && el.length > 0) {
          const src = el.attr('src') || el.attr('data-src');
          const candidate = resolveUrl(src, baseUrl);
          if (candidate && isValidAssetUrl(candidate)) {
            logo = candidate;
            break;
          }
        }
      }
    }
  }

  if (!logo && meta.og_image && isValidAssetUrl(meta.og_image)) logo = meta.og_image;
  if (!logo && meta.favicon && isValidAssetUrl(meta.favicon)) logo = meta.favicon;

  for (const p of pages) {
    p.$('img').each((_, el) => {
      const src = p.$(el).attr('src') || p.$(el).attr('data-src');
      const resolved = resolveUrl(src, baseUrl);
      if (resolved && isValidAssetUrl(resolved) && !images.includes(resolved) && !resolved.endsWith('.svg')) {
        images.push(resolved);
      }
    });
    if (images.length >= 10) break;
  }

  return {
    logo: logo || null,
    images: images.slice(0, 10)
  };
}

const SOCIALS = {
  facebook: /facebook\.com\/([^\/?"'#]+)/i,
  twitter: /(?:twitter|x)\.com\/([^\/?"'#]+)/i,
  linkedin: /linkedin\.com\/(?:company|in)\/([^\/?"'#]+)/i,
  instagram: /instagram\.com\/([^\/?"'#]+)/i,
  youtube: /youtube\.com\/(?:@|channel\/|c\/|user\/)?([^\/?"'#]+)/i,
  github: /github\.com\/([^\/?"'#]+)/i,
  tiktok: /tiktok\.com\/@?([^\/?"'#]+)/i
};

function extractSocialLinks(pages, jsonLdList = []) {
  const socialLinks = {
    facebook: null,
    twitter: null,
    linkedin: null,
    instagram: null,
    youtube: null,
    github: null,
    tiktok: null
  };

  const rawLinks = [];
  for (const item of jsonLdList) {
    if (item.sameAs) {
      const list = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
      rawLinks.push(...list);
    }
  }

  for (const p of pages) {
    if (!p.$) continue;
    p.$('a[href]').each((_, el) => {
      const href = p.$(el).attr('href');
      if (href) rawLinks.push(href.trim());
    });
  }

  for (const link of rawLinks) {
    if (!link || typeof link !== 'string' || link.startsWith('#') || link.startsWith('javascript:')) continue;
    if (/sharer|share|intent|plugins|widgets/i.test(link)) continue;

    for (const [platform, regex] of Object.entries(SOCIALS)) {
      const m = link.match(regex);
      if (m && !socialLinks[platform]) {
        socialLinks[platform] = link.startsWith('http')
          ? link
          : `https://${platform === 'twitter' ? 'x' : platform}.com/${m[1]}`;
      }
    }
  }

  return socialLinks;
}

const PRIORITY_PATHS = [
  'about', 'company', 'service', 'solution', 'product',
  'pricing', 'plan', 'customer', 'case-study', 'testimonial',
  'industry', 'team', 'mission', 'vision', 'how-it-works',
  'faq', 'partner', 'integration', 'contact', 'career'
];

function scoreAndCategorizeLink(pathname, linkText = '') {
  const p = pathname.toLowerCase();
  const text = (linkText || '').toLowerCase().trim();
  const combined = `${p} ${text}`;

  if (/(?:pricing|plans?|rates?|costs?|subscription|packages)/i.test(combined)) {
    return { score: 10, type: 'pricing' };
  }
  if (/(?:how[- ]it[- ]works|how[- ]we[- ]work|process|methodology|workflow|getting[- ]started)/i.test(combined)) {
    return { score: 10, type: 'process' };
  }
  if (/(?:case[- ]stud(y|ies)|customers?|testimonials?|reviews?|our[- ]work|portfolio|success[- ]stories|clients)/i.test(combined)) {
    return { score: 9, type: 'proof' };
  }
  if (/(?:products?|platform|features?|solutions?|services?|capabilities|what[- ]we[- ]do|apps|tools|resources|integrations?)/i.test(combined)) {
    return { score: 9, type: 'offerings' };
  }
  if (/(?:about|about[- ]us|company|who[- ]we[- ]are|our[- ]story|mission|vision|team|leadership)/i.test(combined)) {
    return { score: 8, type: 'about' };
  }
  if (/(?:faq|faqs|questions|help[- ]center|knowledge[- ]base)/i.test(combined)) {
    return { score: 8, type: 'faq' };
  }
  if (/(?:industr(y|ies)|use[- ]cases?|solutions[- ]for|who[- ]we[- ]serve|ecommerce|directories|retail)/i.test(combined)) {
    return { score: 8, type: 'industries' };
  }
  if (/(?:partners?|affiliates?|resellers?|ecosystem)/i.test(combined)) {
    return { score: 7, type: 'partners' };
  }
  if (/(?:contact|contact[- ]us|get[- ]in[- ]touch)/i.test(combined)) {
    return { score: 6, type: 'contact' };
  }
  if (/(?:careers?|jobs?|join[- ]us)/i.test(combined)) {
    return { score: 5, type: 'career' };
  }

  for (const kw of PRIORITY_PATHS) {
    if (p.includes(`/${kw}`) || p.includes(`-${kw}`) || p.includes(`${kw}-`) || text.includes(kw)) {
      return { score: 6, type: kw };
    }
  }

  return { score: 0, type: 'other' };
}

function discoverRelevantPages($, baseUrl) {
  let baseNorm;
  try {
    baseNorm = normalizeUrl(baseUrl);
  } catch {
    baseNorm = (baseUrl || '').toLowerCase().replace(/\/+$/, '');
  }

  let baseParsed;
  try {
    baseParsed = new URL(baseUrl);
  } catch {
    return [];
  }

  const discovered = new Map();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) return;

    try {
      const parsed = new URL(resolved);
      if (parsed.hostname === baseParsed.hostname && /^https?:/i.test(parsed.protocol)) {
        const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
        const cleanUrl = `${parsed.protocol}//${parsed.host}${cleanPath}`;
        const normUrl = normalizeUrl(cleanUrl);
        
        if (/\.(png|jpg|jpeg|gif|svg|pdf|zip|css|js|woff|woff2|xml|json|ico)$/i.test(cleanPath)) return;
        if (/\/(login|signin|signup|register|cart|checkout|admin|auth|logout|wp-admin)/i.test(cleanPath)) return;

        if (normUrl !== baseNorm && !discovered.has(normUrl)) {
          const linkText = cleanText($(el).text()) || cleanText($(el).attr('title')) || cleanText($(el).attr('aria-label')) || '';
          const { score, type } = scoreAndCategorizeLink(cleanPath, linkText);
          if (score > 0) {
            discovered.set(normUrl, { url: cleanUrl, score, type, path: cleanPath, title: linkText });
          }
        }
      }
    } catch {}
  });

  const categoryCounts = {};
  const sortedList = Array.from(discovered.values()).sort((a, b) => b.score - a.score);
  const finalSelected = [];

  for (const item of sortedList) {
    categoryCounts[item.type] = (categoryCounts[item.type] || 0) + 1;
    if (categoryCounts[item.type] <= 2) {
      finalSelected.push(item);
    }
    if (finalSelected.length >= (MAX_PAGES - 1)) break;
  }

  return finalSelected;
}

async function fetchSubpageHttp(url, type) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,de;q=0.8'
      },
      redirect: 'follow'
    });
    clearTimeout(timeoutId);

    if (!resp.ok) return null;

    const html = await resp.text();
    if (!html || html.length < 150) return null;

    const sub$ = cheerio.load(html);
    const subText = extractTextWithSpaces(sub$, sub$('body'));

    if (!subText || subText.length < 60) {
      return null;
    }

    const finalUrl = resp.url || url;
    const subExtracted = extractPage(sub$, finalUrl, type || 'other');

    return {
      type: type,
      page_type: type,
      url: finalUrl,
      $: sub$,
      text: subText || subExtracted.text,
      ...subExtracted
    };
  } catch {
    return null;
  }
}

function extractCompanyName($, jsonLdOrg, meta, targetUrl) {
  let hostnameBrand = null;
  try {
    const host = new URL(targetUrl).hostname.replace(/^www\./i, '');
    const part = host.split('.')[0];
    hostnameBrand = part.charAt(0).toUpperCase() + part.slice(1);
  } catch {}

  const logoAlt = $('header img[alt*="logo" i], nav img[alt*="logo" i], .navbar-brand img[alt], a.logo img[alt], a[class*="brand" i] img[alt], .site-logo img[alt]').first().attr('alt');
  if (logoAlt) {
    const cleaned = cleanText(logoAlt)
      .replace(/logo/gi, '')
      .replace(/icon/gi, '')
      .replace(/brand/gi, '')
      .replace(/^[-–—|•·:\s]+|[-–—|•·:\s]+$/g, '')
      .trim();
    if (cleaned.length >= 2 && cleaned.length <= 50 && !/^(home|site|navigation|menu|official)$/i.test(cleaned)) {
      return cleaned;
    }
  }

  const brandTextEl = $('header .navbar-brand, nav .navbar-brand, header a.logo, header .site-title, header .brand').first().text();
  if (brandTextEl) {
    const cleaned = cleanText(brandTextEl);
    if (cleaned && cleaned.length >= 2 && cleaned.length <= 50 && !/^(home|menu|navigation)$/i.test(cleaned)) {
      return cleaned;
    }
  }

  const pageTitle = meta.title || meta.og_title;
  if (pageTitle) {
    const titleParts = pageTitle.split(/[-–—|•·:»]/).map(cleanText).filter(Boolean);
    if (titleParts.length > 1) {
      if (hostnameBrand) {
        const matchingPart = titleParts.find(p => p.toLowerCase().replace(/[^a-z0-9]/g, '') === hostnameBrand.toLowerCase().replace(/[^a-z0-9]/g, ''));
        if (matchingPart) return matchingPart;

        const partialMatch = titleParts.find(p => p.toLowerCase().includes(hostnameBrand.toLowerCase()));
        if (partialMatch && partialMatch.length <= 35) return partialMatch;
      }

      const firstPart = titleParts[0];
      if (firstPart && firstPart.length >= 2 && firstPart.length <= 40 && !/^(home|welcome|the\s+best|get\s+started|login|features)/i.test(firstPart)) {
        return firstPart;
      }

      const lastPart = titleParts[titleParts.length - 1];
      if (lastPart && lastPart.length >= 2 && lastPart.length <= 40 && !/^(home|welcome|official\s+site)/i.test(lastPart)) {
        if (hostnameBrand && lastPart.toLowerCase().includes(hostnameBrand.toLowerCase())) {
          return lastPart;
        }
      }
    }
  }

  if (meta.og_site_name) {
    const cleanOgSite = cleanText(meta.og_site_name);
    if (cleanOgSite && cleanOgSite.length >= 2 && cleanOgSite.length <= 60 && !/^https?:/i.test(cleanOgSite)) {
      return cleanOgSite;
    }
  }

  if (jsonLdOrg) {
    if (jsonLdOrg.name && typeof jsonLdOrg.name === 'string') {
      const cleanJsonName = cleanText(jsonLdOrg.name);
      if (cleanJsonName && cleanJsonName.length >= 2 && cleanJsonName.length <= 60) return cleanJsonName;
    }
    if (jsonLdOrg.legalName && typeof jsonLdOrg.legalName === 'string') {
      const cleanLegal = cleanText(jsonLdOrg.legalName);
      if (cleanLegal && cleanLegal.length >= 2 && cleanLegal.length <= 60) return cleanLegal;
    }
  }

  const itempropName = $('[itemscope] [itemprop="name"]').first().text();
  if (cleanText(itempropName)) return cleanText(itempropName);

  if (pageTitle && pageTitle.length <= 45) {
    return cleanText(pageTitle);
  }

  return hostnameBrand || null;
}

function extractDescription($, jsonLdOrg, meta) {
  if (jsonLdOrg && jsonLdOrg.description && typeof jsonLdOrg.description === 'string') {
    return cleanText(jsonLdOrg.description);
  }

  if (meta.description) return meta.description;
  if (meta.og_description) return meta.og_description;
  if (meta.twitter_description) return meta.twitter_description;

  const itempropDesc = $('[itemprop="description"]').first().text();
  if (cleanText(itempropDesc)) return cleanText(itempropDesc);

  const heroPara = $('section[class*="about" i] p, section[class*="hero" i] p, .about p, main p').first().text();
  if (cleanText(heroPara) && heroPara.length > 30) {
    return cleanText(heroPara);
  }

  return null;
}

function extractOpeningHours($, jsonLdOrg) {
  const openingHours = [];

  if (jsonLdOrg) {
    if (jsonLdOrg.openingHours) {
      const hours = Array.isArray(jsonLdOrg.openingHours) ? jsonLdOrg.openingHours : [jsonLdOrg.openingHours];
      openingHours.push(...hours.map(cleanText).filter(Boolean));
    }

    if (jsonLdOrg.openingHoursSpecification) {
      const specs = Array.isArray(jsonLdOrg.openingHoursSpecification) ? jsonLdOrg.openingHoursSpecification : [jsonLdOrg.openingHoursSpecification];
      for (const spec of specs) {
        if (typeof spec === 'object') {
          const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek.join(', ') : (spec.dayOfWeek || '');
          const opens = spec.opens || '';
          const closes = spec.closes || '';
          if (days || opens || closes) {
            openingHours.push(cleanText(`${days}: ${opens} - ${closes}`));
          }
        }
      }
    }
  }

  $('[itemprop="openingHours"]').each((_, el) => {
    const text = cleanText($(el).text()) || $(el).attr('content');
    if (text && !openingHours.includes(text)) {
      openingHours.push(text);
    }
  });

  if (openingHours.length === 0) {
    const hoursEl = $('[class*="opening-hours" i], [class*="business-hours" i], [class*="oeffnungszeiten" i], #opening-hours, #hours').first();
    if (hoursEl.length > 0) {
      const text = extractTextWithSpaces($, hoursEl);
      if (text) openingHours.push(text);
    }
  }

  return openingHours;
}

function setupRequestBlockers(page) {
  return page.route('**/*', route => {
    const url = route.request().url();
    const resourceType = route.request().resourceType();

    if (/\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot)(\?.*)?$/i.test(url) || ['media', 'font', 'image'].includes(resourceType)) {
      return route.abort().catch(() => {});
    }
    if (
      url.includes('google-analytics') ||
      url.includes('googletagmanager') ||
      url.includes('facebook') ||
      url.includes('hotjar') ||
      url.includes('segment')
    ) {
      return route.abort().catch(() => {});
    }

    return route.continue().catch(() => {});
  });
}

// =========================================================================
// 🚀 MASTER SCRAPER ORCHESTRATOR
// =========================================================================

async function scrapeWebsite(rawUrl, options = {}) {
  const targetUrl = normalizeUrl(rawUrl);
  const timeout = options.timeout || parseInt(process.env.SCRAPE_TIMEOUT, 10) || 30000;
  const isHeadless =
    process.env.PLAYWRIGHT_HEADLESS !== 'false' &&
    process.env.PUPPETEER_HEADLESS !== 'false' &&
    process.env.HEADLESS !== 'false';

  log.info(`crawl started for ${targetUrl}`);

  let browser = null;
  let context = null;
  let page = null;
  const isIsolated = options.isolateBrowser === true;

  try {
    if (isIsolated) {
      browser = await chromium.launch({
        headless: isHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--no-zygote'
        ]
      });
    } else {
      browser = await getBrowserInstance();
    }

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9,de;q=0.8'
      },
      ignoreHTTPSErrors: true
    });

    page = await context.newPage();
    await setupRequestBlockers(page);

    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout
      });
    } catch (navError) {
      if (navError.name === 'TimeoutError' || /timeout/i.test(navError.message)) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch {}
      } else {
        throw navError;
      }
    }

    // Settle step for SPA hydration & dynamic client navigation
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500).catch(() => {});

    let renderedHtml;
    for (let i = 0; i < 3; i++) {
      try {
        renderedHtml = await page.content();
        break;
      } catch (err) {
        if (i === 2) throw err;
        await page.waitForTimeout(500).catch(() => {});
      }
    }
    const finalUrl = page.url() || targetUrl;
    const finalNorm = normalizeUrl(finalUrl);

    const $ = cheerio.load(renderedHtml);
    const homepageText = extractTextWithSpaces($, $('body'));
    const homeExtracted = extractPage($, finalUrl, 'homepage');
    const homePageObj = {
      type: 'homepage',
      page_type: 'homepage',
      url: finalUrl,
      $: $,
      text: homepageText || homeExtracted.text,
      ...homeExtracted
    };

    // 1. High-Priority Multi-Page Discovery & Queue Management
    const visited = new Set([finalNorm]);
    const queue = [];
    const queuedUrls = new Set();

    const discoveredSubpages = discoverRelevantPages($, finalUrl);
    for (const sp of discoveredSubpages) {
      const n = normalizeUrl(sp.url);
      if (visited.has(n) || queuedUrls.has(n)) continue;
      queue.push({ url: sp.url, normUrl: n, type: sp.type, depth: 1, score: sp.score });
      queuedUrls.add(n);
    }

    // 2. Ultra-Fast Hybrid Subpage Crawling (Parallel HTTP + Cheerio first, Playwright fallback reusing context)
    const subpageResults = [];
    const fallbackQueue = [];

    const httpPromises = queue.map(async item => {
      const norm = item.normUrl || normalizeUrl(item.url);
      if (visited.has(norm)) return;
      visited.add(norm);

      const httpResult = await fetchSubpageHttp(item.url, item.type);
      if (httpResult) {
        subpageResults.push(httpResult);
      } else {
        fallbackQueue.push(item);
      }
    });

    await Promise.all(httpPromises);

    // Playwright fallback using same context
    if (fallbackQueue.length > 0 && context) {
      for (const item of fallbackQueue.slice(0, 3)) {
        let subPage = null;
        try {
          subPage = await context.newPage();
          await setupRequestBlockers(subPage);
          await subPage.goto(item.url, {
            waitUntil: 'domcontentloaded',
            timeout: 8000
          });
          await subPage.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
          await subPage.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          await subPage.waitForTimeout(500).catch(() => {});

          let subHtml = null;
          for (let i = 0; i < 3; i++) {
            try {
              subHtml = await subPage.content();
              break;
            } catch (err) {
              if (i === 2) throw err;
              await subPage.waitForTimeout(500).catch(() => {});
            }
          }
          if (subHtml) {
            const sub$ = cheerio.load(subHtml);
            const subText = extractTextWithSpaces(sub$, sub$('body'));
            const subExtracted = extractPage(sub$, subPage.url() || item.url, item.type || 'other');

            subpageResults.push({
              type: item.type,
              page_type: item.type,
              url: subPage.url() || item.url,
              $: sub$,
              text: subText || subExtracted.text,
              ...subExtracted
            });
          }
        } catch {
          // Gracefully skip failed fallback page
        } finally {
          if (subPage) {
            try { await subPage.close(); } catch {}
          }
        }
      }
    }

    // Deduplicate allPages strictly by normalized URL
    const seenPages = new Set();
    const allPages = [];
    for (const p of [homePageObj, ...subpageResults.filter(Boolean)]) {
      const pNorm = normalizeUrl(p.url || '');
      if (!seenPages.has(pNorm)) {
        seenPages.add(pNorm);
        allPages.push(p);
      }
    }

    log.info(`pages crawled count: ${allPages.length}`);

    // Build pages_by_type
    const pagesByType = {};
    for (const p of allPages) {
      const t = p.page_type || p.type || 'other';
      (pagesByType[t] ||= []).push({
        url: p.url,
        title: p.title,
        page_heading: p.page_heading,
        sections: p.sections,
        list_items: p.list_items,
        ordered_steps: p.ordered_steps,
        step_patterns: p.step_patterns,
        numbered_items: p.numbered_items,
        how_it_works_steps: p.how_it_works_steps,
        contrast_sentences: p.contrast_sentences,
        numeric_claims: p.numeric_claims,
        plan_cards: p.plan_cards,
        paragraphs: p.paragraphs,
        links: p.links,
        json_ld: p.json_ld
      });
    }

    // Aggregate signals
    const signals = {
      all_contrast_sentences: uniqFlat(allPages, p => p.contrast_sentences || []),
      all_numeric_claims:     uniqFlat(allPages, p => p.numeric_claims || []),
      all_ordered_steps:      allPages.flatMap(p => p.ordered_steps || []),
      all_step_patterns:      uniqFlat(allPages, p => p.step_patterns || []),
      all_numbered_items:     uniqFlat(allPages, p => p.numbered_items || []),
      all_how_it_works_steps: uniqFlat(allPages, p => p.how_it_works_steps || []),
      how_it_works_by_page:   allPages.map(p => ({
        url: p.url,
        steps: (p.how_it_works_steps && p.how_it_works_steps.length >= 2 ? p.how_it_works_steps : null) ||
               (p.ordered_steps && p.ordered_steps[0] && p.ordered_steps[0].length >= 2 ? p.ordered_steps[0] : null) ||
               ((p.paragraphs || []).concat((p.sections || []).map(s => typeof s === 'string' ? s : s.text))
                 .map(t => (t || '').split(/,\s*(?=(?:Tell us|Receive the best|Step \d))/i).map(s => s.trim()).filter(Boolean))
                 .find(parts => parts.length >= 2) || null)
      })).filter(p => p.steps && p.steps.length >= 2),
      all_plan_cards:         allPages.flatMap(p => p.plan_cards || []),
      all_page_headings:      allPages.map(p => ({ url: p.url, heading: p.page_heading || p.title })),
      all_contrast_by_page:   allPages.map(p => ({
        url: p.url,
        sentences: p.contrast_sentences || [],
      })),
      numbered_items_by_page: allPages.map(p => ({
        url: p.url,
        page_type: p.page_type || p.type || 'other',
        items: p.numbered_items || [],
      })),
    };

    // Aggregate JSON-LD across all pages
    const jsonLdList = [];
    for (const p of allPages) {
      jsonLdList.push(...(p.json_ld && p.json_ld.length > 0 ? p.json_ld : extractJsonLd(p.$)));
    }
    const jsonLdOrg = findOrganizationInJsonLd(jsonLdList);
    const meta = extractMetaTags($, finalUrl);

    // Base Company Metadata
    const name = extractCompanyName($, jsonLdOrg, meta, finalUrl);
    const description = extractDescription($, jsonLdOrg, meta);
    const email = extractEmail(allPages, jsonLdList);
    const phone = extractPhone(allPages, jsonLdList);
    const addressData = extractAddress(allPages, jsonLdList);
    const { logo, images } = extractLogoAndImages(allPages, jsonLdList, meta, finalUrl);
    const socialLinks = extractSocialLinks(allPages, jsonLdList);
    const openingHours = extractOpeningHours($, jsonLdOrg);

    // Strategy
    const businessStrategy = deriveStrategy({
      name,
      description,
      signals,
      pages_by_type: pagesByType,
      pages: allPages,
      meta,
      json_ld: jsonLdList,
      url: finalUrl
    });

    const crawledPages = [
      ...new Map(
        allPages.map(page => [
          normalizeUrl(page.url || ''),
          { type: page.page_type || page.type, url: page.url }
        ])
      ).values()
    ];

    const metaSummary = {
      title: meta.title,
      description: meta.description,
      keywords: meta.keywords,
      og_image: meta.og_image,
      canonical: meta.canonical
    };

    const summarySignals = {
      all_contrast_sentences: signals.all_contrast_sentences || [],
      all_numeric_claims:     signals.all_numeric_claims || [],
      all_plan_cards:         signals.all_plan_cards || [],
      all_page_headings:      signals.all_page_headings || [],
    };

    // Combine all extracted data/text with labels into a comma-separated string
    const allDataPieces = [];
    if (meta.title || allPages[0]?.title) allDataPieces.push(`title: ${meta.title || allPages[0]?.title}`);
    if (name) allDataPieces.push(`name: ${name}`);
    if (description) allDataPieces.push(`description: ${description}`);
    if (email) allDataPieces.push(`email: ${email}`);
    if (phone) allDataPieces.push(`phone: ${phone}`);
    if (addressData.address) allDataPieces.push(`address: ${addressData.address}`);
    if (addressData.street) allDataPieces.push(`street: ${addressData.street}`);
    if (addressData.postal_code) allDataPieces.push(`postal_code: ${addressData.postal_code}`);
    if (addressData.city) allDataPieces.push(`city: ${addressData.city}`);
    if (addressData.country) allDataPieces.push(`country: ${addressData.country}`);
    const websiteUrl = meta.canonical || finalUrl;
    if (websiteUrl) allDataPieces.push(`website: ${websiteUrl}`);

    const socialArr = Array.isArray(socialLinks) ? socialLinks : Object.values(socialLinks || {});
    if (socialArr.length > 0) allDataPieces.push(`social_links: ${socialArr.join(' ')}`);

    // Additional page texts and headings
    for (const p of allPages) {
      if (p.page_heading && p.page_heading !== meta.title && p.page_heading !== name) {
        allDataPieces.push(`heading: ${p.page_heading}`);
      }
      if (Array.isArray(p.paragraphs)) {
        for (const para of p.paragraphs) {
          if (para && typeof para === 'string' && para.trim()) {
            allDataPieces.push(para.trim());
          }
        }
      }
      if (Array.isArray(p.sections)) {
        for (const sec of p.sections) {
          const txt = typeof sec === 'string' ? sec : (sec && sec.text);
          if (txt && typeof txt === 'string' && txt.trim()) {
            allDataPieces.push(txt.trim());
          }
        }
      }
      if (Array.isArray(p.list_items)) {
        for (const li of p.list_items) {
          if (li && typeof li === 'string' && li.trim()) {
            allDataPieces.push(li.trim());
          }
        }
      }
    }

    const allDataString = [...new Set(allDataPieces.filter(Boolean))].join(', ');

    const summaryData = {
      name,
      description,
      email,
      phone,
      address: addressData.address,
      street: addressData.street,
      postal_code: addressData.postal_code,
      city: addressData.city,
      country: addressData.country,
      website: meta.canonical || finalUrl,
      logo,
      social_links: socialLinks,
      opening_hours: openingHours,
      images,
      business_strategy: businessStrategy,
      meta: metaSummary,
      signals: summarySignals,
      crawled_pages: crawledPages,
      pages_by_type: pagesByType,
      all_data: allDataString
    };

    const rawData = {
      ...summaryData,
      signals: signals,
      pages_by_type: pagesByType,
      crawled_pages: crawledPages
    };

    log.info(`crawl finished for ${targetUrl}`);

    return {
      success: true,
      data: options.includeRaw || options.format === 'raw' ? rawData : summaryData,
      raw: rawData
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {}
    }
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    if (isIsolated && browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

module.exports = {
  scrapeWebsite,
  normalizeUrl,
  getBrowserInstance,
  closeBrowserInstance
};
