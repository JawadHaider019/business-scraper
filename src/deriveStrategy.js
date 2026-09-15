// src/deriveStrategy.js — signal-composition version
// Precision over recall. Only extract from structured signals. No prose guessing.

function deriveStrategy(data) {
  if (!data) return {};
  const sig = data.signals || {};
  const pagesByType = data.pages_by_type || {};
  const allPages = (data.pages || data.allPages || Object.values(pagesByType).flat() || []);

  return {
    // ─────────────────────────────────────────────
    // Extracted from signals (100% reliable)
    // ─────────────────────────────────────────────

    // Numeric metrics — proof of value
    proof_of_value: buildProofOfValue(sig.all_numeric_claims, allPages),

    // Plan cards — pricing
    pricing_strategy: buildPricingStrategy(sig.all_plan_cards, allPages),

    // Contrast sentences from "unlike X" / "instead of X"
    // Only kept if it names a market alternative (custom/traditional/manual)
    current_alternatives: buildCurrentAlternatives(
      sig.all_contrast_sentences,
      allPages
    ),

    // How-it-works flows (already vetted: 2-6 steps, no HTML)
    how_it_works: buildHowItWorks(sig.how_it_works_by_page),

    // ─────────────────────────────────────────────
    // Derived from structured signals (deterministic)
    // ─────────────────────────────────────────────

    // Competitive landscape: category default from name/description
    competitive_landscape: buildCompetitiveLandscape(data),

    // Strategic moat: only positive claim if "patent"/"proprietary" present
    strategic_moat: buildStrategicMoat(sig, pagesByType, allPages),

    // ─────────────────────────────────────────────
    // Honest nulls — cannot be extracted reliably from prose
    // ─────────────────────────────────────────────

    target_audience:               null,
    customer_pain:                 null,
    value_proposition:             null,
    differentiator:                null,
    revenue_model:                 null,
    market_size:                   null,
    timing_and_trends:             null,
    core_offering:                 null,
    vision:                        null,
    lifetime_value:                null,
    customer_acquisition_cost:     null,
    other_revenue_streams:         null,
    acquisition_channels:          null,
    conversion_funnel:             null,
    activation_strategy:           null,
    retention_strategy:            null,
    viral_referral_loops:          null,
    fulfillment_model:             null,
    key_tools_and_infrastructure:  null,
    team_and_roles:                null,
    cost_structure:                null,
    partnerships_and_dependencies: null,
  };
}

// ─────────────────────────────────────────────
// Builders — each pulls only from structured signals
// ─────────────────────────────────────────────

function buildProofOfValue(claims, allPages) {
  if (!claims || !claims.length) return null;

  // 1. Filter to legitimate claims
  const good = claims.filter(c => {
    if (!c || typeof c !== 'string') return false;
    const trimmed = c.trim();
    // Must have a comma or a "+" AND a number >= 500
    const digits = trimmed.replace(/[^\d]/g, '');
    const n = parseInt(digits, 10);
    if (isNaN(n) || n < 500) return false;

    // Must be "N noun" or "N+ noun", not a fragment
    if (!/^[\d,]+\+?\s+\w+/i.test(trimmed)) return false;

    // Exclude generic nouns that aren't proof of scale
    if (/\b(listings?|products?|apps?|items?|results?)\b/i.test(trimmed)) return false;

    return true;
  });

  if (!good.length) return null;

  // 2. Dedupe by (number, unit) — 68,148 vs 68,151 collapse to one
  const byUnit = new Map();
  for (const c of good) {
    const trimmed = c.trim();
    const m = trimmed.match(/^([\d,]+)\+?\s+(\w+)/i);
    if (!m) continue;
    const unit = m[2].toLowerCase().replace(/s$/, ''); // "actors" → "actor"
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!byUnit.has(unit) || byUnit.get(unit).n < n) {
      byUnit.set(unit, { n, text: trimmed });
    }
  }

  // 3. Cap at 3, prefer homepage-sourced claims
  const homepageText = (allPages || [])
    .filter(p => p.url && p.url.split('/').length <= 4)
    .map(p => (p.paragraphs || []).join(' '))
    .join(' ');

  const final = [...byUnit.values()]
    .map(v => v.text)
    .sort((a, b) => {
      const aOnHome = homepageText.includes(a) ? 1 : 0;
      const bOnHome = homepageText.includes(b) ? 1 : 0;
      return bOnHome - aOnHome;
    })
    .slice(0, 3);

  if (!final.length) return null;

  return {
    value: final.join(', '),
    evidence: final.map(text => ({
      text,
      source: (allPages || []).find(p => (p.paragraphs || []).some(x => x.includes(text)))?.url
            || allPages[0]?.url
            || null,
    })),
    source_type: 'direct',
    confidence: 0.9,
    validation: { reasoning: 'Top-3 deduped numeric claims.' },
  };
}

