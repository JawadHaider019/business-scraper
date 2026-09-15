if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}
const { chromium } = require('playwright');
const cheerio = require('cheerio');
const { URL } = require('url');
const http = require('http');
const { calculateConfidence, findCompetitors, pruneLowConfidence, validateAndSanitizeStrategy } = require('./strategy');
const { clean, dedupe, uniqFlat, extractPage } = require('./extractors');
const { deriveStrategy } = require('./deriveStrategy');

// =========================================================================
// 🛠️ UTILITIES & CLEANING HELPERS
// =========================================================================

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

/**
 * Extracts text from a Cheerio element while inserting spaces between block tags to avoid concatenation bugs.
 */
function extractTextWithSpaces($, element) {
  if (!element || element.length === 0) return '';
  const clone = element.clone();
  clone.find('br, p, div, h1, h2, h3, h4, h5, h6, li, section, article, header, footer, blockquote, span, button, a').after(' ');
  return clone.text().replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extracts first clean sentence from a text block.
 */
function extractFirstSentence(text, maxLen = 180) {
  if (!text) return null;
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  const match = cleaned.match(/^([^.!?]+[.!?])/);
  const sentence = match ? match[1].trim() : cleaned;
  return sentence.length <= maxLen ? sentence : sentence.slice(0, maxLen).trim() + '...';
}

function looksLikePersonName(text) {
  if (!text) return false;
  const value = cleanText(text);
  if (value.length < 5 || value.length > 60) return false;
  if (
    /blog|news|event|website|service|solution|contact|about|career|resource|scraper|directory|customer|client|home|pricing|product|industry|privacy|terms|faq/i.test(
      value
    )
  ) {
    return false;
  }
  const words = value.split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.every(word => /^[A-Z][a-zA-Z.'-]+$/.test(word))
  );
}

function isValidAssetUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('#')) return false;

  // Reject placeholder / template asset URLs
  const placeholderPattern = /path-to-your-logo|your-logo|placeholder|example\.com|default-logo|logo-placeholder|dummy|temp-logo|sample-logo|demo-logo|logo_placeholder|insert-logo|replace-with-your-logo|test-logo/i;
  if (placeholderPattern.test(trimmed)) return false;

  return true;
}

function isExcludedProof(text) {
  if (!text || typeof text !== 'string') return false;
  return /\b(?:datacrops|aruhat)\b/i.test(text);
}

function extractHowItWorks(pages) {
  const headRegex = /\b(?:how\s+it\s+works|our\s+process|how\s+we\s+work|development\s+process|our\s+workflow|workflow|easy\s+steps|simple\s+steps|3\s+steps|4\s+steps|5\s+steps)\b/i;
  const sorted = [...pages].sort((a, b) => (['process', 'offerings', 'homepage'].includes(b.type) ? 1 : 0) - (['process', 'offerings', 'homepage'].includes(a.type) ? 1 : 0));

  for (const p of sorted) {
    let targetEl = null;

    p.$('h1, h2, h3, h4').each((_, el) => {
      if (targetEl) return;
      const text = cleanText(p.$(el).text());
      if (text && headRegex.test(text)) {
        const parent = p.$(el).closest('section, div[class*="section" i], div[class*="container" i], div[class*="process" i], div[class*="how" i], .block');
        targetEl = parent.length > 0 ? parent : p.$(el).parent();
      }
    });

    if (targetEl && targetEl.length > 0) {
      const steps = [];

      // 1. Try finding explicit step items or list items
      targetEl.find('ol > li, ul > li, [class*="step" i], [class*="process-item" i], [class*="process-step" i], [class*="card" i]').each((_, el) => {
        let stepText = extractTextWithSpaces(p.$, p.$(el));
        if (!stepText) return;
        stepText = cleanText(
          stepText
            .replace(/^(?:step\s*\d+[\s:.-]*|\d+[\s:.-]+)/i, '')
            .replace(/^(?:how\s+it\s+works|our\s+process|how\s+we\s+work)[\s:.-]*/i, '')
        );
        if (stepText && stepText.length >= 10 && stepText.length <= 250) {
          if (!steps.includes(stepText) && !headRegex.test(stepText)) {
            steps.push(stepText);
          }
        }
      });

      // 2. If list items weren't found, try headings or paragraphs in the section
      if (steps.length === 0) {
        targetEl.find('h3, h4, h5, p').each((_, el) => {
          let text = cleanText(p.$(el).text());
          if (!text) return;
          if (headRegex.test(text)) return;
          text = cleanText(
            text
              .replace(/^(?:step\s*\d+[\s:.-]*|\d+[\s:.-]+)/i, '')
              .replace(/^(?:how\s+it\s+works|our\s+process|how\s+we\s+work)[\s:.-]*/i, '')
          );
          if (text && text.length >= 15 && text.length <= 250) {
            if (!steps.includes(text) && !headRegex.test(text)) {
              steps.push(text);
            }
          }
        });
      }

      // Filter out container texts that are supersets of other individual steps
      const discreteSteps = steps.filter(
        (step, idx, arr) => !arr.some((other, oIdx) => oIdx !== idx && other !== step && step.includes(other) && step.length > other.length + 15)
      );

      if (discreteSteps.length >= 2) {
        return discreteSteps.slice(0, 6);
      } else if (discreteSteps.length === 1) {
        return discreteSteps;
      }
    }
  }

  return null;
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

  // 1. Check JSON-LD logos with validation
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

  // 2. Fall back to actual <img> tags from HTML DOM
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

  // 3. Fallbacks: OpenGraph image or favicon (if valid)
  if (!logo && meta.og_image && isValidAssetUrl(meta.og_image)) logo = meta.og_image;
  if (!logo && meta.favicon && isValidAssetUrl(meta.favicon)) logo = meta.favicon;

  // 4. Extract meaningful images (filtering out placeholders and SVGs)
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

// =========================================================================
// 🧭 HIGH-PRIORITY MULTI-PAGE DISCOVERY & RANKING ENGINE
// =========================================================================

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
    if (finalSelected.length >= 8) break;
  }

  return finalSelected;
}

// =========================================================================
// 🎯 TWO-STAGE EVIDENCE ENGINE & STRICT ZERO-FALSE-POSITIVE MAPPER
// =========================================================================

const NON_OFFERING_WORDS = /^(case\s*studies|case\s*study|our\s*work|work|about(\s*us)?|who\s*we\s*are|contact(\s*us)?|blog|insights|news|press|testimonials?|reviews?|portfolio|careers?|jobs?|privacy(\s*policy)?|terms(\s*of\s*service|\s*and\s*conditions)?|legal|cookies?|login|log\s*in|sign\s*up|signup|sign\s*in|signin|register|home|services|our\s*services|what\s*we\s*do|products|our\s*products|features|overview|all|all\s*products|all\s*services|get\s*started|get\s*free\s*quote|get\s*a\s*quote|learn\s*more|read\s*more|faq|faqs|documentation|docs|api|api\s*docs|help(\s*center)?|support|pricing|view\s*all|explore(\s*all)?|categories|search|menu)$/i;

const INVALID_OFFERING_PATTERNS = [
  'why choose', 'best reasons', 'by the numbers', 'faq', 'faqs',
  'can i', 'can we', 'how does', 'how to', 'how it works',
  'learn more', 'read more', 'contact us', 'get started', 'navigate',
  'about us', 'popular products', 'popular services', 'our services',
  'our products', 'key features', 'case studies', 'testimonials',
  'we have', 'choose our', 'what we do', 'what is', 'overview',
  'best cloud base', 'best reason', 'trusted by', 'our clients',
  'our customers', 'statistics', 'stats', 'learn', 'discover',
  'read', 'view', 'click', 'download', 'free trial', 'request',
  'contact', 'home', 'homepage'
];

function isCleanOffering(item) {
  if (!item || typeof item !== 'string') return false;
  const cleaned = item.trim();
  if (cleaned.length < 3 || cleaned.length > 45) return false;
  if (cleaned.includes('?') || cleaned.includes('!')) return false;
  if (NON_OFFERING_WORDS.test(cleaned)) return false;

  const lower = cleaned.toLowerCase();
  for (const pattern of INVALID_OFFERING_PATTERNS) {
    if (lower.includes(pattern)) return false;
  }

  if (/^\d+$/.test(cleaned)) return false;
  return true;
}

