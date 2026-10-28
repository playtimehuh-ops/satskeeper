'use strict';

const { getSupabase } = require('./_lib/supabase');
const { requireAppKey } = require('./_lib/auth');
const { getConfig } = require('./_lib/config');
const { DEVICE_ID_RE, send, method, fail } = require('./_lib/http');
const { effectiveState, pointsToCents } = require('./_lib/points');

module.exports = async function handler(req, res) {
  if (!method(req, res, 'GET')) return;
  if (!requireAppKey(req, res)) return;

  try {
    const deviceId = String((req.query && req.query.device_id) || '');
    if (!DEVICE_ID_RE.test(deviceId)) return send(res, 400, { error: 'invalid_device_id' });

    const sb = getSupabase();
    const [{ data: device, error }, cfg] = await Promise.all([
      sb
        .from('devices')
        .select('device_id, opted_in, consent_at, points_balance, lifetime_points, streak, multiplier, last_active_at')
        .eq('device_id', deviceId)
        .maybeSingle(),
      getConfig(),
    ]);
    if (error) throw error;
    if (!device) return send(res, 404, { error: 'device_not_found' });

    const { count, error: pendingError } = await sb
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('device_id', deviceId)
      .in('status', ['pending', 'approved']);
    if (pendingError) throw pendingError;

    const state = effectiveState(device);
    const points = Number(device.points_balance);

    return send(res, 200, {
      points,
      lifetime_points: Number(device.lifetime_points),
      value_cents: pointsToCents(points, cfg),
      streak: state.streak,
      multiplier: state.multiplier,
      idle: state.idle,
      threshold: cfg.threshold_points,
      threshold_value_cents: pointsToCents(cfg.threshold_points, cfg),
      can_redeem: points >= cfg.threshold_points && !(count > 0),
      pending_redemption: count > 0,
      opted_in: device.opted_in,
      consent_at: device.consent_at,
    });
  } catch (err) {
    return fail(res, err);
  }
};