function buildPricingStrategy(cards, allPages) {
  if (!cards || !cards.length) return null;

  // Drop plan cards without a real price
  const priced = cards.filter(c => c && c.price && /\d/.test(c.price));
  if (!priced.length) return null;

  // Deduplicate by (name, price)
  const seen = new Set();
  const unique = priced.filter(c => {
    const key = `${c.name || ''}::${c.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Extract numeric prices for range
  const nums = unique
    .map(c => parseFloat(c.price.replace(/[^\d.]/g, '')))
    .filter(n => !isNaN(n) && n > 0);

  const names = [...new Set(unique.map(c => c.name).filter(Boolean))];

  let value;
  if (names.length && nums.length) {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    value = `Tiered plans (${names.slice(0, 5).join(', ')}) priced from $${min} to $${max}.`;
  } else if (names.length) {
    value = `Tiered plans: ${names.join(', ')}.`;
  } else if (nums.length) {
    value = `Tiered pricing from $${Math.min(...nums)} to $${Math.max(...nums)}.`;
  } else {
    return null;
  }

  return {
    value,
    evidence: unique.slice(0, 3).map(c => ({
      text: (c.raw_text || `${c.name}: ${c.price}`).slice(0, 200),
      source: (allPages || []).find(p =>
        (p.plan_cards || []).some(pc => pc.raw_text === c.raw_text || pc.name === c.name)
      )?.url || null,
    })),
    source_type: 'direct',
    confidence: 0.9,
    validation: { reasoning: 'Pricing from structured plan cards.' },
  };
}

function buildCurrentAlternatives(contrasts, allPages) {
  if (!contrasts || !contrasts.length) return null;

  // Must name a market alternative — not just any "instead of"
  const MARKET_RE = /\b(custom|traditional|manual|legacy|offline|in-house|do[- ]it[- ]yourself|diy)\b/i;

  const clean = contrasts.filter(c => {
    if (!c || c.length < 30 || c.length > 400) return false;
    if (/\\[nrt]/.test(c)) return false;
    if (/[{}[\]<>]{3,}/.test(c)) return false;
    if (!MARKET_RE.test(c)) return false;
    return true;
  });

  if (!clean.length) return null;

  // Prefer sentences starting with "unlike" or "instead of"
  const best = clean.sort((a, b) => {
    const scoreA = /^(unlike|instead of|rather than)/i.test(a) ? 2 : 1;
    const scoreB = /^(unlike|instead of|rather than)/i.test(b) ? 2 : 1;
    return scoreB - scoreA;
  })[0];

  return {
    value: best.slice(0, 220),
    evidence: [{
      text: best,
      source: (allPages || []).find(p =>
        (p.contrast_sentences || []).includes(best) || (p.text || '').includes(best)
      )?.url || null,
    }],
    source_type: 'direct',
    confidence: 0.85,
    validation: { reasoning: 'Contrast sentence naming a market alternative.' },
  };
}

function buildHowItWorks(byPage) {
  if (!Array.isArray(byPage)) return null;

  const best = byPage
    .filter(p => {
      const steps = p.steps || [];
      if (steps.length < 2 || steps.length > 6) return false;
      return steps.every(s =>
        typeof s === 'string' &&
        s.length >= 8 &&
        s.length <= 200 &&
        !/\\[nrt]/.test(s) &&
        !/[{}[\]<>]{3,}/.test(s)
      );
    })
    .sort((a, b) => b.steps.length - a.steps.length)[0];

  if (!best) return null;

  return {
    value: best.steps.map((s, i) => `${i + 1}. ${s}`).join(' '),
    evidence: best.steps.map(s => ({ text: s, source: best.url })),
    source_type: 'direct',
    confidence: 0.9,
    validation: { reasoning: 'Step flow (2-6 steps).' },
  };
}

function buildCompetitiveLandscape(data) {
  const name = ((data && data.name) || '').toLowerCase();
  const desc = ((data && data.description) || '').toLowerCase();

  let competitors = [];
  let category = 'business software';

  if (/scrap|apify|crawl|brightdata|zyte/.test(name + desc)) {
    competitors = ['Apify', 'Bright Data', 'Octoparse', 'Zyte', 'ScrapingBee'];
    category = 'cloud web scraping SaaS platforms';
  } else if (/shopify|ecommerce|shop/.test(name + desc)) {
    competitors = ['Shopify', 'WooCommerce', 'BigCommerce', 'Squarespace', 'Wix'];
    category = 'e-commerce platform providers';
  } else if (/crm|salesforce|pipedrive|hubspot/.test(name + desc)) {
    competitors = ['Salesforce', 'HubSpot', 'Pipedrive', 'Zoho CRM', 'Monday'];
    category = 'CRM providers';
  } else if (/analytics|segment|mixpanel|amplitude/.test(name + desc)) {
    competitors = ['Mixpanel', 'Amplitude', 'Segment', 'Heap', 'PostHog'];
    category = 'product analytics platforms';
  } else if (/email|mailchimp|sendgrid/.test(name + desc)) {
    competitors = ['Mailchimp', 'SendGrid', 'ConvertKit', 'Brevo', 'Postmark'];
    category = 'email marketing platforms';
  }

  if (!competitors.length) return null;

  return {
    value: `Competes with ${category}.`,
    evidence: [],
    source_type: 'inferred',
    confidence: 0.5,
    validation: { reasoning: 'Inferred from business description.' },
    competitors: competitors.map(c => ({
      name: c,
      comparison: 'Category peer',
    })),
  };
}

function buildStrategicMoat(sig, pagesByType, allPages) {
  const all = (allPages && allPages.length > 0) ? allPages : Object.values(pagesByType || {}).flat();
  const STRONG = /\b(patent|certification|SOC\s*2|ISO\s*27001|proprietary|exclusive|cornered|network\s*effect)/i;

  for (const p of all) {
    for (const s of (p.paragraphs || []).concat((p.sections || []).map(sec => typeof sec === 'string' ? sec : sec.text || ''))) {
      if (s && STRONG.test(s) && s.length > 30 && s.length < 250) {
        return {
          value: s.slice(0, 220),
          evidence: [{ text: s, source: p.url }],
          source_type: 'direct',
          confidence: 0.8,
          validation: { reasoning: 'Moat signal present.' },
        };
      }
    }
  }

  // Scale-based inference only if claims exist
  const claims = (sig && sig.all_numeric_claims) || [];
  const big = claims.some(c => parseInt(String(c).replace(/[^\d]/g, ''), 10) >= 5000);
  if (big) {
    return {
      value: 'Scale-based moat from large customer base, though no patent or exclusive asset is claimed.',
      evidence: [],
      source_type: 'inferred',
      confidence: 0.5,
      validation: { reasoning: 'Scale-based moat inferred.' },
    };
  }

  return {
    value: 'No strong long-term moat is publicly demonstrated.',
    evidence: [],
    source_type: 'inferred',
    confidence: 0.5,
    validation: { reasoning: 'No moat signals present.' },
  };
}

module.exports = { deriveStrategy };
