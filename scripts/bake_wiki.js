#!/usr/bin/env node
// Bakes wiki_seed.json results into index.html as a pre-populated data block.
// Run AFTER enrich_all.js: node scripts/bake_wiki.js

const fs   = require('fs');
const path = require('path');

const seedFile = path.join(__dirname, 'wiki_seed.json');
const htmlFile = path.join(__dirname, '../index.html');

if (!fs.existsSync(seedFile)) { console.error('Run enrich_all.js first'); process.exit(1); }

const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
let   html = fs.readFileSync(htmlFile, 'utf8');

const tag  = `<script id="wikiSeed" type="application/json">${JSON.stringify(seed)}</script>`;

// Replace existing seed block or insert before closing </body>
if (html.includes('<script id="wikiSeed"')) {
  html = html.replace(/<script id="wikiSeed"[\s\S]*?<\/script>/, tag);
} else {
  html = html.replace('</body>', tag + '\n</body>');
}

fs.writeFileSync(htmlFile, html);
console.log(`✓ Baked ${Object.keys(seed).length} wiki entries into index.html`);
console.log('  Deploy with: git add -A && git commit -m "bake wiki seed" && git push && fly deploy');
