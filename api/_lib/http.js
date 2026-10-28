'use strict';

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

/** Returns true when the method matches; otherwise responds 405 and returns false. */
function method(req, res, allowed) {
  if (req.method === allowed) return true;
  res.setHeader('Allow', allowed);
  send(res, 405, { error: 'method_not_allowed' });
  return false;
}

/** Always returns a plain object, even for missing or malformed JSON. */
function readBody(req) {
  let body;
  try {
    body = req.body;
  } catch (err) {
    return {};
  }
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      return {};
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

/** Error responder. `expose` includes the message (admin routes only). */
function fail(res, err, expose) {
  console.error(err);
  if (err && err.statusCode) {
    return send(res, err.statusCode, { error: err.code || 'error', detail: err.message });
  }
  const body = { error: 'internal_error' };
  if (expose && err && err.message) body.detail = err.message;
  return send(res, 500, body);
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

module.exports = { DEVICE_ID_RE, UUID_RE, send, method, readBody, fail, clampInt };