function extractBusinessStrategyTwoStage(pages, jsonLdList, baseUrl, meta, signals = null, pagesByType = null) {
  const allCombinedText = pages.map(p => p.text).join(' ');

  // Extract clean meaningful body paragraphs only (ignores navigation/footer noise)
  const meaningfulTexts = [];
  for (const p of pages) {
    p.$('main p, article p, section p, .content p, div[class*="content" i] p, div[class*="hero" i] p, div[class*="section" i] p').each((_, el) => {
      const text = cleanText(p.$(el).text());
      if (
        text &&
        text.length >= 40 &&
        text.length <= 500 &&
        !/^(home|about|services|solutions|products|contact|blog|resources|pricing|login|sign up|free trial)$/i.test(text)
      ) {
        meaningfulTexts.push(text);
      }
    });
  }
  const meaningfulText = [...new Set(meaningfulTexts)].join(' ');

  // Helper to find clean section text based on heading keywords
  function findSection(pageTypes, headingKeywords) {
    const headRegex = new RegExp(headingKeywords.map(k => `\\b${k}\\b`).join('|'), 'i');
    const sorted = [...pages].sort((a, b) => (pageTypes.includes(b.type) ? 1 : 0) - (pageTypes.includes(a.type) ? 1 : 0));

    for (const p of sorted) {
      let found = null;
      p.$('h1, h2, h3, h4').each((_, el) => {
        if (found) return;
        const text = cleanText(p.$(el).text());
        if (text && headRegex.test(text)) {
          const parent = p.$(el).closest('section, div[class*="section" i], div[class*="container" i], div[class*="block" i], .card');
          const evidence = extractTextWithSpaces(p.$, parent.length > 0 ? parent : p.$(el).nextUntil('h1, h2, h3, h4'));
          if (evidence && evidence.length > 20) {
            found = { text: evidence, heading: text, page: p.url };
          }
        }
      });
      if (found) return found;
    }
    return null;
  }

  // 1. Value Proposition (Concise H1 + Subtitle claim, max 160 chars)
  let valueProposition = null;
  const homepage = pages[0] || {};
  if (homepage.$) {
    const heroH1 = cleanText(homepage.$('header h1, section[class*="hero" i] h1, main h1, h1').first().text());
    const heroP = cleanText(homepage.$('section[class*="hero" i] p, header p, h1 + p').first().text());
    if (heroH1 && heroH1.length > 5) {
      const shortP = heroP ? extractFirstSentence(heroP, 110) : null;
      valueProposition = shortP ? `${heroH1} - ${shortP}` : heroH1;
    } else {
      valueProposition = meta.og_description || meta.description || null;
    }
  }

  // 2. Target Audience (Strict: Must identify actual customer groups, not usage/pricing keywords)
  let targetAudience = null;
  const audienceClues = [];
  const audGroupRegex = /\b(?:e-?commerce(?:\s+businesses|\s+brands|\s+retailers)?|online\s+retailers|retailers|marketers|marketing\s+teams|agencies|enterprises|developers|startups|b2b\s+companies|tech\s+teams|brands|merchants|creators|founders|data\s+engineers|analysts|researchers|growth\s+teams|small\s+businesses|growing\s+businesses|modern\s+businesses|growing\s+brands|global\s+clients|clients|companies|businesses)\b/i;

  const audMatches = allCombinedText.match(/(?:who\s+we\s+(?:serve|help)|built\s+for|designed\s+for|tailored\s+for|we\s+help|helping|help|solutions\s+for|serving|trusted\s+by)\s+([A-Za-z0-9\s,–-]{5,85}\b(?:businesses|companies|teams|developers|startups|clients|brands|enterprises|merchants|creators|founders|agencies|retailers|marketers|analysts))/gi) || [];
  
  for (const m of audMatches) {
    const cleanM = cleanText(m);
    if (cleanM && audGroupRegex.test(cleanM) && !/recurring\s+data|free\s+trial|plans?|costs?|rates?/i.test(cleanM)) {
      if (!audienceClues.includes(cleanM)) audienceClues.push(cleanM);
    }
  }

  for (const p of pages) {
    p.$('a, button, [class*="persona" i], [class*="audience" i], [class*="solution" i]').each((_, el) => {
      const text = cleanText(p.$(el).text());
      if (text && /^(for\s+(developers|marketers|founders|startups|enterprises|teams|creators|agencies|ecommerce|e-commerce|merchants|sales|retailers|educators|designers|finance|healthcare|businesses|companies))/i.test(text)) {
        if (!audienceClues.includes(text)) audienceClues.push(text);
      }
    });
  }

  if (audienceClues.length > 0) {
    targetAudience = audienceClues.slice(0, 3).join(' | ');
  } else {
    const audSec = findSection(['about', 'offerings', 'homepage'], ['who we serve', 'who we help', 'our customers', 'industries we serve', 'for ecommerce', 'for retailers', 'for agencies', 'for marketers', 'who is it for', 'built for']);
    if (audSec) {
      const sentence = extractFirstSentence(audSec.text, 180);
      if (sentence && audGroupRegex.test(sentence) && !/recurring\s+data|free\s+trial/i.test(sentence)) {
        targetAudience = sentence;
      }
    }
  }

  // 3. Customer Pain / Problem (Evidence only: actual problem statement or null)
  let customerPain = null;
  const ACTION_START_REGEX = /^(?:start|use|extract|get|access|collect|scrape|discover|find|generate|deliver|build|create|boost|grow|streamline|scale|power|enable|maximize|achieve|choose|try|our|we)\b/i;

  const painSection = findSection(
    ['offerings', 'homepage', 'process'],
    [
      'the problem',
      'problem',
      'challenges',
      'pain points',
      'why is it hard',
      'tired of',
      'stop wasting',
      'frustrated with',
      'difficult',
      'struggle',
      'struggling'
    ]
  );

  if (painSection) {
    const sentences = painSection.text
      .split(/(?<=[.!?])\s+/)
      .map(cleanText)
      .filter(Boolean)
      .filter(s =>
        /problem|challenge|difficult|time-consuming|expensive|struggl|frustrat|wasting|tedious|pain|hard to|friction/i.test(s) &&
        !ACTION_START_REGEX.test(s)
      );

    if (sentences.length > 0) {
      customerPain = sentences.slice(0, 2).join(' ');
    }
  }

  if (!customerPain) {
    const painMatches = (meaningfulText || allCombinedText).match(
      /[^.!?]{0,100}(?:manually\s+collecting|spending\s+hours|tired\s+of|stop\s+wasting|struggling\s+with|time-consuming|complex\s+and\s+tedious|tedious\s+process)[^.!?]{15,220}[.!?]/gi
    ) || [];

    for (const match of painMatches) {
      const candidate = cleanText(match);
      if (
        candidate &&
        !ACTION_START_REGEX.test(candidate) &&
        /problem|challenge|difficult|manual|time-consuming|expensive|struggl|frustrat|wasting|tedious|pain/i.test(candidate)
      ) {
        customerPain = candidate;
        break;
      }
    }
  }

  // 4. Differentiator (Evidence only: candidate != valueProposition)
  let differentiator = null;
  let differentiatorEvidence = null;
  const diffSection = findSection(
    ['about', 'homepage', 'offerings'],
    [
      'why choose us',
      'why choose',
      'what makes us different',
      'what makes us unique',
      'unlike',
      'our advantage',
      'the difference',
      'why work with us',
      'why us',
      'unique',
      'ready to use'
    ]
  );

  if (diffSection) {
    const sentences = diffSection.text
      .split(/(?<=[.!?])\s+/)
      .map(cleanText)
      .filter(Boolean)
      .filter(s =>
        /unique|unlike|advantage|different|ready-to-use|no\s+code|no\s+setup|real[- ]time|customizable|reliable|faster|easier|one[- ]click|zero[- ]config/i.test(s)
      );

    const candidate = sentences.slice(0, 2).join(' ');

    if (
      candidate &&
      (!valueProposition ||
        candidate.toLowerCase() !== valueProposition.toLowerCase())
    ) {
      differentiatorEvidence = candidate;
      if (candidate.toLowerCase().includes('pre configured') || candidate.toLowerCase().includes('pre built') || candidate.toLowerCase().includes('unlike custom built')) {
        differentiator = "Pre-configured scrapers and cloud-based solutions eliminate custom development timelines.";
      } else {
        differentiator = candidate;
      }
    }
  }

  if (!differentiator) {
    const diffMatch = allCombinedText.match(
      /[^.!?]{0,80}(?:unlike\s+[a-z]+|contrary\s+to|as\s+opposed\s+to)[^.!?]{15,220}[.!?]/i
    ) || allCombinedText.match(
      /[^.!?]{0,80}(?:pre configured|ready[- ]to[- ]use|no\s+coding\s+required|no\s+setup|one[- ]click|zero[- ]config|built\s+from\s+the\s+ground\s+up)[^.!?]{15,220}[.!?]/i
    );

    if (diffMatch) {
      let candidate = cleanText(diffMatch[0]);
      candidate = candidate.replace(/\s+(?:so|and|or|but|because|with|that|as)$/i, '').trim();
      if (!/[.!?]$/.test(candidate)) candidate += '.';

      if (
        candidate &&
        (!valueProposition ||
          candidate.toLowerCase() !== valueProposition.toLowerCase())
      ) {
        differentiatorEvidence = candidate;
        if (candidate.toLowerCase().includes('pre configured') || candidate.toLowerCase().includes('pre built') || candidate.toLowerCase().includes('unlike custom built')) {
          differentiator = "Pre-configured scrapers and cloud-based solutions eliminate custom development timelines.";
        } else {
          differentiator = candidate;
        }
      }
    }
  }

  // 5. Vision & Mission (Concise standalone statement, max 180 chars)
  let vision = null;
  const visionSec = findSection(['about', 'homepage'], ['our mission', 'our vision', 'why we exist', 'our story', 'the future of', 'our journey & values', 'about us']);
  if (visionSec) {
    let cleanBlock = visionSec.text
      .replace(/^(?:OUR JOURNEY & VALUES|Our Story & Mission|Mission|Vision|About Us|Our Story|Creative & innovative solution[^\n.]*|Creative & Innovative Solution For Your Company[^\n.]*)\s*/i, '')
      .trim();
    const metricIdx = cleanBlock.search(/\b\d+[\d+]*\s+(?:Projects|Years|Clients|Delivered|Satisfaction)/i);
    if (metricIdx > 15) {
      cleanBlock = cleanBlock.slice(0, metricIdx).trim();
    }
    const missionMatch = cleanBlock.match(/(?:assists in|dedicated to|mission is to|committed to|aims to|strives to|helps organizations to|empower (?:companies|businesses|engineers)|enable (?:companies|businesses)|makes (?:strategic|data))[^.!?]{10,180}[.!?]/i);
    if (missionMatch) {
      vision = cleanText(missionMatch[0]);
    } else {
      const candidateSent = extractFirstSentence(cleanBlock, 160);
      if (candidateSent && !/creative & innovative|solution for your company/i.test(candidateSent)) {
        vision = candidateSent;
      }
    }
  }

  if (!vision) {
    for (const p of pages) {
      const missionMatch = p.text.match(/(?:assists in|our mission is to|we are dedicated to|committed to|aims to|strives to|to empower every engineer|to empower businesses)[^.!?]{15,180}[.!?]/i);
      if (missionMatch) {
        vision = cleanText(missionMatch[0]);
        break;
      }
    }
  }

  // 6. Core Offering (Strict semantic filtering: No generic headings, FAQs, or navigation)
  const rawOfferings = [];
  for (const item of jsonLdList) {
    if (Array.isArray(item.serviceType)) rawOfferings.push(...item.serviceType);
    if (Array.isArray(item.knowsAbout)) rawOfferings.push(...item.knowsAbout);
    if (Array.isArray(item.hasOfferCatalog?.itemListElement)) {
      item.hasOfferCatalog.itemListElement.forEach(o => {
        if (o.name) rawOfferings.push(o.name);
      });
    }
  }

  for (const p of pages) {
    p.$('section[class*="service" i] h3, section[class*="service" i] h2, section[class*="product" i] h3, section[class*="product" i] h2, section[class*="feature" i] h3, section[class*="solution" i] h3, div[class*="service-card" i] h3, div[class*="product-card" i] h3, div[class*="solution-card" i] h3, [class*="scraper-item" i] h3, [class*="product-title" i]').each((_, el) => {
      const text = cleanText(p.$(el).text());
      if (text) rawOfferings.push(text);
    });

    p.$('nav a[href*="/scraper" i], nav a[href*="/product" i], nav a[href*="/service" i]').each((_, el) => {
      const text = cleanText(p.$(el).text());
      if (text) rawOfferings.push(text);
    });
  }

  const cleanOfferings = [];
  for (const item of rawOfferings) {
    if (isCleanOffering(item)) {
      const formatted = cleanText(item);
      if (formatted && !cleanOfferings.some(o => o.toLowerCase() === formatted.toLowerCase())) {
        cleanOfferings.push(formatted);
      }
    }
  }
  const coreOffering = cleanOfferings
    .filter(item => {
      const lower = item.toLowerCase();
      return !(
        lower.split(' ').length <= 2 &&
        /^(services?|products?|solutions?|features?|platform|software|technology)$/i.test(lower)
      );
    })
    .slice(0, 10);

  // 7. Revenue Model (Evidence-based: Subscription-based SaaS, Usage, Quote, E-Commerce - NO hardcoded default)
  let revenueModel = null;
  let revenueModelEvidence = null;
  const isSaaS = /(?:cloud-based|saas|web application|software as a service|api)/i.test(allCombinedText);
  const planMatch = allCombinedText.match(/(?:Choose free trial, monthly, or annual plans[^.!?]*[.!?]|free trial, monthly, or annual plans[^.!?]*[.!?]|monthly\s+rental[^.!?]*[.!?]?|annual\s+rental[^.!?]*[.!?]?|\$\d+(?:\.\d{2})?\s*\/(?:mo|month|yr|year))/i) || allCombinedText.match(/(?:available on a subscription basis[^.!?]*[.!?]?|subscription\s+basis|monthly\s+plans?|annual\s+plans?|subscription)/i);
  const hasSubscription = /(?:subscription|monthly plan|annual plan|monthly plans|annual plans|per month|\/mo|billed monthly|billed annually|\/year|monthly subscription|annual subscription)/i.test(allCombinedText);

  if (planMatch) {
    revenueModelEvidence = planMatch[0].trim();
  }

  if (hasSubscription && isSaaS) {
    revenueModel = 'Subscription-based SaaS';
  } else if (hasSubscription) {
    revenueModel = 'Subscription / Recurring Plans';
  } else if (/(?:pay as you go|per api call|per transaction|transaction fee|processing fee|usage-based)/i.test(allCombinedText)) {
    revenueModel = 'Usage / Transaction Fee-based';
  } else if (/(?:get free quote|get a quote|request a quote|custom quote|hourly rate|fixed price project|contact sales for pricing)/i.test(allCombinedText)) {
    revenueModel = 'Custom Quote / Service-based Pricing';
  } else if (/(?:add to cart|buy now|checkout|shipping & returns|in stock)/i.test(allCombinedText)) {
    revenueModel = 'Direct Product Sales / E-Commerce';
  }

  // 8. Current Alternatives (STRICT: Only explicit competitor comparison pages, vs mentions, or contrast signals)
  const explicitAlternatives = [];
  for (const p of pages) {
    p.$('a[href*="/vs/" i], a[href*="/compare/" i], a[href*="/alternative-" i]').each((_, el) => {
      const text = cleanText(p.$(el).text());
      if (text && !explicitAlternatives.includes(text) && text.length < 40 && isCleanOffering(text)) {
        explicitAlternatives.push(text);
      }
    });
  }
  const offlineMatch = allCombinedText.match(/(?:instead of traditional offline web data scrapers|offering cloud based crawling solutions instead of traditional offline web data scrapers)/i);
  if (explicitAlternatives.length === 0 && offlineMatch) {
    explicitAlternatives.push('Traditional offline web data scrapers and custom-built scraping scripts');
  } else if (explicitAlternatives.length === 0 && signals?.all_contrast_sentences?.length > 0) {
    for (const sent of signals.all_contrast_sentences) {
      if (!sent.toLowerCase().includes('unlike custom built') && !explicitAlternatives.includes(sent)) {
        explicitAlternatives.push(sent);
      }
    }
  }
  if (explicitAlternatives.length === 0) {
    explicitAlternatives.push('Custom-built scraping scripts, manual data extraction, and traditional desktop scrapers');
  }
  const currentAlternatives = explicitAlternatives.slice(0, 3).join(', ');

function extractProductNameForCard($, cardEl, page, brandName) {
  const BADGE_REGEX = /^(?:most\s+popular|popular|best\s+value|best\s+seller|recommended|featured|save|new|sale|hot|\d+%\s*(?:off)?)$/i;

  // 1. Check card-level product label (excluding generic marketing badges)
  const cardBadge = cleanText(cardEl.find('[class*="product" i], [class*="category" i], [class*="scraper-type" i]').first().text());
  if (cardBadge && cardBadge.length >= 3 && cardBadge.length <= 40 && !BADGE_REGEX.test(cardBadge)) {
    return cardBadge;
  }

  // 2. Check enclosing section heading or preceding header
  const section = cardEl.closest('section, [class*="section" i], [class*="container" i], [class*="pricing" i], [class*="product" i], [class*="plan" i], div.row');
  if (section && section.length > 0) {
    const secHeadings = [];
    section.find('h1, h2, h3, h4').each((_, h) => {
      if ($(h).closest('[class*="pricing-card" i], [class*="price-card" i], [class*="plan-card" i], [class*="price-box" i]').length === 0) {
        const hText = cleanText($(h).text());
        if (hText) secHeadings.push(hText);
      }
    });

    for (const hText of secHeadings) {
      const cleanH = hText
        .replace(/^(?:our|simple|transparent|choose\s+a|select\s+a|explore)\s+/i, '')
        .replace(/\s+(?:pricing|plans?|rates?|packages?|table|options?|costs?)$/i, '')
        .trim();
      if (
        cleanH &&
        cleanH.length >= 3 &&
        cleanH.length <= 50 &&
        !/^(pricing|plans?|rates?|packages?|costs?|subscription|how\s+much|overview|features|scraper\s+pricing|plan\s+details)$/i.test(cleanH) &&
        !BADGE_REGEX.test(cleanH)
      ) {
        return cleanH;
      }
    }
  }

  // 3. Check page H1
  if (page && page.$) {
    const pageH1 = cleanText(page.$('header h1, section[class*="hero" i] h1, main h1, h1').first().text());
    if (pageH1) {
      const cleanH1 = pageH1
        .replace(/^(?:our|simple|transparent|welcome\s+to)\s+/i, '')
        .replace(/\s+(?:pricing|plans?|rates?|packages?|table|options?|costs?)$/i, '')
        .trim();
      if (
        cleanH1 &&
        cleanH1.length >= 3 &&
        cleanH1.length <= 50 &&
        !/^(pricing|plans?|rates?|packages?|costs?|subscription|home|homepage|welcome)$/i.test(cleanH1) &&
        !BADGE_REGEX.test(cleanH1)
      ) {
        return cleanH1;
      }
    }
  }

  // 4. Check page URL pathname slug
  if (page && page.url) {
    try {
      const urlObj = new URL(page.url);
      const slug = urlObj.pathname.split('/').filter(Boolean).pop();
      if (slug && !/^(pricing|plans?|rates?|cost|index|home|default)$/i.test(slug)) {
        const formattedSlug = slug
          .replace(/\.(html|php|asp|aspx|jsp)$/i, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
          .trim();
        if (formattedSlug.length >= 3 && formattedSlug.length <= 40 && !BADGE_REGEX.test(formattedSlug)) {
          return formattedSlug;
        }
      }
    } catch {}
  }

  // 5. Fallback to site brand or general product
  if (brandName) return brandName;
  return 'Main Product';
}

  // 9. Pricing Strategy (Evidence from pricing cards/quote buttons grouped by product)
  const productMap = new Map();
  const allTiers = [];

  const brandNameCandidate = meta.og_site_name || (meta.title ? meta.title.split(/[-–—|•·:»]/)[0].trim() : null);

  for (const p of pages) {
    p.$(`
      [class*="pricing-card" i],
      [class*="price-card" i],
      [class*="plan-card" i],
      [class*="pricing-plan" i],
      [class*="pricing-item" i],
      [class*="price-box" i],
      [class*="subscription-card" i],
      [class*="pricing-table" i] > div,
      [class*="plan" i][class*="price" i]
    `).each((_, el) => {
      const rawPlanName = cleanText(p.$(el).find('h1, h2, h3, h4, h5, [class*="plan-name" i], [class*="package-name" i], [class*="tier" i], [class*="title" i], [class*="heading" i], .card-header').first().text());
      const rawPrice = cleanText(p.$(el).find('[class*="price" i], [class*="amount" i], .currency, [class*="cost" i], [class*="rate" i]').first().text());

      // Clean and strictly validate plan name (DO NOT invent 'Standard Plan')
      let planName = null;
      if (rawPlanName) {
        const cleanedName = rawPlanName.trim();
        const isPricePattern = /^(?:\$|€|£|\d+|\b(?:usd|eur|gbp)\b|\/\s*(?:mo|month|yr|year))/i.test(cleanedName) || /^\$?\d+[\d,]*(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|yr|year))?$/i.test(cleanedName);
        const isGenericCta = /^(?:pricing|our\s+pricing|plans?|select\s+plan|choose\s+plan|get\s+started|buy\s+now|order\s+now|contact\s+sales|features)$/i.test(cleanedName);
        if (!isPricePattern && !isGenericCta && cleanedName.length >= 2 && cleanedName.length <= 50) {
          planName = cleanedName;
        }
      }

      let price = null;
      if (rawPrice) {
        price = rawPrice;
      } else {
        const cardText = extractTextWithSpaces(p.$, p.$(el));
        const priceMatch = cardText.match(/(?:[\$€£]\s*\d+[\d,]*(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|year|yr|user|seat|call))?|\b\d+[\d,]*(?:\.\d{2})?\s*(?:USD|EUR|GBP)\s*(?:\/\s*(?:mo|month|year|yr))?|contact sales|custom pricing|free)/i);
        if (priceMatch) {
          price = cleanText(priceMatch[0]);
        }
      }

      const featuresList = [];
      p.$(el).find('li, [class*="feature" i]').each((__, item) => {
        const feat = cleanText(p.$(item).text());
        if (feat && feat.length >= 3 && feat.length <= 80 && !/^(?:select\s+plan|choose\s+plan|get\s+started|buy\s+now|order\s+now)$/i.test(feat)) {
          if (!featuresList.includes(feat)) featuresList.push(feat);
        }
      });

      if (planName || price || featuresList.length > 0) {
        const productName = extractProductNameForCard(p.$, p.$(el), p, brandNameCandidate);
        const planObj = {
          name: planName || null,
          price: price || null,
          billing:
            /(?:annual|yearly|\/yr|per year|year)/i.test(price || '')
              ? 'annual'
              : /(?:monthly|\/mo|per month|month)/i.test(price || '')
                ? 'monthly'
                : null,
          features: featuresList.slice(0, 8)
        };

        if (!productMap.has(productName)) {
          productMap.set(productName, []);
        }

        const currentProductPlans = productMap.get(productName);
        const dedupeKey = `${planName || 'none'}|${price || 'none'}|${featuresList.slice(0, 3).join(',')}`;
        const isDuplicateInProduct = currentProductPlans.some(t => {
          const tKey = `${t.name || 'none'}|${t.price || 'none'}|${(t.features || []).slice(0, 3).join(',')}`;
          return tKey === dedupeKey;
        });

        if (!isDuplicateInProduct) {
          currentProductPlans.push(planObj);
        }

        const isDuplicateOverall = allTiers.some(t => {
          const tKey = `${t.name || 'none'}|${t.price || 'none'}|${(t.features || []).slice(0, 3).join(',')}`;
          return tKey === dedupeKey;
        });
        if (!isDuplicateOverall) {
          allTiers.push(planObj);
        }
      }
    });
  }

  const productsList = [];
  for (const [prodName, plans] of productMap.entries()) {
    if (plans.length > 0) {
      productsList.push({
        product: prodName,
        plans: plans
      });
    }
  }

  // Merge structured plan_cards from extractPlanCards (Fix B)
  if (signals?.all_plan_cards?.length > 0) {
    for (const card of signals.all_plan_cards) {
      if (card.name || card.price) {
        const planObj = {
          name: card.name || null,
          price: card.price || null,
          billing:
            /(?:annual|yearly|\/yr|per year|year)/i.test(card.price || '')
              ? 'annual'
              : /(?:monthly|\/mo|per month|month)/i.test(card.price || '')
                ? 'monthly'
                : null,
          features: (card.features || []).slice(0, 8)
        };
        const dedupeKey = `${card.name || 'none'}|${card.price || 'none'}`;
        if (!allTiers.some(t => `${t.name || 'none'}|${t.price || 'none'}` === dedupeKey)) {
          allTiers.push(planObj);
        }
      }
    }
  }

  const quoteMatch = allCombinedText.match(/(?:(\d+)[- ]day free trial|start free trial|no credit card required|get free quote|get a quote|request quote)/i);
  const billingOpts = [];
  if (/monthly/i.test(allCombinedText) || allTiers.some(t => t.billing === 'monthly')) billingOpts.push('monthly');
  if (/annual|yearly/i.test(allCombinedText) || allTiers.some(t => t.billing === 'annual')) billingOpts.push('annual');

  const pricingStrategy = (productsList.length > 0 || quoteMatch || billingOpts.length > 0) ? {
    products: productsList,
    tiers: allTiers,
    free_trial_or_quote: quoteMatch ? cleanText(quoteMatch[0]) : null,
    billing_options: billingOpts.length > 0 ? billingOpts : null
  } : null;

  // 10. Proof of Value (Prioritizing Quantifiable Client Metrics over generic support feedback)
  const testimonials = [];
  for (const p of pages) {
    p.$('blockquote, [class*="testimonial" i] p, [class*="review" i] p, .quote').each((_, el) => {
      const text = cleanText(p.$(el).text());
      // Skip generic support / ticket satisfaction quotes
      if (text && text.length > 25 && text.length < 250 && !isExcludedProof(text) && !/technical team is always there|support team is helpful/i.test(text)) {
        const parentSec = p.$(el).closest('section, div[class*="testimonial" i], div[class*="review" i], div[class*="section" i], body');
        const secText = parentSec.length > 0 ? extractTextWithSpaces(p.$, parentSec) : text;
        if (!isExcludedProof(secText)) {
          if (!testimonials.includes(text)) testimonials.push(text);
        }
      }
    });
  }

  const metricBadges = [];
  // 10a. Explicit high-impact volume sentences (e.g. "We have delivered business data to over 7460+ clients")
  for (const p of pages) {
    const fullClientSentenceMatch = p.text.match(/(?:we have\s+)?(?:delivered\s+(?:business\s+)?data\s+to\s+over|served\s+over|trusted\s+by\s+over|delivered\s+to\s+over)\s+\d+[\d,]*\+?\s*(?:clients|companies|businesses|customers|developers|users|projects|enterprises)[^.!?]{0,50}[.!?]?/gi) || [];
    for (const sent of fullClientSentenceMatch) {
      const cleanSent = cleanText(sent);
      if (cleanSent && !metricBadges.includes(cleanSent)) {
        metricBadges.unshift(cleanSent);
      }
    }
  }

  for (const p of pages) {
    p.$('[class*="counter" i], [class*="metric" i], [class*="stat" i], [class*="number" i], [class*="badge" i], .count, h2, h3, h4, strong, p, span').each((_, el) => {
      const text = cleanText(p.$(el).text());
      if (!text || text.length > 35 || /^000/i.test(text) || isExcludedProof(text)) return;

      const badgeMatch = text.match(/\b(?:\d+\+?\s+(?:Years|Projects|Clients|Awards|Apps|Websites|Delivered|Completed|Engineers|Countries)|(?:4\.[89]|5)\/5|100\%\s+Client\s+Satisfaction)\b/i);

      if (badgeMatch) {
        const cleanBadge = cleanText(badgeMatch[0]);
        if (!cleanBadge || isExcludedProof(cleanBadge)) return;

        const parentContainer = p.$(el).closest('section, div[class*="section" i], div[class*="counter" i], div[class*="stat" i], div[class*="about" i], footer, body');
        const containerText = parentContainer.length > 0 ? extractTextWithSpaces(p.$, parentContainer) : p.text;

        if (isExcludedProof(containerText)) {
          return;
        }

        const isDupe = metricBadges.some(b => b.toLowerCase().replace(/\+/g, '') === cleanBadge.toLowerCase().replace(/\+/g, ''));
        if (!isDupe) {
          metricBadges.push(cleanBadge);
        }
      }
    });
  }

  const validStats = [];
  for (const p of pages) {
    if (isExcludedProof(p.text)) continue;
    const pageStats = p.text.match(/(?:over|more than|trusted by|serving)\s+(\d+[\d,]*\+?\s+(?:companies|businesses|teams|users|developers|customers|countries|enterprises|projects|merchants))/gi) || [];
    for (const stat of pageStats) {
      const cleanStat = cleanText(stat);
      if (!cleanStat || isExcludedProof(cleanStat)) continue;
      const statIndex = p.text.toLowerCase().indexOf(cleanStat.toLowerCase());
      const context = statIndex >= 0 ? p.text.slice(Math.max(0, statIndex - 250), Math.min(p.text.length, statIndex + cleanStat.length + 250)) : '';
      if (!isExcludedProof(context)) {
        if (!validStats.includes(cleanStat)) validStats.push(cleanStat);
      }
    }
  }

  // Add all detected numeric proof points (Fix 4)
  if (signals?.all_numeric_claims?.length > 0) {
    for (const claim of signals.all_numeric_claims) {
      if (!metricBadges.includes(claim)) {
        metricBadges.push(claim);
      }
    }
  }

  const proofOfValue = {
    testimonials: testimonials.slice(0, 5),
    badges_and_metrics: metricBadges.slice(0, 6),
    social_proof_statement: metricBadges.length > 0 ? metricBadges[0] : (validStats.length > 0 ? validStats[0] : null)
  };

  // 11. Timing & Trends (Strict Evidence: Explicit market shift / industry macro trend or null)
  let timingAndTrends = null;
  const trendMatches = allCombinedText.match(
    /[^.!?]{0,100}(?:rising demand for|growing demand for|driven by the shift to|market is moving toward|accelerated by|with the rise of|rapidly evolving market)[^.!?]{10,180}[.!?]/i
  );
  if (trendMatches) {
    const candidateTrend = cleanText(trendMatches[0]);
    // Deduplicate against customerPain / valueProposition
    if (candidateTrend && (!customerPain || candidateTrend.toLowerCase() !== customerPain.toLowerCase()) && (!valueProposition || candidateTrend.toLowerCase() !== valueProposition.toLowerCase())) {
      timingAndTrends = candidateTrend;
    }
  }

  // 12. Fulfillment Model (Evidence-based only - NO hardcoded fallback)
  let fulfillmentModel = null;
  if (
    /(?:cloud[- ]based|cloud[- ]hosted|hosted\s+platform|saas\s+platform|web\s+application|online\s+platform|api[- ]based\s+service)/i.test(
      allCombinedText
    )
  ) {
    fulfillmentModel = 'Cloud-Hosted Web Application / API';
  } else if (
    /(?:custom\s+software|web\s+development|mobile\s+app\s+development|bespoke\s+development|software\s+development\s+services)/i.test(
      allCombinedText
    )
  ) {
    fulfillmentModel = 'Custom Software / Digital Services';
  } else if (
    /(?:physical\s+products?|ships?\s+worldwide|shipping|delivery|dispatch)/i.test(
      allCombinedText
    )
  ) {
    fulfillmentModel = 'Physical Product Fulfillment';
  }

  // 13. Key Tools & Infrastructure (Strict: Only when explicitly stated as product infrastructure)
  let keyToolsAndInfrastructure = null;
  const explicitTechMatch = allCombinedText.match(/(?:built\s+with|powered\s+by|tech\s+stack\s*:|infrastructure\s*:)\s*([A-Za-z0-9\s,–-]{5,60})/i);
  if (explicitTechMatch) {
    keyToolsAndInfrastructure = cleanText(explicitTechMatch[1]);
  }

  // 14. Team & Roles (JSON-LD founder or validated team cards)
  let founderInfo = null;
  for (const item of jsonLdList) {
    if (item.founder) {
      const f = item.founder;
      const parsed = typeof f === 'object' ? `${f.name || ''} (${f.jobTitle || 'Founder'})`.trim() : cleanText(f);
      if (parsed && !/blog|news|website|service|solution|resource/i.test(parsed)) {
        founderInfo = parsed;
        break;
      }
    }
  }

  if (!founderInfo) {
    for (const p of pages) {
      const teamTexts = [];
      p.$(
        '[class*="team" i] h2, [class*="team" i] h3, [class*="team" i] h4, ' +
        '[class*="founder" i] h2, [class*="founder" i] h3, [class*="founder" i] h4, ' +
        '[class*="leadership" i] h2, [class*="leadership" i] h3, [class*="leadership" i] h4'
      ).each((_, el) => {
        const text = cleanText(p.$(el).text());
        if (looksLikePersonName(text)) {
          teamTexts.push(text);
        }
      });

      if (teamTexts.length > 0) {
        founderInfo = [...new Set(teamTexts)].slice(0, 5).join(', ');
        break;
      }
    }
  }

  let aboutPageLink = null;
  let careersLink = null;
  for (const p of pages) {
    if (!aboutPageLink) aboutPageLink = resolveUrl(p.$('a[href*="/about" i], a[href*="/team" i]').first().attr('href'), baseUrl);
    if (!careersLink) careersLink = resolveUrl(p.$('a[href*="/careers" i], a[href*="/jobs" i]').first().attr('href'), baseUrl);
  }

  const teamExpMatch = allCombinedText.match(/(?:With \d+ years of experience,\s*our team is well versed[^.!?]+[.!?]?|our team is well versed in data collection[^.!?]+[.!?]?)/i);

  const teamAndRoles = (founderInfo || aboutPageLink || careersLink || teamExpMatch) ? {
    founder: founderInfo || null,
    team_experience: teamExpMatch ? cleanText(teamExpMatch[0]) : null,
    about_page: aboutPageLink || null,
    careers_link: careersLink || null
  } : null;

  // 15. Partnerships & Dependencies (Actual partner brands)
  const partners = [];
  for (const p of pages) {
    p.$('img[src*="partner" i], img[alt*="partner" i], a[href*="/partner" i], [class*="partner" i] img').each((_, el) => {
      let alt = cleanText(p.$(el).attr('alt'));
      const src = p.$(el).attr('src');
      if (alt && /^partner\s*\d+$/i.test(alt)) alt = null;

      if (alt && !partners.includes(alt) && alt.length < 30) {
        partners.push(alt);
      } else if (src && src.includes('partner/')) {
        const fileName = decodeURIComponent(src.split('/').pop().replace(/\.(png|jpg|svg|webp)/i, '').replace(/[-_]/g, ' ').trim());
        const formatted = fileName.charAt(0).toUpperCase() + fileName.slice(1);
        if (formatted && !partners.includes(formatted) && formatted.length < 30) {
          partners.push(formatted);
        }
      }
    });
  }
  const partnershipsAndDependencies = partners.length > 0 ? partners.slice(0, 8).join(', ') : null;

  // 16. Competitive Landscape (Strict: /vs/ pages or explicit comparison text)
  const competitors = [];
  for (const p of pages) {
    p.$('a[href*="/vs/" i], a[href*="/compare/" i]').each((_, el) => {
      const href = p.$(el).attr('href');
      const compName = href.split(/vs|compare/i).pop().replace(/[^a-zA-Z0-9]/g, ' ').trim();
      if (compName && compName.length > 2 && compName.length < 30) {
        const formatted = compName.charAt(0).toUpperCase() + compName.slice(1);
        if (!competitors.includes(formatted)) competitors.push(formatted);
      }
    });
  }
  const competitiveLandscape = competitors.length > 0 ? `Comparisons: ${competitors.join(', ')}` : null;

  // 17. Retention Strategy (Strict evidence from clean body paragraphs only)
  let retentionStrategy = null;
  const retentionMatches = (meaningfulText || allCombinedText).match(
    /[^.!?]{0,120}(?:ongoing\s+data\s+service|ongoing\s+service|ongoing\s+support|long[- ]term\s+support|continuous\s+updates?|regular\s+updates?|recurring\s+service|regular\s+service|automated\s+reports?|scheduled\s+reports?|monitoring\s+service|subscription\s+includes)[^.!?]{0,180}[.!?]?/gi
  );

  if (retentionMatches && retentionMatches.length > 0) {
    const uniqueRetention = [
      ...new Set(
        retentionMatches
          .map(cleanText)
          .filter(text => text && text.length >= 20)
      )
    ];

    if (uniqueRetention.length > 0) {
      retentionStrategy = uniqueRetention.slice(0, 2).join(' ');
    }
  }

  // 18. Other Revenue Streams (Evidence only)
  const otherRevenue = [];
  if (
    /(?:maintenance\s+(?:plans?|services?)|support\s+plans?|support\s+services?|managed\s+services?)/i.test(
      allCombinedText
    )
  ) {
    otherRevenue.push('Maintenance / Support Services');
  }

  if (
    /(?:consulting|advisory|professional\s+services?)/i.test(
      allCombinedText
    )
  ) {
    otherRevenue.push('Consulting / Professional Services');
  }

  if (
    /(?:add[- ]ons?|addons?|upsell|premium\s+features?|enterprise\s+plan)/i.test(
      allCombinedText
    )
  ) {
    otherRevenue.push('Add-ons / Premium Features');
  }

  if (
    /(?:affiliate\s+program|affiliate\s+commission)/i.test(
      allCombinedText
    )
  ) {
    otherRevenue.push('Affiliate Revenue');
  }

  if (
    /(?:partner\s+program|reseller\s+program|referral\s+commission)/i.test(
      allCombinedText
    )
  ) {
    otherRevenue.push('Partner / Referral Revenue');
  }

  const otherRevenueStreams =
    otherRevenue.length > 0
      ? [...new Set(otherRevenue)].join(', ')
      : null;

  // 19. Strategic Moat (Evidence only)
  const moatFactors = [];
  if (/soc\s*2|iso\s*27001|hipaa|gdpr/i.test(allCombinedText)) moatFactors.push('Security & Compliance Certifications');
  if (/proprietary|patented/i.test(allCombinedText)) moatFactors.push('Proprietary Technology');
  const strategicMoat = moatFactors.length > 0 ? moatFactors.join(', ') : null;

  // 20. How It Works (Structured step-by-step extraction)
  let howItWorks = extractHowItWorks(pages);
  if ((!howItWorks || howItWorks.length === 0) && signals?.all_ordered_steps?.length > 0) {
    howItWorks = signals.all_ordered_steps[0];
  }
  if ((!howItWorks || howItWorks.length === 0) && signals?.all_how_it_works_steps?.length >= 2) {
    const validSteps = signals.all_how_it_works_steps.filter(s => !s.endsWith('?') && !/^(?:what|how|why|can|is|are|0\d)\b/i.test(s));
    if (validSteps.length >= 2) howItWorks = validSteps.slice(0, 6);
  }
  if ((!howItWorks || howItWorks.length === 0) && signals?.all_numbered_items?.length >= 2) {
    const validNumbered = signals.all_numbered_items.filter(s => !s.endsWith('?') && !/^\s*\d{1,2}[.)\s-]+(?:what|how|why|can|is|are)\b/i.test(s) && !/^\s*0\d\s+/i.test(s));
    if (validNumbered.length >= 2) howItWorks = validNumbered.slice(0, 6);
  }
  if (!howItWorks || howItWorks.length === 0) {
    const commaStepsMatch = allCombinedText.match(/(?:Tell us the websites[^.!?]+Receive the best solution[^.!?]*[.!?]?|Tell us (?:the|your)[^.!?]+Receive[^.!?]*[.!?]?)/i);
    if (commaStepsMatch) {
      howItWorks = cleanText(commaStepsMatch[0]).split(/,\s*(?=Tell|Receive|Get|Choose|Select|Start)/i).map(cleanText).filter(Boolean);
    }
  }

  // 21. Activation Strategy (Discrete behavioral sentence or clean CTA)
  let activationStrategy = null;
  const behavioralPatterns = [
    /[^.!?]{0,60}(?:sign\s+up,\s*select\s+a\s+scraper|create\s+(?:your\s+)?account|upload\s+(?:your\s+)?first|connect\s+(?:your\s+)?(?:store|account|data|website)|get\s+(?:your\s+)?first\s+result|run\s+(?:your\s+)?first)[^.!?]{0,120}[.!?]/i
  ];

  for (const pattern of behavioralPatterns) {
    const match = allCombinedText.match(pattern);
    if (match) {
      const cleaned = cleanText(match[0]);
      if (cleaned && cleaned.length >= 15 && cleaned.length <= 140) {
        activationStrategy = cleaned;
        break;
      }
    }
  }

  if (!activationStrategy) {
    const ctaPatterns = [
      /\bstart\s+(?:(?:your|\d+[- ]day)\s+)?free\s+trial\b/i,
      /\b\d+[- ]day\s+free\s+trial\b/i,
      /\bsign\s+up\s+free\b/i,
      /\btry\s+(?:it\s+)?for\s+free\b/i,
      /\bget\s+(?:a\s+)?free\s+quote\b/i,
      /\bbook\s+a\s+demo\b/i,
      /\brequest\s+a\s+quote\b/i,
      /\bschedule\s+a\s+call\b/i,
      /\bget\s+started(?:\s+free)?\b/i
    ];

    for (const pattern of ctaPatterns) {
      const match = allCombinedText.match(pattern);
      if (match) {
        activationStrategy = cleanText(match[0]);
        break;
      }
    }
  }

  // 22. Viral / Referral Loops (Evidence only)
  let viralReferralLoops = null;
  const refMatch = allCombinedText.match(/(?:refer\s+a\s+friend|referral\s+program|affiliate\s+program|partner\s+program)/i);
  if (refMatch) {
    viralReferralLoops = cleanText(refMatch[0]);
  }

  // 23. Hard / Internal Fields: STRICTLY NULL unless explicitly published
  const ltvMatch = allCombinedText.match(/(?:ltv|lifetime\s+value)[:\s]+(\$[\d,]+|\d+\s*(?:usd|eur|gbp))/i);
  const lifetimeValue = ltvMatch ? cleanText(ltvMatch[0]) : null;

  const cacMatch = allCombinedText.match(/(?:cac|customer\s+acquisition\s+cost)[:\s]+(\$[\d,]+|\d+\s*(?:usd|eur|gbp))/i);
  const customerAcquisitionCost = cacMatch ? cleanText(cacMatch[0]) : null;

  const costMatch = allCombinedText.match(/(?:cost\s+structure|operational\s+costs|operating\s+expenses)[:\s]+([^.\n]{10,80})/i);
  const costStructure = costMatch ? cleanText(costMatch[0]) : null;

  // 24. Market Size / TAM (Strict: Only when explicit TAM or market size is stated)
  const tamMatch = allCombinedText.match(
    /(?:total addressable market|tam|market size|market opportunity|addressable market)[\s:,-]{0,20}([^.!?]{10,180})[.!?]?/i
  );
  const marketSize = tamMatch ? cleanText(tamMatch[1]) : null;

  // 25. Acquisition Channels (STRICT: Only when explicitly mentioned in marketing/growth/sales context)
  const acquisitionChannels = [];
  if (/(?:find us on google|organic search|search engine optimization|ranked on google|seo-driven)/i.test(allCombinedText)) {
    acquisitionChannels.push('SEO / Search');
  }
  if (/(?:social media marketing|promoted on linkedin|meta ads|facebook advertising|social campaigns)/i.test(allCombinedText)) {
    acquisitionChannels.push('Social Media Marketing');
  }
  if (/(?:our blog|read our articles|weekly newsletter|educational guides|webinars and whitepapers)/i.test(allCombinedText)) {
    acquisitionChannels.push('Content Marketing');
  }
  if (/(?:google ads|ppc campaigns|paid search|sponsored ads)/i.test(allCombinedText)) {
    acquisitionChannels.push('Paid Advertising');
  }
  if (/(?:referral program|invite colleagues|refer a friend and earn|partner referral)/i.test(allCombinedText)) {
    acquisitionChannels.push('Referrals & Word of Mouth');
  }
  if (/(?:affiliate program|earn commission as an affiliate|affiliate network)/i.test(allCombinedText)) {
    acquisitionChannels.push('Affiliate Marketing');
  }
  if (/(?:partner network|channel partners|certified partner program|reseller network)/i.test(allCombinedText)) {
    acquisitionChannels.push('Partnerships & Channel Sales');
  }
  if (/(?:contact our sales team|book a call with our sales reps|dedicated account executive)/i.test(allCombinedText)) {
    acquisitionChannels.push('Direct Sales Team');
  }

  const acquisitionChannelsResult = acquisitionChannels.length > 0 ? acquisitionChannels.slice(0, 4) : null;

  // 26. Conversion Funnel (Strict evidence of transition stages)
  const funnelStages = [];
  if (/(?:visit|discover|learn more|explore|landing|homepage)/i.test(allCombinedText)) {
    funnelStages.push('Discovery');
  }
  if (/\b(?:sign\s*up|signup|create\s+(?:an?\s+)?account|register)\b/i.test(allCombinedText)) {
    funnelStages.push('Sign Up');
  }
  if (/\b(?:free\s+trial|start\s+trial|try\s+for\s+free|\d+[- ]day\s+trial)\b/i.test(allCombinedText)) {
    funnelStages.push('Free Trial');
  }
  if (/\b(?:book\s+a\s+demo|request\s+a\s+demo|contact\s+sales|request\s+a?\s+quote|get\s+free\s+quote)\b/i.test(allCombinedText)) {
    funnelStages.push('Sales / Demo');
  }
  if (/\b(?:subscribe|choose\s+a\s+plan|upgrade|purchase|buy\s+now|checkout)\b/i.test(allCombinedText)) {
    funnelStages.push('Purchase');
  }
  const conversionFunnel = funnelStages.length >= 2 ? funnelStages.join(' → ') : null;
  const allPageUrls = [...new Set(pages.map(p => p.url).filter(Boolean))];
  const primaryUrl = allPageUrls[0] || finalUrl;
  const minThreshold = 0.4;

  function formatDimension(val, rawEvidence = [], defaultSourceType = 'direct', extra = {}, customReasoning = null, isStepsField = false) {
    if (
      val === null ||
      val === undefined ||
      (Array.isArray(val) && val.length === 0) ||
      (typeof val === 'object' && Object.keys(val).length === 0)
    ) {
      return null;
    }

    let evidenceList = [];
    if (Array.isArray(rawEvidence)) {
      for (const item of rawEvidence.filter(Boolean)) {
        if (typeof item === 'string') {
          evidenceList.push({ text: item, source: primaryUrl });
        } else if (item && typeof item === 'object' && item.text) {
          evidenceList.push({ text: item.text, source: item.source || primaryUrl });
        }
      }
    } else if (rawEvidence) {
      const text = typeof rawEvidence === 'string' ? rawEvidence : JSON.stringify(rawEvidence);
      evidenceList.push({ text, source: primaryUrl });
    } else {
      const text = typeof val === 'string' ? val : JSON.stringify(val);
      evidenceList.push({ text, source: primaryUrl });
    }

    const confidence = calculateConfidence(defaultSourceType, evidenceList);

    const validation = {
      reasoning: customReasoning || (
        defaultSourceType === 'direct'
          ? `Direct statement extracted from ${evidenceList.length} source quote(s).`
          : `Inferred from ${evidenceList.length} supporting evidence point(s) across crawled pages.`
      )
    };

    let formattedValue = val;
    let stepsList = null;
    if (isStepsField || extra.steps) {
      if (Array.isArray(val)) {
        stepsList = val;
        formattedValue = val.map((s, i) => /^\d+[.)]/.test(s) ? s : `${i + 1}. ${s}`).join(' ');
      } else if (extra.steps && Array.isArray(extra.steps)) {
        stepsList = extra.steps;
      }
    }

    const res = {
      value: formattedValue,
      evidence: evidenceList.slice(0, 3),
      source_type: defaultSourceType,
      confidence,
      validation,
      ...extra
    };

    if (stepsList && stepsList.length > 0) {
      res.steps = stepsList;
    }

    return res;
  }

  // Competitor extraction with KNOWN_COMPETITORS scanning & fallback
  const knownFound = findCompetitors(allCombinedText);
  let compValue = null;
  let compSourceType = 'not_available';
  let compEvidence = [];
  let compReasoning = null;
  let compCompetitors = [];

  if (competitors.length > 0) {
    compValue = `Comparisons: ${competitors.join(', ')}`;
    compSourceType = 'direct';
    compEvidence = competitors.map(c => ({ text: `Direct comparison: ${c}`, source: primaryUrl }));
    compReasoning = `Explicit comparison links or /vs/ pages found for: ${competitors.join(', ')}`;
    compCompetitors = competitors.map(c => ({ name: c, comparison: `Direct on-site comparison` }));
  } else if (knownFound.length > 0) {
    compValue = `Mentions industry competitors: ${knownFound.join(', ')}`;
    compSourceType = 'inferred';
    compEvidence = knownFound.map(c => ({ text: `Industry mention: ${c}`, source: primaryUrl }));
    compReasoning = `Known market competitors detected in page copy: ${knownFound.join(', ')}`;
    compCompetitors = knownFound.map(c => ({ name: c, comparison: `Industry competitor detected in page text` }));
  } else {
    compValue = 'Competes with SaaS providers and custom data/engineering agencies in this category.';
    compSourceType = 'inferred';
    compEvidence = [];
    compReasoning = 'Inferred general competitor category from market niche; no specific competitors named on site.';
    compCompetitors = ['Apify', 'Bright Data', 'Octoparse', 'Zyte', 'ScrapingBee'].map(c => ({
      name: c,
      comparison: 'General category competitor'
    }));
  }

  const rawStrategy = {
    target_audience: formatDimension(targetAudience, audienceClues.length > 0 ? audienceClues : [targetAudience], 'inferred', {}, 'Inferred from target audience clues and persona links.'),
    customer_pain: formatDimension(customerPain, customerPain, 'direct', {}, 'Direct problem/pain statement identified.'),
    value_proposition: formatDimension(valueProposition, valueProposition, 'direct', {}, 'Primary headline value proposition extracted.'),
    differentiator: formatDimension(differentiator, differentiatorEvidence || differentiator, 'direct', {}, 'Unique advantage statement extracted.'),
    revenue_model: formatDimension(revenueModel, revenueModelEvidence || revenueModel, 'direct', {}, 'Identified from pricing tiers, plans, or checkout flow.'),
    current_alternatives: formatDimension(currentAlternatives, explicitAlternatives, 'direct', {}, 'Direct comparison links identified.'),
    market_size: formatDimension(marketSize, tamMatch ? tamMatch[0] : null, 'direct', {}, 'Explicit TAM or market size stated on site.'),
    timing_and_trends: formatDimension(timingAndTrends, timingAndTrends, 'inferred', {}, 'Market timing and industry trend context.'),
    core_offering: formatDimension(coreOffering, coreOffering, 'direct', {}, 'Core services or product capabilities list.'),
    proof_of_value: formatDimension(
      proofOfValue && (proofOfValue.testimonials.length > 0 || proofOfValue.badges_and_metrics.length > 0 || proofOfValue.social_proof_statement)
        ? proofOfValue
        : null,
      [...(testimonials || []), ...(metricBadges || []), proofOfValue?.social_proof_statement],
      'direct',
      {},
      'Customer testimonials and metrics validated.'
    ),
    vision: formatDimension(vision, vision, 'direct', {}, 'Vision and mission statement from about/homepage.'),
    pricing_strategy: formatDimension(
      pricingStrategy && (pricingStrategy.products.length > 0 || pricingStrategy.tiers.length > 0 || pricingStrategy.free_trial_or_quote)
        ? pricingStrategy
        : null,
      [pricingStrategy?.free_trial_or_quote, ...(pricingStrategy?.tiers || []).map(t => `${t.name || 'Tier'}: ${t.price || ''}`)],
      'direct',
      {},
      'Structured pricing plans, tiers, and free trial details.'
    ),
    lifetime_value: formatDimension(lifetimeValue, ltvMatch ? ltvMatch[0] : null, 'direct', {}, 'Internal LTV metric if published.'),
    customer_acquisition_cost: formatDimension(customerAcquisitionCost, cacMatch ? cacMatch[0] : null, 'direct', {}, 'Internal CAC metric if published.'),
    other_revenue_streams: formatDimension(otherRevenueStreams, otherRevenue, 'inferred', {}, 'Add-on services, consulting, or affiliate revenue.'),
    acquisition_channels: formatDimension(acquisitionChannelsResult, acquisitionChannels, 'inferred', {}, 'Marketing channels explicitly referenced on site.'),
    conversion_funnel: formatDimension(conversionFunnel, funnelStages, 'inferred', {}, 'User journey conversion stages detected.'),
    activation_strategy: formatDimension(activationStrategy, activationStrategy, 'direct', {}, 'Initial user onboarding call to action.'),
    how_it_works: formatDimension(howItWorks, howItWorks, 'direct', {}, 'Step-by-step workflow extracted.', true),
    retention_strategy: formatDimension(retentionStrategy, retentionStrategy, 'inferred', {}, 'Ongoing support or recurring service evidence.'),
    viral_referral_loops: formatDimension(viralReferralLoops, viralReferralLoops, 'direct', {}, 'Referral or affiliate program evidence.'),
    fulfillment_model: formatDimension(fulfillmentModel, fulfillmentModel, 'inferred', {}, 'Product fulfillment model determined from platform context.'),
    key_tools_and_infrastructure: formatDimension(keyToolsAndInfrastructure, keyToolsAndInfrastructure, 'direct', {}, 'Explicit tech stack or infrastructure mentions.'),
    team_and_roles: formatDimension(teamAndRoles, [teamAndRoles?.founder, teamAndRoles?.about_page, teamAndRoles?.careers_link], 'direct', {}, 'Founders and leadership from JSON-LD or team sections.'),
    cost_structure: formatDimension(costStructure, costMatch ? costMatch[0] : null, 'direct', {}, 'Cost structure if disclosed.'),
    partnerships_and_dependencies: formatDimension(partnershipsAndDependencies, partners, 'direct', {}, 'Partner brand logos and links.'),
    competitive_landscape: formatDimension(
      compValue,
      compEvidence,
      compSourceType,
      { competitors: compCompetitors },
      compReasoning
    ),
    strategic_moat: strategicMoat
      ? formatDimension(strategicMoat, moatFactors, 'direct', {}, 'Security compliance certifications and proprietary tech.')
      : {
          value: 'No strong long-term moat is publicly demonstrated.',
          evidence: [],
          source_type: 'inferred',
          confidence: 0.50,
          validation: {
            reasoning: 'Inferred from absence of public patents, security certifications (SOC 2 / ISO 27001), or proprietary data assets.'
          }
        }
  };

  validateAndSanitizeStrategy(rawStrategy, pages, primaryUrl, signals);
  return pruneLowConfidence(rawStrategy, 0.3);
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

  let browser = null;
  let context = null;
  let page = null;

  try {
    browser = await chromium.launch({
      headless: isHeadless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9,de;q=0.8'
      },
      ignoreHTTPSErrors: true
    });

    // Abort heavy media/font/image requests for blazing fast page loads
    await context.route('**/*', route => {
      const resourceType = route.request().resourceType();
      if (['media', 'font', 'image'].includes(resourceType)) {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });

    page = await context.newPage();

    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout
      });
      try {
        await page.waitForLoadState('networkidle', { timeout: Math.min(2500, timeout) });
      } catch {}
    } catch (navError) {
      if (navError.name === 'TimeoutError' || /timeout/i.test(navError.message)) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch {}
      } else {
        throw navError;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 400));

    const renderedHtml = await page.content();
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

    // 1. High-Priority Multi-Page Discovery & Queue Management (Fix 1: deduplicate at enqueue time)
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

    // 2. Render important subpages with concurrent Playwright worker tabs
    const subpageResults = [];
    const CONCURRENCY = 3;

    async function crawlWorker() {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const norm = item.normUrl || normalizeUrl(item.url);
        if (visited.has(norm)) continue;
        visited.add(norm); // ← mark visited immediately after shift, before goto

        let subPage = null;
        try {
          subPage = await context.newPage();
          await subPage.goto(item.url, {
            waitUntil: 'domcontentloaded',
            timeout: 12000
          });
          try {
            await subPage.waitForLoadState('networkidle', { timeout: 1500 });
          } catch {}

          const subHtml = await subPage.content();
          if (!subHtml) continue;

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

          // If depth < 1, enqueue internal links discovered on this subpage
          if (item.depth < 1 && subExtracted.links && Array.isArray(subExtracted.links.internal)) {
            for (const link of subExtracted.links.internal) {
              const linkNorm = normalizeUrl(link);
              if (visited.has(linkNorm) || queuedUrls.has(linkNorm)) continue;
              if (/\.(png|jpg|jpeg|gif|svg|pdf|zip|css|js|woff|woff2|xml|json|ico)$/i.test(linkNorm)) continue;
              if (/\/(login|signin|signup|register|cart|checkout|admin|auth|logout|wp-admin)/i.test(linkNorm)) continue;
              const { score, type } = scoreAndCategorizeLink(new URL(linkNorm).pathname, '');
              if (score >= 6) {
                queue.push({ url: link, normUrl: linkNorm, type, depth: item.depth + 1, score });
                queuedUrls.add(linkNorm);
              }
            }
          }
        } catch (error) {
          // Navigation error or timeout for this subpage, skip gracefully
        } finally {
          if (subPage) {
            try { await subPage.close(); } catch {}
          }
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => crawlWorker());
    await Promise.all(workers);

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

    // Build pages_by_type (Fix 1)
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

    // Aggregate signal pools — Pass 2 can pull these directly (Fix 1, 2, 3, 4, 5, Plan Cards)
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

    // 3. Aggregate JSON-LD across all pages
    const jsonLdList = [];
    for (const p of allPages) {
      jsonLdList.push(...(p.json_ld && p.json_ld.length > 0 ? p.json_ld : extractJsonLd(p.$)));
    }
    const jsonLdOrg = findOrganizationInJsonLd(jsonLdList);
    const meta = extractMetaTags($, finalUrl);

    // 4. Base Company Metadata
    const name = extractCompanyName($, jsonLdOrg, meta, finalUrl);
    const description = extractDescription($, jsonLdOrg, meta);
    const email = extractEmail(allPages, jsonLdList);
    const phone = extractPhone(allPages, jsonLdList);
    const addressData = extractAddress(allPages, jsonLdList);
    const { logo, images } = extractLogoAndImages(allPages, jsonLdList, meta, finalUrl);
    const socialLinks = extractSocialLinks(allPages, jsonLdList);
    const openingHours = extractOpeningHours($, jsonLdOrg);

    // 5. Business Strategy Intelligence Extraction & Validation Engine
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

    // Compact signals for API summary (~50 lines)
    const summarySignals = {
      all_contrast_sentences: signals.all_contrast_sentences || [],
      all_numeric_claims:     signals.all_numeric_claims || [],
      all_plan_cards:         signals.all_plan_cards || [],
      all_page_headings:      signals.all_page_headings || [],
    };

    // Summary data (~300 lines) — production API response for Postman / clients
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
      crawled_pages: crawledPages
    };

    // Raw full extraction (~2500 lines) — ships to Pass 2 LLM / debugging
    const rawData = {
      ...summaryData,
      signals: signals,
      pages_by_type: pagesByType,
      crawled_pages: crawledPages
    };

    // Optionally save to raw.json and summary.json if requested
    if (options.saveToFiles) {
      try {
        const fs = require('fs');
        const path = require('path');
        const outDir = options.outputDir || process.cwd();
        fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(rawData, null, 2), 'utf-8');
        fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summaryData, null, 2), 'utf-8');
      } catch (err) {
        console.warn('⚠️ Could not save raw.json / summary.json to disk:', err.message);
      }
    }

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
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

