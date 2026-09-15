/**
 * Page-level feature & signal extractors (Pass 1)
 */

function clean(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupe(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map(x => (typeof x === 'string' ? clean(x) : x)).filter(Boolean))];
}

function uniqFlat(arr, fn) {
  if (!Array.isArray(arr)) return [];
  const items = arr.flatMap(fn).filter(Boolean);
  return dedupe(items);
}

function dedupePrefixes(items) {
  if (!Array.isArray(items)) return [];
  const cleanedItems = dedupe(items);
  const sorted = [...cleanedItems].sort((a, b) => b.length - a.length);
  const kept = [];
  for (const item of sorted) {
    if (!kept.some(k => k.startsWith(item) && k.length > item.length)) {
      kept.push(item);
    }
  }
  return cleanedItems.filter(item => kept.includes(item));
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

function extractJsonLd($) {
  if (!$) return [];
  const jsonLdData = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text().trim();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        jsonLdData.push(...parsed);
      } else if (parsed && parsed['@graph'] && Array.isArray(parsed['@graph'])) {
        jsonLdData.push(...parsed['@graph']);
      } else if (parsed) {
        jsonLdData.push(parsed);
      }
    } catch {}
  });
  return jsonLdData;
}

function getPageHeading($, siteName, title) {
  const h1 = clean($('h1').first().text());
  const isJunkH1 = !h1 || h1.length < 6 || (siteName && h1.toLowerCase().trim() === siteName.toLowerCase().trim());
  if (!isJunkH1) return h1;

  const h2 = $('h2')
    .map((_, el) => clean($(el).text()))
    .get()
    .find(t => t.length > 5 && (!siteName || t.toLowerCase().trim() !== siteName.toLowerCase().trim()));

  return h2 || h1 || title || null;
}

