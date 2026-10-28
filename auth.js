'use strict';

const crypto = require('crypto');

// Hash both sides first so timingSafeEqual always compares equal-length buffers.
function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/** Client routes: shared secret in the x-app-key header. Returns true when allowed; otherwise has already responded. */
function requireAppKey(req, res) {
  const expected = process.env.APP_KEY;
  if (!expected) {
    res.status(500).json({ error: 'server_misconfigured', detail: 'APP_KEY is not set' });
    return false;
  }
  const provided = req.headers['x-app-key'];
  if (typeof provided !== 'string' || !safeEqual(provided, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

/** Admin routes: HTTP Basic. Returns true when allowed; otherwise has already responded. */
function requireAdmin(req, res) {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPass = process.env.ADMIN_PASS;
  if (!expectedUser || !expectedPass) {
    res.status(500).json({ error: 'server_misconfigured', detail: 'ADMIN_USER / ADMIN_PASS are not set' });
    return false;
  }

  let ok = false;
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx >= 0) {
      const userOk = safeEqual(decoded.slice(0, idx), expectedUser);
      const passOk = safeEqual(decoded.slice(idx + 1), expectedPass);
      ok = userOk && passOk;
    }
  }

  if (!ok) {
    res.setHeader('WWW-Authenticate', 'Basic realm="SatsKeeper Admin", charset="UTF-8"');
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

module.exports = { requireAppKey, requireAdmin };
