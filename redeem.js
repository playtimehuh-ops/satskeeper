'use strict';

const { getSupabase } = require('./_lib/supabase');
const { requireAppKey } = require('./_lib/auth');
const { getConfig } = require('./_lib/config');
const { DEVICE_ID_RE, send, method, readBody, fail } = require('./_lib/http');
const { pointsToCents } = require('./_lib/points');

module.exports = async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  if (!requireAppKey(req, res)) return;

  try {
    const body = readBody(req);
    const deviceId = String(body.device_id || '');
    if (!DEVICE_ID_RE.test(deviceId)) return send(res, 400, { error: 'invalid_device_id' });

    const sb = getSupabase();
    const cfg = await getConfig();

    const { data: device, error: readError } = await sb
      .from('devices')
      .select('device_id, points_balance')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (readError) throw readError;
    if (!device) return send(res, 404, { error: 'device_not_found' });

    if (Number(device.points_balance) < cfg.threshold_points) {
      return send(res, 400, {
        error: 'below_threshold',
        points: Number(device.points_balance),
        threshold: cfg.threshold_points,
      });
    }

    const { count, error: pendingError } = await sb
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('device_id', deviceId)
      .in('status', ['pending', 'approved']);
    if (pendingError) throw pendingError;
    if (count > 0) return send(res, 409, { error: 'redemption_in_progress' });

    const points = cfg.threshold_points;

    // Atomic deduction: the guard lives inside a single UPDATE, so concurrent requests cannot double-spend.
    const { data: spent, error: spendError } = await sb.rpc('spend_points', {
      p_device_id: deviceId,
      p_points: points,
    });
    if (spendError) throw spendError;
    if (!spent) return send(res, 409, { error: 'insufficient_points' });

    // Never auto-issued: always created as 'pending' for a human to review.
    const { data: redemption, error: insertError } = await sb
      .from('redemptions')
      .insert({
        device_id: deviceId,
        points_spent: points,
        value_cents: pointsToCents(points, cfg),
        status: 'pending',
      })
      .select('id, points_spent, value_cents, status, created_at')
      .single();

    if (insertError) {
      await sb.rpc('refund_points', { p_device_id: deviceId, p_points: points });
      throw insertError;
    }

    return send(res, 201, { redemption });
  } catch (err) {
    return fail(res, err);
  }
};

module.exports.config = { api: { bodyParser: true } };
