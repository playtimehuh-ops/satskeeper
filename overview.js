'use strict';

const { getSupabase } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { getConfig } = require('../_lib/config');
const { send, method, fail } = require('../_lib/http');
const { pointsToCents } = require('../_lib/points');

module.exports = async function handler(req, res) {
  if (!method(req, res, 'GET')) return;
  if (!requireAdmin(req, res)) return;

  try {
    const [{ data, error }, cfg] = await Promise.all([getSupabase().rpc('admin_totals'), getConfig()]);
    if (error) throw error;

    const revenueCents = Number(data.revenue_cents);
    const cardsPaidCents = Number(data.cards_paid_cents);
    const pointsIssued = Number(data.points_issued);
    const pointsOutstanding = Number(data.points_outstanding);

    return send(res, 200, {
      devices: Number(data.devices),
      opted_in: Number(data.opted_in),
      revenue_cents: revenueCents,
      points_issued: pointsIssued,
      points_issued_value_cents: pointsToCents(pointsIssued, cfg),
      points_outstanding: pointsOutstanding,
      points_outstanding_value_cents: pointsToCents(pointsOutstanding, cfg),
      cards_paid_cents: cardsPaidCents,
      pending_cards_cents: Number(data.pending_cents),
      pending_cards_count: Number(data.pending_count),
      profit_cents: revenueCents - cardsPaidCents,
      warning: cardsPaidCents > revenueCents,
      config: cfg,
    });
  } catch (err) {
    return fail(res, err, true);
  }
};
