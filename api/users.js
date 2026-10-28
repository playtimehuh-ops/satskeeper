'use strict';

const { getSupabase } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { send, method, fail, clampInt } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, 'GET')) return;
  if (!requireAdmin(req, res)) return;

  try {
    const query = req.query || {};
    const pageSize = clampInt(query.page_size, 25, 1, 100);
    const page = clampInt(query.page, 1, 1, 1000000);
    const offset = (page - 1) * pageSize;

    const sb = getSupabase();
    const [usersResult, countResult] = await Promise.all([
      sb.rpc('admin_users', { p_limit: pageSize, p_offset: offset }),
      sb.from('devices').select('device_id', { count: 'exact', head: true }),
    ]);
    if (usersResult.error) throw usersResult.error;
    if (countResult.error) throw countResult.error;

    const users = (usersResult.data || []).map((u) => ({
      device_id: u.device_id,
      handle: u.handle,
      opted_in: u.opted_in,
      consent_at: u.consent_at,
      points_balance: Number(u.points_balance),
      lifetime_points: Number(u.lifetime_points),
      streak: u.streak,
      multiplier: Number(u.multiplier),
      last_active_at: u.last_active_at,
      created_at: u.created_at,
      revenue_cents: Number(u.revenue_cents),
    }));

    return send(res, 200, {
      page,
      page_size: pageSize,
      total: countResult.count || 0,
      users,
    });
  } catch (err) {
    return fail(res, err, true);
  }
};
