// src/deriveStrategy.js — deterministic business_strategy extraction
// Precision over recall. Only extract from structured signals.

function deriveStrategy(data) {
  if (!data) return {};
  const sig = data.signals || {};
  const pagesByType = data.pages_by_type || {};
  const allPages = (data.pages || data.allPages || Object.values(pagesByType).flat() || []);

  return {
    proof_of_value: buildProofOfValue(sig.all_numeric_claims, allPages),
    pricing_strategy: buildPricingStrategy(sig.all_plan_cards, allPages),
    current_alternatives: buildCurrentAlternatives(sig.all_contrast_sentences, allPages),
    how_it_works: buildHowItWorks(sig.how_it_works_by_page, pagesByType),
    competitive_landscape: buildCompetitiveLandscape(data),
    strategic_moat: buildStrategicMoat(sig, pagesByType, allPages),

    // Honest null — requires AI to extract
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

function buildProofOfValue(claims, allPages) {
  if (!claims || !claims.length) return null;

  const good = claims.filter(c => {
    if (!c || typeof c !== 'string') return false;
    const trimmed = c.trim();
    const digits = trimmed.replace(/[^\d]/g, '');
    const n = parseInt(digits, 10);
    if (isNaN(n) || n < 500) return false;
    if (!/^[\d,]+\+?\s+\w+/i.test(trimmed)) return false;
    if (/\b(listings?|products?|apps?|items?|results?)\b/i.test(trimmed)) return false;
    return true;
  });

  if (!good.length) return null;

  const byUnit = new Map();
  for (const c of good) {
    const trimmed = c.trim();
    const m = trimmed.match(/^([\d,]+)\+?\s+(\w+)/i);
    if (!m) continue;
    const unit = m[2].toLowerCase().replace(/s$/, '');
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!byUnit.has(unit) || byUnit.get(unit).n < n) {
      byUnit.set(unit, { n, text: trimmed });
    }
  }

  const homepageText = (allPages || [])
    .filter(p => p.url && p.url.split('/').length <= 4)
    .map(p => (p.paragraphs || []).join(' '))
    .join(' ');

  const final = [...byUnit.values()]
    .map(v => v.text)
    .sort((a, b) => (homepageText.includes(b) ? 1 : 0) - (homepageText.includes(a) ? 1 : 0))
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

  const priced = cards.filter(c => c && c.price && /\d/.test(c.price));
  if (!priced.length) return null;

  const seen = new Set();
  const unique = priced.filter(c => {
    const key = `${c.name || ''}::${c.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const nums = unique
    .map(c => parseFloat(c.price.replace(/[^\d.]/g, '')))
    .filter(n => !isNaN(n) && n > 0);

  const names = [...new Set(unique.map(c => c.name).filter(Boolean))];

  let value;
  if (names.length && nums.length) {
    value = `Tiered plans (${names.slice(0, 5).join(', ')}) priced from $${Math.min(...nums)} to $${Math.max(...nums)}.`;
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

function isCleanText(text) {
  if (!text || text.length < 20 || text.length > 500) return false;
  if (/\\u00[0-9a-f]{2}/i.test(text)) return false;
  if (/<[a-z][^>]*>/i.test(text)) return false;
  if (/\{\s*\\?"[a-z]+\\?":/.test(text)) return false;
  if (/[{}[\]<>]{3,}/.test(text)) return false;
  if (/\\[nrt]/.test(text)) return false;

  if (/\bvar\s+\w+\s*=|\bconst\s+\w+\s*=|\blet\s+\w+\s*=/.test(text)) return false;
  if (/function\s*\(/.test(text)) return false;
  if (/\b(addEventListener|querySelector|preventDefault|matchMedia|JSON\.parse|=>)/.test(text)) return false;
  if (/[""]/.test(text) && /[:;{}]/.test(text) && text.length > 100) return false;
  if (/"@type"|"_type"|"_key"|"@context"|"acceptedAnswer"/i.test(text)) return false;

  if (/[A-Z]{4,}\d{3,}/.test(text)) return false;
  if (/[a-z]\.[A-Z]/.test(text)) return false;
  if (/\b(we('|')?ve been using|we selected|we chose|we picked|we started using)\b/i.test(text)) return false;
  if ((text.match(/[""]/g) || []).length >= 4) return false;

  return true;
}

function stripLeadingQuestion(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/^[A-Z][^?]{5,80}\?\s*/);
  return m ? text.slice(m[0].length) : text;
}

function buildCurrentAlternatives(contrasts, allPages = []) {
  if (!contrasts || !contrasts.length) return null;

  const clean = contrasts
    .map(stripLeadingQuestion)
    .filter(isCleanText)
    .filter(c => {
      if (/^(this|the)\s+(article|post|blog|page|guide|report)\s+(explains|covers|describes|discusses|explores)/i.test(c)) return false;
      if (/\b(learn|read|discover)\s+(more|how|why|what)\b/i.test(c) && c.length < 200) return false;
      if (/^\d/.test(c)) return false;
      if (/^(and|but|or|so|by|with|to|for)\s/i.test(c)) return false;
      if (c.split(/\s+/).filter(Boolean).length < 8) return false;
      if (!/^[A-Z]/.test(c)) return false;
      return true;
    })
    .filter(c => /\b(custom|traditional|manual|legacy|offline|in-house|batch|scheduled|do[- ]it[- ]yourself|diy)\b/i.test(c));

  if (!clean.length) return null;

  const pick = clean.find(c => /\binstead of\b|\bon traditional\b|\bunlike\b/i.test(c)) || clean[0];
  const source = (allPages || []).find(p => (p.contrast_sentences || []).some(cs => cs.includes(pick)) || (p.text || '').includes(pick))?.url || null;

  return {
    value: pick.slice(0, 220),
    evidence: [{ text: pick, source }],
    source_type: 'direct',
    confidence: 0.85,
    validation: { reasoning: 'Clean contrast sentence.' },
  };
}

function looksLikeStep(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.length < 20 || s.length > 200) return false;
  if (/\\[nrt]/.test(s) || /[{}[\]<>]{3,}/.test(s)) return false;
  if (/^[A-Z][a-z]+\s+[A-Z][a-z]+\s+(ML|AI|CEO|CTO|Engineer|Manager|Founder|Head|VP|Lead)/i.test(s)) return false;
  if (/^(talk to|contact us|book a|get started|try it|learn more|see how|start)/i.test(s)) return false;
  if (/^(the|a|an)\s/i.test(s) && s.split(' ').length < 5) return false;
  if (!/\b(click|add|select|enter|configure|connect|upload|create|run|start|choose|specify|define|log in|sign up|open|download|export|receive|send|set|enable|deploy|publish|invite|integrate|tell)\b/i.test(s)
      && !/^\d+\./.test(s)) return false;
  return true;
}

function buildHowItWorks(byPage, pagesByType = {}) {
  if (!Array.isArray(byPage)) return null;

  const TRUSTED_TYPES = new Set(['homepage', 'offerings', 'process', 'pricing']);
  const allowedUrls = new Set();
  for (const type of TRUSTED_TYPES) {
    for (const p of pagesByType[type] || []) {
      if (p && p.url) allowedUrls.add(p.url);
    }
  }

  const best = byPage
    .filter(p => allowedUrls.size === 0 || allowedUrls.has(p.url))
    .filter(p => {
      const steps = p.steps || [];
      if (steps.length < 2 || steps.length > 6) return false;
      return steps.every(looksLikeStep);
    })
    .sort((a, b) => b.steps.length - a.steps.length)[0];

  if (!best) return null;

  return {
    value: best.steps.map((s, i) => `${i + 1}. ${s}`).join(' '),
    evidence: best.steps.map(s => ({ text: s, source: best.url })),
    source_type: 'direct',
    confidence: 0.9,
    validation: { reasoning: 'Step flow (trusted page type).' },
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
  const STRONG = /\b(patent(?:ed)?|ISO\s*\d+|SOC\s*2|GDPR[- ]compliant|CCPA[- ]compliant|network\s*effect|switching\s*cost)\b/i;

  for (const p of all) {
    const list = (p.paragraphs || []).concat((p.sections || []).map(sec => typeof sec === 'string' ? sec : sec.text || ''));
    for (const s of list) {
      if (!s || typeof s !== 'string') continue;
      if (s.length < 30 || s.length > 300) continue;
      if (!STRONG.test(s)) continue;

      if (!isCleanText(s)) continue;
      if (/[A-Z]{4,}\d{3,}/.test(s)) continue;
      if (/[a-z]\.[A-Z]/.test(s)) continue;

      const commaCount = (s.match(/,/g) || []).length;
      const imperativeVerbs = (s.match(/\b(add|turn on|enable|configure|set|deploy|use|get|try)\b/gi) || []).length;
      if (commaCount >= 3 && imperativeVerbs >= 1) continue;
      if (imperativeVerbs >= 2) continue;
      if (/\b(autoscale|deploy|configure|integrate|monitor)\b/i.test(s) && /\b(and|or)\b/i.test(s)) continue;

      return {
        value: s.slice(0, 220),
        evidence: [{ text: s, source: p.url }],
        source_type: 'direct',
        confidence: 0.8,
        validation: { reasoning: 'Moat signal present (non-feature).' },
      };
    }
  }

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

