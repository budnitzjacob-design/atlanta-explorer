const express     = require('express');
const path        = require('path');
const compression = require('compression');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname), {
  maxAge: '1h',        // cache static assets for 1 hour
  etag: true,
  setHeaders(res, filePath) {
    // Never cache the HTML — always fresh so deploys land immediately
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// Proxy to Anthropic — API key lives in fly secrets, never in the browser.
app.post('/api/enrich', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        'anthropic-beta':  req.headers['anthropic-beta'] || '',
      },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.text();
    res.status(upstream.status).set('Content-Type', 'application/json').send(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Error report → GitHub Issue
app.post('/api/report', async (req, res) => {
  const { buildingId, buildingName, category, description, reporterEmail } = req.body || {};
  if (!description?.trim()) return res.status(400).json({ error: 'Description required' });

  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'budnitzjacob-design/atlanta-explorer';
  if (!token) return res.status(500).json({ error: 'Reporting not configured' });

  const labels = ['user-report', category || 'general'].filter(Boolean);
  const body = [
    buildingId   ? `**Building:** ${buildingName || buildingId} (\`${buildingId}\`)` : '',
    `**Category:** ${category || 'general'}`,
    '',
    '**Description:**',
    description.trim(),
    '',
    reporterEmail ? `**Reporter:** ${reporterEmail}` : '',
    `**Source:** atlanta-explorer.fly.dev`,
    `**Time:** ${new Date().toISOString()}`,
  ].filter(l => l !== undefined).join('\n').trim();

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: buildingName ? `[Report] ${buildingName}: ${category || 'error'}` : `[Report] ${category || 'Data error'}`,
        body,
        labels,
      }),
    });
    const issue = await ghRes.json();
    if (!ghRes.ok) throw new Error(issue.message || ghRes.status);
    res.json({ ok: true, issueUrl: issue.html_url, issueNumber: issue.number });
  } catch (e) {
    console.error('GitHub issue failed:', e.message);
    res.status(502).json({ error: 'Could not file report: ' + e.message });
  }
});

app.listen(PORT, () => console.log(`Atlanta Explorer on :${PORT}`));
