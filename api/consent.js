'use strict';

const { getSupabase } = require('./_lib/supabase');
const { requireAppKey } = require('./_lib/auth');
const { DEVICE_ID_RE, send, method, readBody, fail } = require('./_lib/http');

function cleanHandle(value, deviceId) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
  return cleaned || `sats-${deviceId.slice(0, 6)}`;
}

module.exports = async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  if (!requireAppKey(req, res)) return;

  try {
    const body = readBody(req);
    const deviceId = String(body.device_id || '');
    if (!DEVICE_ID_RE.test(deviceId)) return send(res, 400, { error: 'invalid_device_id' });
    if (typeof body.opted_in !== 'boolean') return send(res, 400, { error: 'opted_in_must_be_boolean' });

    const version = String(body.consent_version || '').slice(0, 32);
    if (body.opted_in && !version) return send(res, 400, { error: 'consent_version_required' });

    const sb = getSupabase();
    const { data: existing, error: readError } = await sb
      .from('devices')
      .select('device_id, opted_in, consent_at, consent_version')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (readError) throw readError;

    const row = { device_id: deviceId, opted_in: body.opted_in };
    if (!existing) row.handle = cleanHandle(body.handle, deviceId);

    if (body.opted_in) {
      // Re-sending the same consent keeps the original timestamp; a new opt-in or new version is re-stamped.
      const unchanged =
        existing && existing.opted_in && existing.consent_at && existing.consent_version === version;
      row.consent_at = unchanged ? existing.consent_at : new Date().toISOString();
      row.consent_version = version;
    } else {
      // Opt-out clears the consent timestamp. Points and lifetime points are untouched.
      row.consent_at = null;
    }

    const { data, error } = await sb
      .from('devices')
      .upsert(row, { onConflict: 'device_id' })
      .select('device_id, handle, opted_in, consent_at, consent_version')
      .single();
    if (error) throw error;

    return send(res, 200, data);
  } catch (err) {
    return fail(res, err);
  }
};

module.exports.config = { api: { bodyParser: true } };
