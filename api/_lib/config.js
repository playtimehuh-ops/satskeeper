'use strict';

const { getSupabase } = require('./supabase');

function num(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Defaults from environment variables. */
function envDefaults() {
  return {
    payout_pct: num(process.env.PAYOUT_PCT, 0.5, { min: 0, max: 1 }),
    points_per_cent: num(process.env.POINTS_PER_CENT, 1, { min: 0.0001 }),
    points_per_dollar: num(process.env.POINTS_PER_DOLLAR, 100, { min: 1 }),
    threshold_points: num(process.env.THRESHOLD_POINTS, 1000, { min: 1 }),
    gift_card_provider: String(process.env.GIFT_CARD_PROVIDER || 'manual').toLowerCase(),
  };
}

let cache = null;
const TTL_MS = 10 * 1000;

/** Env defaults overridden by rows in the Supabase `config` table. */
async function getConfig() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const d = envDefaults();
  const { data, error } = await getSupabase().from('config').select('key,value');
  if (error) throw error;

  const rows = {};
  for (const row of data || []) rows[row.key] = row.value;

  const value = {
    payout_pct: num(rows.payout_pct, d.payout_pct, { min: 0, max: 1 }),
    points_per_cent: num(rows.points_per_cent, d.points_per_cent, { min: 0.0001 }),
    points_per_dollar: num(rows.points_per_dollar, d.points_per_dollar, { min: 1 }),
    threshold_points: num(rows.threshold_points, d.threshold_points, { min: 1 }),
    gift_card_provider: rows.gift_card_provider
      ? String(rows.gift_card_provider).toLowerCase()
      : d.gift_card_provider,
  };

  cache = { at: Date.now(), value };
  return value;
}

module.exports = { getConfig, envDefaults };
