#!/usr/bin/env node
// Batch-enriches all 276 Atlanta Explorer buildings using Anthropic API.
// Haiku 4.5 for regulars (batched 5/call), Opus 4.7 for landmarks.
// Outputs: scripts/wiki_seed.json
// Usage: ANTHROPIC_API_KEY=sk-ant-... node scripts/enrich_all.js

const fs   = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Set ANTHROPIC_API_KEY env var'); process.exit(1); }

// Parse buildings from HTML
const html      = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const jsonMatch = html.match(/<script id="buildingsJSON"[^>]*>([\s\S]*?)<\/script>/);
const BUILDINGS = JSON.parse(jsonMatch[1]);

const NEIGHBORHOODS = {
  mc:'Midtown Core', si:'SID', ts:'Tech Square', hm:'Historic Midtown',
  ap:'Ansley Park', sf:'Sherwood Forest', ph:'Piedmont Heights', dt:'Downtown',
  o4:'Old Fourth Ward', py:'Poncey-Highland', vh:'Virginia-Highland',
  ip:'Inman Park', bk:'Buckhead', wm:'West Midtown', as:'Atlantic Stn'
};
const TYPES = {
  HR:'High-Rise Apt', MR:'Mid-Rise Apt', ST:'Student Housing', CD:'Condo Tower',
  MX:'Mixed-Use Res', LR:'Low-Rise/TH', SF:'Single-Family', NR:'Non-Resid.'
};

const LANDMARK_IDS = new Set([
  'fox-theatre-660-peachtree','truist-plaza-303-peachtree-st',
  '191-peachtree-tower-191-peachtree-st','westin-peachtree-plaza-210-peachtree-st-nw',
  'georgia-pacific-tower-133-peachtree-st','marriott-marquis-265-peachtree-center',
  'ponce-city-market-675-ponce','cnn-center-190-marietta',
  'state-farm-arena-1-state-farm-dr','one-peachtree-center-303-peachtree',
  'high-museum-1280-peachtree','georgian-terrace-659-peachtree',
  'emory-midtown-550-peachtree','biltmore-817-w-peachtree',
  'state-of-georgia-bldg-2-peachtree-st','omni-hotel-cnn-center',
  'w-atlanta-downtown-45-ivan-allen','loews-atlanta-hotel-1065-peachtree',
  'flatiron-bldg-84-peachtree','woodruff-arts-center-1280-peachtree',
  'ncr-hq-864-spring-st','centergy-one-75-5th-st',
]);

const OUT_FILE  = path.join(__dirname, 'wiki_seed.json');
const seed      = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE,'utf8')) : {};
const SKIP_SF   = true; // skip single-family — no individual wiki pages

async function callAnthropic(body, useSearch) {
  const headers = {
    'Content-Type':    'application/json',
    'x-api-key':       API_KEY,
    'anthropic-version':'2023-06-01',
  };
  if (useSearch) {
    headers['anthropic-beta'] = 'web-search-2025-03-05';
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }
  const res  = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST', headers, body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || res.status); }
  return res.json();
}

function buildPrompt(b) {
  return `Research this Atlanta building and return ONLY valid JSON (no markdown):
Name: ${b.name} | Address: ${b.address} | Type: ${TYPES[b.type]||b.type}
Neighborhood: ${NEIGHBORHOODS[b.neighborhood]||b.neighborhood} | Year Built: ${b.yearBuilt||'?'}
Known data: ${b.estimates?.units||'?'} units, ${b.estimates?.floors||'?'} floors

Return exactly this schema (null for unknown values):
{"building_id":"${b.id}","fields":{"units_total":{"value":null,"confidence":"low"},"floors":{"value":null,"confidence":"low"},"bedrooms_total":{"value":null,"confidence":"low"},"architect":{"value":null,"confidence":"low"},"developer":{"value":null,"confidence":"low"},"completion_year":{"value":null,"confidence":"low"}},"sources":[],"summary":"2-3 sentence description of this building's role in Atlanta.","history":"1-2 sentences on the building history.","architecture":"1 sentence on architectural style or notable features."}`;
}

