const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname)));

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

app.listen(PORT, () => console.log(`Atlanta Explorer on :${PORT}`));
