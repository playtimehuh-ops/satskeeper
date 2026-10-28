'use strict';

const { getSupabase } = require('./_lib/supabase');
const { requireAppKey } = require('./_lib/auth');
const { DEVICE_ID_RE, send, method, readBody, fail } = require('./_lib/http');
const { applyStreak } = require('./_lib/points');

module.exports = async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  if (!requireAppKey(req, res)) return;

  try {
    const body = readBody(req);
    const deviceId = String(body.device_id || '');
    if (!DEVICE_ID_RE.test(deviceId)) return send(res, 400, { error: 'invalid_device_id' });

    const sb = getSupabase();
    const { data: device, error: readError } = await sb
      .from('devices')
      .select('device_id, opted_in, streak, multiplier, last_active_at')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (readError) throw readError;
    if (!device) return send(res, 404, { error: 'device_not_found' });
    if (!device.opted_in) return send(res, 403, { error: 'not_opted_in' });

    const now = new Date();
    const next = applyStreak(device, now);

    // Streak, multiplier and activity time only. points_balance / lifetime_points are never written here.
    const { error } = await sb
      .from('devices')
      .update({ streak: next.streak, multiplier: next.multiplier, last_active_at: now.toISOString() })
      .eq('device_id', deviceId);
    if (error) throw error;

    return send(res, 200, { streak: next.streak, multiplier: next.multiplier, streak_reset: next.reset });
  } catch (err) {
    return fail(res, err);
  }
};

module.exports.config = { api: { bodyParser: true } };