function extractPlanCards($, $content) {
  const cardSelectors = [
    '[class*="pricing-card" i]',
    '[class*="price-card" i]',
    '[class*="plan-card" i]',
    '[class*="package-card" i]',
    '[class*="tier-card" i]',
    '[class*="subscription-card" i]',
    '[class*="pricing-box" i]',
    '[class*="price-box" i]',
    '[class*="plan-box" i]',
    '[class*="pricing-item" i]',
    '[class*="plan-item" i]',
    '[class*="tier" i]',
    '[class*="pricing" i]',
    '[class*="package" i]',
    '[class*="subscription" i]',
    '.card'
  ];

  const candidates = [];
  const seenEls = new Set();

  for (const sel of cardSelectors) {
    $content.find(sel).each((_, el) => {
      if (seenEls.has(el)) return;
      seenEls.add(el);

      const $el = $(el);
      const text = clean($el.text());
      if (!text || text.length < 20 || text.length > 2000) return;

      const hasRealPrice = /(?:\$|€|£|₹)\s?\d+|\b\d+\s*(?:usd|eur|inr|gbp)\b/i.test(text);
      const hasTierName = /\b(?:basic|starter|pro(?:fessional)?|premium|advanced|enterprise|free\s*(?:tier|plan|trial)|monthly\s*(?:rental|plan|subscription)|annual\s*(?:rental|plan|subscription)|yearly\s*(?:rental|plan|subscription))\b/i.test(text);
      const mentionsFree = /\bfree\b/i.test(text);

      if (!hasRealPrice && !(mentionsFree && hasTierName)) return;

      const features = $el
        .find('li, [class*="feature" i]')
        .map((_, f) => clean($(f).text()))
        .get()
        .filter(t => t.length > 2 && t.length < 200);

      const rawName = clean(
        $el.find('h1, h2, h3, h4, h5, [class*="title" i], [class*="name" i], [class*="header" i], strong').first().text()
      );
      const name = rawName || null;

      // Reject generic headings that are not plan names
      if (name && /^(?:what\s+|how\s+|why\s+|choose\s+|our\s+services|built\s+for|welcome|pricing\s+plans?|all\s+plans?|simple[,\s]+transparent|.*scraper\s+pricing)/i.test(name)) {
        return;
      }

      const priceMatch = text.match(/(?:[\$€£₹]\s*\d+[\d,]*(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|year|yr|user|seat|call))?|\b\d+[\d,]*(?:\.\d{2})?\s*(?:USD|EUR|GBP|INR)\s*(?:\/\s*(?:mo|month|year|yr))?|free\s*trial|free)/i);
      const price = priceMatch ? clean(priceMatch[0]) : null;

      // Require at least one strong plan signal
      const strongSignal =
        (name && price) ||
        (name && features.length >= 2) ||
        (features.length >= 2 && price);

      if (!strongSignal) return;

      candidates.push({
        el,
        $el,
        name,
        price,
        features: dedupe(features),
        raw_text: text.slice(0, 500)
      });
    });
  }

  // DOM containment filter: discard outer containers that contain other valid card candidates
  const leafCandidates = candidates.filter(cand => {
    const isParentOfAnother = candidates.some(other => other.el !== cand.el && cand.$el.find(other.el).length > 0);
    return !isParentOfAnother;
  });

  const cards = [];
  const seenKeys = new Set();
  for (const c of leafCandidates) {
    const key = `${(c.name || '').toLowerCase()}::${(c.price || '').toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    cards.push({
      name: c.name,
      price: c.price,
      features: c.features,
      raw_text: c.raw_text
    });
  }

  return cards.filter(c => c.name || (c.price && c.features.length >= 1));
}

/**
 * Extracts structured sections, paragraphs, list items, and signals from a single page Cheerio DOM.
 */
function extractPage($, url, pageType = 'other') {
  if (!$) {
    return {
      url: url || '',
      title: null,
      page_heading: null,
      page_type: pageType,
      sections: [],
      paragraphs: [],
      list_items: [],
      ordered_steps: [],
      step_patterns: [],
      numbered_items: [],
      how_it_works_steps: [],
      contrast_sentences: [],
      numeric_claims: [],
      plan_cards: [],
      links: { internal: [], external: [] },
      json_ld: [],
      text: ''
    };
  }

  const title = clean($('title').first().text()) || null;
  const siteName = (title || '').split(/[|\-–:]/)[0].trim();
  const pageHeading = getPageHeading($, siteName, title);

  // Fix A: Extract main content scope minus nav / header / footer junk
  let $content = $('main');
  if (!$content.length) $content = $('article');
  if (!$content.length) {
    $content = $('body').clone();
    $content.find('header, nav, footer, .navbar, .footer, .breadcrumb, .sidebar, script, style, noscript, svg, iframe, template').remove();
  } else {
    $content = $content.clone();
    $content.find('script, style, noscript, svg, iframe, template').remove();
  }

  const bodyText = clean($('body').text());
  const contentText = clean($content.text()) || bodyText;

  // Paragraphs (scoped to content area)
  const paragraphs = dedupe(
    $content
      .find('p')
      .map((_, el) => clean($(el).text()))
      .get()
      .filter(t => t.length > 20)
  );

  // List items (scoped to content area, ignoring nav menus)
  const listItems = dedupe(
    $content
      .find('ul > li')
      .map((_, el) => clean($(el).text()))
      .get()
      .filter(t => t.length > 5 && t.length < 300)
  );

  // Heading-anchored sections
  const sections = [];
  $content.find('section, article, div[class*="section" i], div[class*="container" i], div[class*="block" i]').each((_, el) => {
    const heading = clean($(el).find('h1, h2, h3, h4').first().text());
    const text = clean($(el).text());
    if (text && text.length > 30 && text.length < 3500) {
      if (!sections.some(s => s.text === text)) {
        sections.push({
          heading: heading || null,
          text: text
        });
      }
    }
  });

  // Extract internal and external links (from entire page)
  const internalLinks = [];
  const externalLinks = [];
  try {
    const baseObj = new URL(url || 'https://example.com');
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const res = resolveUrl(href, url || baseObj.href);
      if (!res) return;
      try {
        const u = new URL(res);
        if (u.hostname === baseObj.hostname) {
          internalLinks.push(res);
        } else if (/^https?:/i.test(u.protocol)) {
          externalLinks.push(res);
        }
      } catch {}
    });
  } catch {}

  // ---- Fix 3: better numeric claim filter ----
  const numericClaims = [];
  const NUM_RE = /(?:^|[^\d])([\d,]+(?:\+|\s*%)?)\s*(clients?|customers?|users?|websites?|sites?|countries|projects?|scrapers?|records?|data points?|businesses?|companies|industries|listings?|products?|tools?|apps?|integrations?|actors?|members?|partners?|years?)\b/gi;
  let nm;
  while ((nm = NUM_RE.exec(bodyText)) !== null) {
    const num = nm[1].trim(), word = nm[2].trim();
    const n = parseInt(num.replace(/[^\d]/g, ''), 10);
    if (isNaN(n)) continue;
    const hasPlus = /\+/.test(num) || /,/.test(num);
    const claim = `${num} ${word}`;
    if (hasPlus && n >= 50) numericClaims.push(claim);
    else if (/s$/.test(word) && n >= 100) numericClaims.push(claim);
  }

  // ---- Fix 4: better contrast extraction with sentence expansion ----
  const contrastSentences = [];
  const CONTRAST_RE = /(?:unlike|instead of|rather than|traditional(?:ly)?|no more|no longer|forget about|compared to|as opposed to)\s+[^.!?]{5,250}/gi;
  const frags = [];
  let cm;
  while ((cm = CONTRAST_RE.exec(bodyText)) !== null) frags.push(cm[0]);
  for (const frag of frags) {
    const idx = bodyText.indexOf(frag);
    if (idx === -1) { contrastSentences.push(clean(frag)); continue; }
    const before = bodyText.lastIndexOf('.', idx);
    const after  = bodyText.indexOf('.', idx + frag.length);
    const start = before === -1 ? Math.max(0, idx - 200) : before + 1;
    const end   = after === -1 ? Math.min(bodyText.length, idx + 400) : after + 1;
    contrastSentences.push(clean(bodyText.slice(start, end)));
  }

  // ---- Fix 2 & Fix C: numbered steps with prefix deduplication ----
  const rawNumbered = dedupe(
    $content
      .find('h1, h2, h3, h4, p, div, li')
      .map((_, el) => {
        const clone = $(el).clone();
        clone.find('br, p, div, h1, h2, h3, h4, h5, h6, li, span').after(' ');
        const t = clean(clone.text());
        return /^\s*\d{1,2}[.)\s-]\s*\S/.test(t) && t.length > 10 && t.length < 300 ? t : null;
      })
      .get()
      .filter(Boolean)
  );
  const numberedItems = dedupePrefixes(rawNumbered);

  const howItWorksSteps = [];
  $content.find('h1, h2, h3, h4').each((_, h) => {
    const headingText = clean($(h).text());
    if (!/how it works|our process|steps|workflow|how we work/i.test(headingText)) return;
    let node = $(h).next();
    let count = 0;
    while (node.length && count < 15) {
      const tag = (node.prop('tagName') || '').toUpperCase();
      if (/^H[1-4]$/.test(tag)) break;

      const childCards = node.find('li, [class*="step" i], [class*="item" i], [class*="card" i], div, p');
      if (childCards.length >= 2) {
        childCards.each((__, child) => {
          const clone = $(child).clone();
          clone.find('br, p, div, h1, h2, h3, h4, h5, h6, li, span').after(' ');
          const t = clean(clone.text());
          if (t.length > 10 && t.length < 350 && !howItWorksSteps.includes(t)) {
            howItWorksSteps.push(t);
            count++;
          }
        });
      } else {
        const clone = node.clone();
        clone.find('br, p, div, h1, h2, h3, h4, h5, h6, li, span').after(' ');
        const t = clean(clone.text());
        if (t.length > 10 && t.length < 400 && !howItWorksSteps.includes(t)) {
          howItWorksSteps.push(t);
          count++;
        }
      }
      node = node.next();
    }
  });

  // Ordered lists specifically (How it works / Step 1-2-3)
  const orderedSteps = [];
  $content.find('ol').each((_, ol) => {
    const items = $(ol)
      .find('li')
      .map((_, li) => clean($(li).text()))
      .get()
      .filter(Boolean);
    if (items.length >= 2 && items.length <= 10) {
      orderedSteps.push(items);
    }
  });

  // Numbered-step class divs (modern UIs)
  const stepPatterns = dedupe(
    $content
      .find('[class*="step" i], [class*="process" i], [class*="how-" i]')
      .map((_, el) => clean($(el).text()))
      .get()
      .filter(t => t.length > 15 && t.length < 400)
  );

  // Fix B: Structured plan cards
  const planCards = extractPlanCards($, $content);

  const jsonLd = extractJsonLd($);

  return {
    url: url || '',
    title,
    page_heading: pageHeading,
    page_type: pageType,
    sections,
    paragraphs,
    list_items: listItems,
    ordered_steps: orderedSteps,
    step_patterns: stepPatterns,
    numbered_items: numberedItems,
    how_it_works_steps: dedupe(howItWorksSteps),
    contrast_sentences: dedupe(contrastSentences),
    numeric_claims: dedupe(numericClaims),
    plan_cards: planCards,
    links: { internal: dedupe(internalLinks), external: dedupe(externalLinks) },
    json_ld: jsonLd,
    content_text: contentText,
    text: bodyText
  };
}

module.exports = {
  clean,
  dedupe,
  uniqFlat,
  dedupePrefixes,
  extractJsonLd,
  getPageHeading,
  extractPlanCards,
  extractPage
};