function buildBatchPrompt(buildings) {
  const list = buildings.map((b,i) =>
    `${i+1}. id="${b.id}" name="${b.name}" address="${b.address}" type="${TYPES[b.type]||b.type}" neighborhood="${NEIGHBORHOODS[b.neighborhood]||b.neighborhood}" yearBuilt="${b.yearBuilt||'?'}" units="${b.estimates?.units||'?'}" floors="${b.estimates?.floors||'?'}"`
  ).join('\n');
  return `Research these ${buildings.length} Atlanta buildings. Do ONE web search, return a JSON array in order.

${list}

Return ONLY a JSON array (no markdown):
[{"building_id":"...","fields":{"units_total":{"value":null,"confidence":"low"},"floors":{"value":null,"confidence":"low"},"bedrooms_total":{"value":null,"confidence":"low"},"architect":{"value":null,"confidence":"low"},"developer":{"value":null,"confidence":"low"},"completion_year":{"value":null,"confidence":"low"}},"sources":[],"summary":"2-3 sentence description.","history":"1-2 sentence history.","architecture":"1 sentence architectural note."},...]`;
}

function parseJSON(text) {
  const mArr = text.match(/\[[\s\S]*\]/);
  if (mArr) { try { return { type:'array', data: JSON.parse(mArr[0]) }; } catch{} }
  const mObj = text.match(/\{[\s\S]*\}/);
  if (mObj) { try { return { type:'object', data: JSON.parse(mObj[0]) }; } catch{} }
  return null;
}

function saveResult(id, json) {
  seed[id] = {
    summary:      json.summary      || '',
    history:      json.history      || '',
    architecture: json.architecture || '',
    fields:       json.fields       || {},
    sources:      json.sources      || [],
    enrichedAt:   new Date().toISOString(),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(seed, null, 2));
}

async function enrichLandmark(b) {
  process.stdout.write(`  [Opus] ${b.name}... `);
  const data = await callAnthropic({
    model: 'claude-opus-4-7', max_tokens: 2048,
    messages: [{ role:'user', content: buildPrompt(b) }]
  }, false);
  const text   = (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  const parsed = parseJSON(text);
  if (parsed?.type === 'object') { saveResult(b.id, parsed.data); console.log('✓'); }
  else { console.log('✗ parse fail'); }
}

async function enrichBatch(batch) {
  const names = batch.map(b=>b.name).join(', ');
  process.stdout.write(`  [Haiku×${batch.length}] ${names.slice(0,60)}... `);
  const data = await callAnthropic({
    model: 'claude-haiku-4-5-20251001', max_tokens: 4096,
    messages: [{ role:'user', content: buildBatchPrompt(batch) }]
  }, true);
  const text   = (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  const parsed = parseJSON(text);
  if (parsed?.type === 'array') {
    parsed.data.forEach((json, i) => {
      const id = json.building_id || batch[i]?.id;
      if (id) saveResult(id, json);
    });
    console.log('✓');
  } else {
    // fallback: try individual
    console.log('batch parse fail, falling back...');
    for (const b of batch) {
      try {
        const d2 = await callAnthropic({
          model:'claude-haiku-4-5-20251001', max_tokens:1024,
          messages:[{role:'user',content:buildPrompt(b)}]
        }, false);
        const t2 = (d2.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
        const p2 = parseJSON(t2);
        if (p2?.type==='object') { saveResult(b.id, p2.data); process.stdout.write(`✓`); }
      } catch(e) { process.stdout.write(`✗`); }
      await new Promise(r=>setTimeout(r,400));
    }
    console.log('');
  }
}

async function main() {
  const todo = BUILDINGS.filter(b => {
    if (SKIP_SF && b.type === 'SF') return false;
    return !seed[b.id];
  });

  console.log(`Atlanta Explorer — Enrichment Script`);
  console.log(`Total buildings: ${BUILDINGS.length} | Already done: ${Object.keys(seed).length} | To enrich: ${todo.length}`);
  if (!todo.length) { console.log('All done!'); return; }

  const landmarks = todo.filter(b => LANDMARK_IDS.has(b.id));
  const regulars  = todo.filter(b => !LANDMARK_IDS.has(b.id));

  console.log(`\nLandmarks (Opus, no search): ${landmarks.length}`);
  for (const b of landmarks) {
    await enrichLandmark(b);
    await new Promise(r=>setTimeout(r,700));
  }

  console.log(`\nRegulars (Haiku, batched 5/call): ${regulars.length}`);
  for (let i = 0; i < regulars.length; i += 5) {
    const batch = regulars.slice(i, i+5);
    await enrichBatch(batch);
    await new Promise(r=>setTimeout(r,500));
    if ((i+5) % 25 === 0) console.log(`  --- ${i+5}/${regulars.length} done ---`);
  }

  console.log(`\n✓ Enrichment complete. Output: scripts/wiki_seed.json`);
  console.log(`  Run: node scripts/bake_wiki.js  to embed into index.html`);
}

main().catch(console.error);
