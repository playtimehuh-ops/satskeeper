'use strict';

const { getSupabase, logAudit } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/auth');
const { getConfig } = require('../_lib/config');
const { UUID_RE, send, readBody, fail } = require('../_lib/http');
const { issueGiftCard } = require('../_lib/bitrefill');

const STATUSES = ['pending', 'approved', 'rejected', 'paid'];

async function list(req, res) {
  const status = String((req.query && req.query.status) || 'pending');
  if (status !== 'all' && !STATUSES.includes(status)) return send(res, 400, { error: 'invalid_status' });

  let query = getSupabase()
    .from('redemptions')
    .select('id, device_id, points_spent, value_cents, status, code, note, created_at, decided_at, devices(handle)')
    .order('created_at', { ascending: true })
    .limit(200);
  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;

  const redemptions = (data || []).map((r) => ({
    id: r.id,
    device_id: r.device_id,
    handle: r.devices ? r.devices.handle : null,
    points_spent: Number(r.points_spent),
    value_cents: r.value_cents,
    status: r.status,
    code: r.code,
    note: r.note,
    created_at: r.created_at,
    decided_at: r.decided_at,
  }));
  return send(res, 200, { status, redemptions });
}

async function decide(req, res) {
  const body = readBody(req);
  const id = String(body.id || '');
  const action = String(body.action || '');
  if (!UUID_RE.test(id)) return send(res, 400, { error: 'invalid_id' });
  if (!['approve', 'reject', 'paid'].includes(action)) return send(res, 400, { error: 'invalid_action' });

  const sb = getSupabase();
  const { data: current, error: readError } = await sb
    .from('redemptions')
    .select('id, device_id, points_spent, value_cents, status, devices(handle)')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return send(res, 404, { error: 'redemption_not_found' });

  const decidedAt = new Date().toISOString();

  if (action === 'approve') {
    if (current.status !== 'pending') return send(res, 409, { error: 'not_pending', status: current.status });

    const cfg = await getConfig();
    // May throw 501 for providers that are not implemented. Status is only changed after it returns.
    const giftCard = await issueGiftCard({
      redemption: current,
      device: current.devices || null,
      provider: cfg.gift_card_provider,
    });

    const update = { status: 'approved', decided_at: decidedAt, note: giftCard.instructions.join(' ') };
    if (giftCard.code) update.code = giftCard.code;

    const { data, error } = await sb
      .from('redemptions')
      .update(update)
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, status, code, note, decided_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return send(res, 409, { error: 'changed_concurrently' });

    await logAudit('redemption.approve', { id, device_id: current.device_id, provider: giftCard.provider });
    return send(res, 200, { redemption: data, gift_card: giftCard });
  }

  if (action === 'reject') {
    if (!['pending', 'approved'].includes(current.status)) {
      return send(res, 409, { error: 'cannot_reject', status: current.status });
    }

    const note = body.note ? String(body.note).slice(0, 500) : null;
    const { data, error } = await sb
      .from('redemptions')
      .update({ status: 'rejected', decided_at: decidedAt, note })
      .eq('id', id)
      .in('status', ['pending', 'approved'])
      .select('id, status, note, decided_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return send(res, 409, { error: 'changed_concurrently' });

    // Rejected redemptions give the points back (balance only; lifetime_points is unaffected).
    const { error: refundError } = await sb.rpc('refund_points', {
      p_device_id: current.device_id,
      p_points: Number(current.points_spent),
    });
    if (refundError) throw refundError;

    await logAudit('redemption.reject', { id, device_id: current.device_id, refunded: Number(current.points_spent) });
    return send(res, 200, { redemption: data, refunded_points: Number(current.points_spent) });
  }

  // action === 'paid'
  if (!['pending', 'approved'].includes(current.status)) {
    return send(res, 409, { error: 'cannot_mark_paid', status: current.status });
  }
  const code = String(body.code || '').trim().slice(0, 500);
  if (!code) return send(res, 400, { error: 'code_required' });

  const { data, error } = await sb
    .from('redemptions')
    .update({ status: 'paid', code, decided_at: decidedAt })
    .eq('id', id)
    .in('status', ['pending', 'approved'])
    .select('id, status, code, decided_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) return send(res, 409, { error: 'changed_concurrently' });

  await logAudit('redemption.paid', { id, device_id: current.device_id, value_cents: current.value_cents });
  return send(res, 200, { redemption: data });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  if (!requireAdmin(req, res)) return;

  try {
    return req.method === 'GET' ? await list(req, res) : await decide(req, res);
  } catch (err) {
    return fail(res, err, true);
  }
};

module.exports.config = { api: { bodyParser: true } };
