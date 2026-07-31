/**
 * Zunax IT Support — Odoo CORS Proxy Server
 * Runs on http://localhost:8085
 * Forwards /proxy/* → ODOO_URL/*  with full CORS headers
 *
 * Usage:
 *   node server.js
 *   node server.js http://localhost:8067   (custom Odoo URL)
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 8085;

// Odoo base URL — can be overridden via CLI arg or ODOO_URL env var
const ODOO_BASE = process.env.ODOO_URL || process.argv[2] || 'http://localhost:8067';

console.log(`\n🚀  Zunax IT CORS Proxy starting...`);
console.log(`   Proxy: http://localhost:${PORT}/proxy/*`);
console.log(`   → Odoo: ${ODOO_BASE}\n`);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type,Accept,Authorization,X-Openerp-Session-Id,X-API-Key,Cookie',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Expose-Headers': 'Set-Cookie',
};

const server = http.createServer((req, res) => {
  // ── CORS pre-flight ──────────────────────────────────────────────────────
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Health-check ─────────────────────────────────────────────────────────
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', odoo: ODOO_BASE, proxy: `http://localhost:${PORT}` }));
    return;
  }

  // ── Route: /proxy/<path> → Odoo ──────────────────────────────────────────
  if (!req.url.startsWith('/proxy')) {
    res.writeHead(404);
    res.end('Not Found. Use /proxy/<odoo-path>');
    return;
  }

  const odooPath = req.url.replace(/^\/proxy/, '') || '/';
  const targetUrl = `${ODOO_BASE}${odooPath}`;

  const parsed = url.parse(targetUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path,
    method: req.method,
    headers: {
      ...req.headers,
      host: parsed.host,
    },
  };

  // Remove headers that would cause issues
  delete options.headers['origin'];
  delete options.headers['referer'];

  console.log(`  ↗  ${req.method} ${odooPath} → ${targetUrl}`);

  const proxyReq = transport.request(options, (proxyRes) => {
    // Forward Odoo response headers (except CORS, we set our own)
    const forwardHeaders = { ...CORS_HEADERS };
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (!k.toLowerCase().startsWith('access-control')) {
        forwardHeaders[k] = v;
      }
    });

    res.writeHead(proxyRes.statusCode, forwardHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`  ✗  Proxy error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(
      JSON.stringify({
        error: `Cannot reach Odoo at ${ODOO_BASE}. Make sure Odoo is running.`,
        detail: err.message,
      })
    );
  });

  // Forward request body
  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`✅  Proxy ready at http://localhost:${PORT}`);
  console.log(`   Test: http://localhost:${PORT}/health\n`);
});
