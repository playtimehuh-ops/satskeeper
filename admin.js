(function () {
  'use strict';

  var PAGE_SIZE = 25;
  var state = { tab: 'overview', page: 1, total: 0 };

  function $(id) { return document.getElementById(id); }

  function usd(cents) {
    var sign = cents < 0 ? '-' : '';
    return sign + '$' + (Math.abs(cents) / 100).toFixed(2);
  }

  function num(n) {
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function when(iso) {
    return iso ? new Date(iso).toLocaleString() : '–';
  }

  function esc(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function showError(message) {
    var el = $('error');
    el.textContent = message || '';
    el.hidden = !message;
  }

  function api(path, options) {
    var opts = Object.assign({ credentials: 'include', cache: 'no-store' }, options || {});
    if (opts.body && !opts.headers) opts.headers = { 'Content-Type': 'application/json' };
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.detail || data.error || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function handleFailure(err) {
    if (err.status === 401) {
      showError('Not authorized. Reload the page to sign in again.');
    } else {
      showError(err.message || 'Request failed');
    }
  }

  // ---- Overview

  function loadOverview() {
    return api('/api/admin/overview').then(function (d) {
      showError('');
      $('m-revenue').textContent = usd(d.revenue_cents);
      $('m-points').textContent = num(d.points_issued);
      $('m-points-sub').textContent = '≈ ' + usd(d.points_issued_value_cents) + ' in card value';
      $('m-paid').textContent = usd(d.cards_paid_cents);
      $('m-pending').textContent = d.pending_cards_count
        ? usd(d.pending_cards_cents) + ' pending (' + d.pending_cards_count + ')'
        : 'none pending';
      $('m-profit').textContent = usd(d.profit_cents);
      $('profit-card').classList.toggle('bad', d.profit_cents < 0);
      $('warning').hidden = !d.warning;

      $('m-devices').textContent = num(d.devices);
      $('m-optedin').textContent = num(d.opted_in);
      $('m-outstanding').textContent = num(d.points_outstanding);
      $('m-outstanding-sub').textContent = '≈ ' + usd(d.points_outstanding_value_cents) + ' liability';

      var c = d.config || {};
      $('m-config').textContent =
        'payout ' + Math.round(c.payout_pct * 100) + '% · ' + c.points_per_cent + ' pt/cent · ' +
        c.points_per_dollar + ' pts per $1 · threshold ' + c.threshold_points + ' pts · provider ' + c.gift_card_provider;
    }).catch(handleFailure);
  }

  // ---- Users

  function loadUsers() {
    return api('/api/admin/users?page=' + state.page + '&page_size=' + PAGE_SIZE).then(function (d) {
      showError('');
      state.total = d.total;
      var rows = d.users.map(function (u) {
        return '<tr>' +
          '<td>' + esc(u.handle) + '</td>' +
          '<td class="mono" title="' + esc(u.device_id) + '">' + esc(u.device_id.slice(0, 8)) + '…</td>' +
          '<td>' + (u.opted_in ? 'yes' : 'no') + '</td>' +
          '<td class="num">' + usd(u.revenue_cents) + '</td>' +
          '<td class="num">' + num(u.points_balance) + '</td>' +
          '<td class="num">' + num(u.lifetime_points) + '</td>' +
          '<td class="num">' + u.streak + '</td>' +
          '<td class="num">' + u.multiplier.toFixed(2) + '×</td>' +
          '<td>' + when(u.last_active_at) + '</td>' +
          '</tr>';
      });
      $('users-body').innerHTML = rows.join('') || '<tr><td colspan="9" class="muted">No users yet.</td></tr>';

      var pages = Math.max(1, Math.ceil(d.total / PAGE_SIZE));
      $('page-info').textContent = 'Page ' + d.page + ' of ' + pages + ' · ' + d.total + ' devices';
      $('prev').disabled = d.page <= 1;
      $('next').disabled = d.page >= pages;
    }).catch(handleFailure);
  }

  // ---- Redemptions

  function renderRedemption(r) {
    var actions = '';
    if (r.status === 'pending') {
      actions += '<button type="button" data-act="approve" data-id="' + esc(r.id) + '">Approve</button>';
    }
    if (r.status === 'pending' || r.status === 'approved') {
      actions +=
        '<input type="text" class="code" placeholder="Paste gift card code" aria-label="Gift card code">' +
        '<button type="button" class="primary" data-act="paid" data-id="' + esc(r.id) + '">Mark paid</button>' +
        '<button type="button" class="danger" data-act="reject" data-id="' + esc(r.id) + '">Reject</button>';
    }
    return '<article class="item" data-id="' + esc(r.id) + '">' +
      '<div class="item-head">' +
        '<strong>' + esc(r.handle || r.device_id.slice(0, 8)) + '</strong>' +
        '<span class="badge ' + esc(r.status) + '">' + esc(r.status) + '</span>' +
      '</div>' +
      '<div class="item-meta">' + usd(r.value_cents) + ' · ' + num(r.points_spent) + ' pts · requested ' + when(r.created_at) + '</div>' +
      (r.note ? '<div class="item-note">' + esc(r.note) + '</div>' : '') +
      (r.code && r.status === 'paid' ? '<div class="item-meta">Code: <span class="mono">' + esc(r.code) + '</span></div>' : '') +
      (actions ? '<div class="item-actions">' + actions + '</div>' : '') +
    '</article>';
  }

  function loadRedemptions() {
    var status = $('status-filter').value;
    return api('/api/admin/redemptions?status=' + encodeURIComponent(status)).then(function (d) {
      showError('');
      $('redemption-list').innerHTML = d.redemptions.map(renderRedemption).join('') ||
        '<p class="muted">Nothing here.</p>';
    }).catch(handleFailure);
  }

  function act(button) {
    var item = button.closest('.item');
    var action = button.getAttribute('data-act');
    var payload = { id: button.getAttribute('data-id'), action: action };

    if (action === 'paid') {
      var code = item.querySelector('.code').value.trim();
      if (!code) { showError('Paste the gift card code before marking paid.'); return; }
      payload.code = code;
    }
    if (action === 'reject' && !window.confirm('Reject and refund the points to the user?')) return;

    button.disabled = true;
    api('/api/admin/redemptions', { method: 'POST', body: JSON.stringify(payload) })
      .then(function (d) {
        showError('');
        if (action === 'approve' && d.gift_card && d.gift_card.instructions) {
          window.alert(d.gift_card.instructions.join('\n'));
        }
        return Promise.all([loadRedemptions(), loadOverview()]);
      })
      .catch(function (err) { button.disabled = false; handleFailure(err); });
  }

  // ---- Tabs and wiring

  function show(tab) {
    state.tab = tab;
    ['overview', 'users', 'redemptions'].forEach(function (name) {
      $(name).hidden = name !== tab;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    showError('');
    if (tab === 'overview') loadOverview();
    if (tab === 'users') loadUsers();
    if (tab === 'redemptions') loadRedemptions();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-tab')); });
  });
  $('prev').addEventListener('click', function () { if (state.page > 1) { state.page--; loadUsers(); } });
  $('next').addEventListener('click', function () { state.page++; loadUsers(); });
  $('status-filter').addEventListener('change', loadRedemptions);
  $('redemption-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (b) act(b);
  });

  show('overview');
})();
