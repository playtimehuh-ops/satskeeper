'use strict';

const { createClient } = require('@supabase/supabase-js');

let client = null;

/** Service-role Supabase client, created once per warm function instance. */
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable');
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Best-effort audit trail for admin actions. Never throws. */
async function logAudit(action, payload) {
  try {
    await getSupabase().from('admin_audit').insert({ action, payload: payload || {} });
  } catch (err) {
    console.error('audit log failed', err);
  }
}

module.exports = { getSupabase, logAudit };
