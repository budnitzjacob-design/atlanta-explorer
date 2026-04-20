#!/usr/bin/env node
// Builds a fully self-contained standalone HTML file.
// Inlines Three.js from CDN, strips server-only API calls, bakes wiki data.

const fs   = require('fs');
const path = require('path');
const https = require('https');

const SRC  = path.join(__dirname, '../index.html');
const OUT  = path.join(__dirname, '../atlanta-explorer-standalone.html');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('Building standalone HTML...');

  let html = fs.readFileSync(SRC, 'utf8');

  // 1. Fetch Three.js and inline it
  process.stdout.write('  Fetching Three.js r128... ');
  const threejs = await fetch('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
  html = html.replace(
    /<script defer src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"><\/script>/,
    `<script>${threejs}</script>`
  );
  console.log('✓');

  // 2. Remove preconnect/preload hints (not needed when inlined)
  html = html.replace(/<!-- Preconnect.*?-->\n/s, '');
  html = html.replace(/<link rel="preconnect"[^>]*>\n?/g, '');
  html = html.replace(/<link rel="preload"[^>]*onload[^>]*>\n?/g, '');
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>\n?/, '');

  // 3. Restore blocking Google Fonts (works offline if cached; graceful fallback)
  const fontsTag = '<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:opsz,wght@9..40,300;9..40,500;9..40,700&display=swap" rel="stylesheet">';
  html = html.replace('</title>', `</title>\n${fontsTag}`);

  // 4. Remove manifest/SW (standalone file doesn't need PWA install)
  html = html.replace(/<link rel="manifest"[^>]*>\n?/g, '');
  html = html.replace(/<link rel="apple-touch-icon"[^>]*>\n?/g, '');
  html = html.replace(/<script>\s*if \('serviceWorker'[\s\S]*?<\/script>\n?/, '');

  // 5. Patch IS_LOCAL so API enrichment targets Anthropic directly when opened as file
  // (already handled by the existing IS_LOCAL check — no change needed)

  // 6. Patch RAG_ENDPOINT comment to explain standalone usage
  html = html.replace(
    "const RAG_ENDPOINT = IS_LOCAL ? 'https://api.anthropic.com/v1/messages' : '/api/enrich';",
    "const RAG_ENDPOINT = 'https://api.anthropic.com/v1/messages'; // standalone: always direct (set ANTHROPIC_API_KEY via prompt or remove admin features)"
  );

  fs.writeFileSync(OUT, html);
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`✓ Written: atlanta-explorer-standalone.html (${kb} KB)`);
  console.log('  Open in any browser — no server needed.');
  console.log('  For AI enrichment (admin), set your key in the Settings panel.');
}

main().catch(console.error);
