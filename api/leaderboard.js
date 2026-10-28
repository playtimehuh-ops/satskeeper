'use strict';

const { getSupabase } = require('./_lib/supabase');
const { requireAppKey } = require('./_lib/auth');
const { DEVICE_ID_RE, send, method, fail } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, 'GET')) return;
  if (!requireAppKey(req, res)) return;

  try {
    const me = String((req.query && req.query.device_id) || '');
    const meValid = DEVICE_ID_RE.test(me);

    // SQL function: points earned in the last 30 days, excluding opted-out and 7+ day idle devices (rank reset).
    const { data, error } = await getSupabase().rpc('leaderboard_30d', { p_limit: 20 });
    if (error) throw error;

    const leaderboard = (data || []).map((row, index) => ({
      rank: index + 1,
      handle: row.handle || `sats-${String(row.device_id).slice(0, 6)}`,
      points: Number(row.points),
      you: meValid && row.device_id === me,
    }));

    return send(res, 200, { window_days: 30, leaderboard });
  } catch (err) {
    return fail(res, err);
  }
};
