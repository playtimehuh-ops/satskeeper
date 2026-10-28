'use strict';

const { getSupabase, logAudit } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { getConfig } = require('../_lib/config');
const { DEVICE_ID_RE, send, method, readBody, fail } = require('../_lib/http');
const { effectiveState, pointsForRevenue } = require('../_lib/points');

const PERIOD_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_CENTS = 2000000000;

module.exports = async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  if (!requireAdmin(req, res)) return;

  try {
    const body = readBody(req);
    const deviceId = String(body.device_id || '');
    const period = String(body.period || '');
    const revenueCents = body.revenue_cents;

    if (!DEVICE_ID_RE.test(deviceId)) return send(res, 400, { error: 'invalid_device_id' });
    if (!PERIOD_RE.test(period)) return send(res, 400, { error: 'invalid_period', hint: 'e.g. 2026-10' });
    if (!Number.isInteger(revenueCents) || revenueCents <= 0 || revenueCents > MAX_CENTS) {
      return send(res, 400, { error: 'invalid_revenue_cents', hint: 'positive integer (cents)' });
    }

    const sb = getSupabase();
    const cfg = await getConfig();

    const { data: device, error: readError } = await sb
      .from('devices')
      .select('device_id, streak, multiplier, last_active_at')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (readError) throw readError;
    if (!device) return send(res, 404, { error: 'device_not_found' });

    const { multiplier } = effectiveState(device);
    const points = pointsForRevenue(revenueCents, cfg, multiplier);
    if (points <= 0) return send(res, 400, { error: 'zero_points', hint: 'revenue too small for the current payout settings' });

    // UNIQUE(device_id, period) makes crediting the same period twice impossible.
    const { data: event, error: insertError } = await sb
      .from('revenue_events')
      .insert({ device_id: deviceId, period, revenue_cents: revenueCents, points_awarded: points })
      .select('id, device_id, period, revenue_cents, points_awarded, created_at')
      .single();
    if (insertError) {
      if (insertError.code === '23505') return send(res, 409, { error: 'period_already_credited' });
      throw insertError;
    }

    const { data: balance, error: addError } = await sb.rpc('add_points', {
      p_device_id: deviceId,
      p_delta: points,
    });
    if (addError) {
      await sb.from('revenue_events').delete().eq('id', event.id);
      throw addError;
    }

    await logAudit('credit', {
      device_id: deviceId,
      period,
      revenue_cents: revenueCents,
      points_awarded: points,
      payout_pct: cfg.payout_pct,
      multiplier,
    });

    return send(res, 200, {
      event,
      payout_pct: cfg.payout_pct,
      multiplier,
      points_awarded: points,
      new_balance: Number(balance),
    });
  } catch (err) {
    return fail(res, err, true);
  }
};

module.exports.config = { api: { bodyParser: true } };