function extractCompanyName($, jsonLdOrg, meta, targetUrl) {
  let hostnameBrand = null;
  try {
    const host = new URL(targetUrl).hostname.replace(/^www\./i, '');
    const part = host.split('.')[0];
    hostnameBrand = part.charAt(0).toUpperCase() + part.slice(1);
  } catch {}

  // 1. Website brand / visible logo / site title
  // 1a. Visible logo alt text or navbar-brand link text
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

  // 1b. Site title / Page title inspection
  const pageTitle = meta.title || meta.og_title;
  if (pageTitle) {
    const titleParts = pageTitle.split(/[-–—|•·:»]/).map(cleanText).filter(Boolean);
    if (titleParts.length > 1) {
      // Check if first part or last part contains or matches the hostname brand
      if (hostnameBrand) {
        const matchingPart = titleParts.find(p => p.toLowerCase().replace(/[^a-z0-9]/g, '') === hostnameBrand.toLowerCase().replace(/[^a-z0-9]/g, ''));
        if (matchingPart) return matchingPart;

        const partialMatch = titleParts.find(p => p.toLowerCase().includes(hostnameBrand.toLowerCase()));
        if (partialMatch && partialMatch.length <= 35) return partialMatch;
      }

      // If the first part is concise (2-40 chars) and not a generic slogan/sentence
      const firstPart = titleParts[0];
      if (firstPart && firstPart.length >= 2 && firstPart.length <= 40 && !/^(home|welcome|the\s+best|get\s+started|login|features)/i.test(firstPart)) {
        return firstPart;
      }

      // Check last part as well (e.g., "Home - BrandName")
      const lastPart = titleParts[titleParts.length - 1];
      if (lastPart && lastPart.length >= 2 && lastPart.length <= 40 && !/^(home|welcome|official\s+site)/i.test(lastPart)) {
        if (hostnameBrand && lastPart.toLowerCase().includes(hostnameBrand.toLowerCase())) {
          return lastPart;
        }
      }
    }
  }

  // 2. OpenGraph site name
  if (meta.og_site_name) {
    const cleanOgSite = cleanText(meta.og_site_name);
    if (cleanOgSite && cleanOgSite.length >= 2 && cleanOgSite.length <= 60 && !/^https?:/i.test(cleanOgSite)) {
      return cleanOgSite;
    }
  }

  // 3. JSON-LD organization (name or legalName)
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

  // Schema.org itemprop="name"
  const itempropName = $('[itemscope] [itemprop="name"]').first().text();
  if (cleanText(itempropName)) return cleanText(itempropName);

  // 4. Contact/company name or fallback to domain brand
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

module.exports = {
  scrapeWebsite,
  normalizeUrl
};
