/**
 * Brill Overlays for Zoom — zero-dependency Node server.
 *
 * - Serves the Zoom App front-end from /public
 * - Sends the OWASP security headers Zoom requires for Zoom Apps
 * - Handles the OAuth redirect (/auth) so you can install the app on your account
 *   and get bounced straight back into the Zoom client via a deeplink.
 *
 * Run:  node server.js     (Node 18+)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- tiny .env loader (no dependencies) ----------
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_ID = process.env.ZM_CLIENT_ID || '';
const CLIENT_SECRET = process.env.ZM_CLIENT_SECRET || '';
const REDIRECT_URL = process.env.ZM_REDIRECT_URL || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

// Zoom Apps must send these OWASP headers (Marketplace review checks them).
function securityHeaders() {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://appssdk.zoom.us",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob: mediastream:",
      "connect-src 'self' https://appssdk.zoom.us",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  res.end(body);
}

function page(title, html) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px system-ui,sans-serif;background:#0f1218;color:#e8ecf3;display:grid;place-items:center;min-height:100vh;margin:0}
.card{max-width:520px;padding:32px;border-radius:16px;background:#171b24;border:1px solid #262c3a}
a{color:#4da3ff}code{background:#0b0e13;padding:2px 6px;border-radius:6px}</style></head>
<body><div class="card">${html}</div></body></html>`;
}

// ---------- OAuth install flow ----------
async function handleAuth(req, res, url) {
  const code = url.searchParams.get('code');
  if (!code) {
    return send(res, 400, page('Missing code', '<h2>Missing <code>code</code></h2><p>Start the install from the Zoom Marketplace “Add” / “Local Test” page.</p>'), { 'Content-Type': MIME['.html'] });
  }
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URL) {
    return send(res, 200, page('Installed', `<h2>✅ Authorized</h2>
      <p>The app was authorized. Open Zoom → <b>Apps</b> → <b>Brill Overlays</b> inside a meeting.</p>
      <p style="opacity:.7">Tip: set <code>ZM_CLIENT_ID</code>, <code>ZM_CLIENT_SECRET</code> and <code>ZM_REDIRECT_URL</code> in <code>.env</code> to be redirected into the Zoom client automatically.</p>`), { 'Content-Type': MIME['.html'] });
  }
  try {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URL }),
    });
    const token = await tokenRes.json();
    if (!token.access_token) throw new Error(JSON.stringify(token));

    const dlRes = await fetch('https://api.zoom.us/v2/zoomapp/deeplink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: JSON.stringify({ url: '/', role_name: 'Owner', verified: 1, role_id: 0 }) }),
    });
    const dl = await dlRes.json();
    if (!dl.deeplink) throw new Error(JSON.stringify(dl));
    res.writeHead(302, { ...securityHeaders(), Location: dl.deeplink });
    res.end();
  } catch (err) {
    console.error('[auth] failed:', err.message);
    send(res, 500, page('Install error', `<h2>Install error</h2><p>${String(err.message).replace(/</g, '&lt;')}</p>`), { 'Content-Type': MIME['.html'] });
  }
}

// ---------- static files ----------
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, buf) =>
        e2 ? send(res, 404, 'Not found') : send(res, 200, buf, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }));
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/auth') return handleAuth(req, res, url);
  if (url.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': MIME['.json'] });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Brill Overlays running on http://${HOST}:${PORT}`);
  console.log('Expose it over HTTPS (e.g. `ngrok http ' + PORT + '`) and use that URL as the Zoom App Home URL.');
});
