// Token Radar dashboard.
// Renders window.RADAR (the sealed DefiLlama snapshot, model radar-2) into
// the <main id="board"> shell from index.html. No network, no framework:
// plain DOM building from the data file that sits next to this script.
//
// Views:
//   * Board — the 198 pre-token protocols, ranked by implied value.
//   * Live  — the 24 protocols that already have a token, for reference.
// A chain filter narrows the board; clicking a row opens a <dialog> with
// the implied-value breakdown, the category comparables and the farm plan.
// The view is driven by the URL hash so a link can point at one protocol
// (#p=<slug>) or one chain (#chain=<name>).

(function () {
  'use strict';

  var DATA = window.RADAR || null;
  var board = document.getElementById('board');
  if (!board) return;

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------

  // Escape text that goes into HTML so a protocol name can never break
  // the markup.
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var usdWhole = new Intl.NumberFormat('en-US');

  // Full dollars with commas: 534937903 -> $534,937,903.
  function dollars(n) {
    if (n == null || !isFinite(n)) return '—';
    return '$' + usdWhole.format(Math.round(n));
  }

  // Compact dollars for TVL: 2753981495 -> $2.75B, 6612528 -> $6.61M.
  function compactDollars(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
    return '$' + usdWhole.format(Math.round(n));
  }

  // Multiples are shown to four decimals everywhere: 0.246 -> 0.2460.
  function multiple(n) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toFixed(4);
  }

  // 7-day change is stored as a percent: -2.1935 -> -2.19%.
  function change(n) {
    if (n == null || !isFinite(n)) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + Number(n).toFixed(2) + '%';
  }

  function changeClass(n) {
    if (n == null || !isFinite(n)) return '';
    return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  }

  // Show at most three chains, then "+N more" so long rows stay readable.
  // The full list rides along as a hover title, since the cell truncates.
  function chainLabel(chains) {
    if (!chains || !chains.length) return '—';
    var full = esc(chains.join(', '));
    var shown = chains.length <= 3
      ? full
      : esc(chains.slice(0, 3).join(', ')) +
        ' <span class="more">+' + (chains.length - 3) + ' more</span>';
    return '<span title="' + full + '">' + shown + '</span>';
  }

  // ------------------------------------------------------------------
  // Data, sorted the way the board is defined: implied value desc,
  // ties broken by slug ascending so the order is fully deterministic.
  // ------------------------------------------------------------------

  if (!DATA || !Array.isArray(DATA.rows) || !DATA.rows.length) {
    board.innerHTML = '<p class="empty">No board data. The snapshot file (data.js) did not load.</p>';
    board.setAttribute('aria-busy', 'false');
    return;
  }

  var rows = DATA.rows.slice().sort(function (a, b) {
    var d = b.implied_value_usd - a.implied_value_usd;
    if (d !== 0) return d;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  var live = (DATA.live || []).slice().sort(function (a, b) {
    var d = (b.mcap_usd || 0) - (a.mcap_usd || 0);
    if (d !== 0) return d;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  var chains = [];
  rows.forEach(function (r) {
    (r.chains || []).forEach(function (c) {
      if (chains.indexOf(c) === -1) chains.push(c);
    });
  });
  chains.sort();

  var comparables = DATA.comparables || {};
  var byCategory = comparables.by_category || {};
  var overallMultiple = comparables.overall_multiple;

  // ------------------------------------------------------------------
  // State, kept in the hash so a view is linkable.
  // ------------------------------------------------------------------

  var state = { view: 'board', chain: 'All', slug: null };

  function readHash() {
    var raw = (location.hash || '').replace(/^#/, '');
    var out = { view: 'board', chain: 'All', slug: null };
    if (!raw) return out;
    raw.split('&').forEach(function (part) {
      var kv = part.split('=');
      var key = decodeURIComponent(kv[0] || '');
      var val = decodeURIComponent(kv[1] || '');
      if (key === 'p' && val) out.slug = val;
      if (key === 'chain' && val) out.chain = val;
      if (key === 'view' && (val === 'live' || val === 'board')) out.view = val;
    });
    return out;
  }

  function writeHash() {
    var bits = [];
    if (state.slug) bits.push('p=' + encodeURIComponent(state.slug));
    if (state.chain && state.chain !== 'All') bits.push('chain=' + encodeURIComponent(state.chain));
    if (state.view === 'live') bits.push('view=live');
    var next = bits.length ? '#' + bits.join('&') : '';
    if (location.hash !== next) {
      history.replaceState(null, '', next || location.pathname + location.search);
    }
  }

  // ------------------------------------------------------------------
  // Skeleton: header, controls, one table, one dialog.
  // ------------------------------------------------------------------

  board.innerHTML =
    '<header class="head">' +
      '<h1>Token Launch Radar</h1>' +
      '<p class="meta">Pre-token protocols ranked by implied launch value. ' +
      'Snapshot as of <strong>' + esc(DATA.as_of || '') + '</strong> · ' +
      'model <strong>' + esc(DATA.model_version || '') + '</strong> · ' +
      esc(DATA.board_size || rows.length) + ' pre-token protocols, ' +
      esc(DATA.live_size || live.length) + ' live for reference.</p>' +
      '<p class="meta dim">Implied value = TVL × category multiple × growth multiplier × ' +
      'maturity multiplier. It is an estimate from public multiples, not a price ' +
      'prediction and not financial advice.</p>' +
    '</header>' +
    '<div class="controls">' +
      '<div class="tabs" role="tablist">' +
        '<button type="button" class="tab" data-view="board" role="tab">Pre-token board</button>' +
        '<button type="button" class="tab" data-view="live" role="tab">Live tokens</button>' +
      '</div>' +
      '<label class="chainpick">Chain ' +
        '<select id="chain" aria-label="Filter by chain"></select>' +
      '</label>' +
      '<span class="count" aria-live="polite"></span>' +
    '</div>' +
    '<div class="tablewrap">' +
      '<table class="board">' +
        '<thead></thead>' +
        '<tbody></tbody>' +
      '</table>' +
      '<p class="empty" hidden>No protocols match this filter.</p>' +
    '</div>' +
    '<p class="foot">Source: ' + esc(DATA.source || '') + ' · ' +
    'floor TVL ' + dollars(DATA.floor_usd) + ' · ' +
    esc(DATA.watchlist_size || '') + ' watchlist protocols.</p>' +
    '<dialog class="dlg" id="detail">' +
      '<div class="dlg-body"></div>' +
      '<form method="dialog" class="dlg-actions"><button type="submit" class="close">Close</button></form>' +
    '</dialog>';

  var countEl = board.querySelector('.count');
  var chainSelect = board.querySelector('#chain');
  var table = board.querySelector('table.board');
  var thead = table.querySelector('thead');
  var tbody = table.querySelector('tbody');
  var emptyEl = board.querySelector('.empty');
  var dialog = board.querySelector('#detail');
  var dialogBody = dialog.querySelector('.dlg-body');

  chains.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    chainSelect.appendChild(opt);
  });
  var allOpt = document.createElement('option');
  allOpt.value = 'All';
  allOpt.textContent = 'All chains';
  chainSelect.insertBefore(allOpt, chainSelect.firstChild);

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  function visibleRows() {
    if (state.chain === 'All') return rows;
    return rows.filter(function (r) {
      return (r.chains || []).indexOf(state.chain) !== -1;
    });
  }

  function renderBoard() {
    var list = visibleRows();
    thead.innerHTML =
      '<tr><th class="num">#</th><th>Protocol</th><th>Category</th>' +
      '<th>Chains</th><th class="num">TVL</th><th class="num">7d</th>' +
      '<th class="num">Implied value</th><th class="num">Multiple</th><th>Watchlist</th></tr>';
    tbody.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + '</td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td>' + chainLabel(r.chains) + '</td>' +
        '<td class="num">' + compactDollars(r.tvl_usd) + '</td>' +
        '<td class="num ' + changeClass(r.change_7d) + '">' + change(r.change_7d) + '</td>' +
        '<td class="num strong">' + dollars(r.implied_value_usd) + '</td>' +
        '<td class="num">' + multiple(r.category_multiple) + '</td>' +
        '<td>' + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</td>' +
      '</tr>';
    }).join('');
    emptyEl.hidden = list.length > 0;
    countEl.textContent = list.length + ' protocol' + (list.length === 1 ? '' : 's') +
      (state.chain !== 'All' ? ' · ' + state.chain : '');
  }

  function renderLive() {
    thead.innerHTML =
      '<tr><th class="num">#</th><th>Protocol</th><th>Category</th>' +
      '<th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th>' +
      '<th class="num">7d</th></tr>';
    tbody.innerHTML = live.map(function (r, i) {
      return '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="name">' + esc(r.name) + '</td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td>' + chainLabel(r.chains) + '</td>' +
        '<td class="num">' + compactDollars(r.tvl_usd) + '</td>' +
        '<td class="num">' + dollars(r.mcap_usd) + '</td>' +
        '<td class="num ' + changeClass(r.change_7d) + '">' + change(r.change_7d) + '</td>' +
      '</tr>';
    }).join('');
    emptyEl.hidden = live.length > 0;
    countEl.textContent = live.length + ' live-token protocols (reference set)';
  }

  function render() {
    board.querySelectorAll('.tab').forEach(function (btn) {
      var active = btn.getAttribute('data-view') === state.view;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    chainSelect.value = chains.indexOf(state.chain) !== -1 ? state.chain : 'All';
    if (state.view === 'live') renderLive();
    else renderBoard();
    board.setAttribute('aria-busy', 'false');
  }

  // ------------------------------------------------------------------
  // Detail dialog
  // ------------------------------------------------------------------

  function comparablesFor(row) {
    var entry = byCategory[row.category];
    if (!entry) return null;
    return entry;
  }

  function openDetail(slug) {
    var row = null;
    rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.slug = slug;

    var entry = comparablesFor(row);
    var step1 = row.tvl_usd * row.category_multiple;
    var step2 = step1 * row.growth_multiplier;
    var step3 = step2 * row.maturity_multiplier;

    var compHtml = '';
    if (entry && entry.top && entry.top.length) {
      compHtml = '<h3>Category comparables — ' + esc(row.category) + '</h3>' +
        '<p class="dim">Median mcap/TVL of live-token protocols in this category: ' +
        '<strong>' + multiple(entry.multiple) + '</strong> from ' + entry.n +
        ' comparable' + (entry.n === 1 ? '' : 's') + '.' +
        (entry.n < 3
          ? ' Fewer than 3 comparables, so the board falls back to the overall median ' +
            multiple(overallMultiple) + '.'
          : '') + '</p>' +
        '<ul class="comp">' +
        entry.top.map(function (c) {
          var ratio = c.tvl_usd ? (c.mcap_usd / c.tvl_usd) : null;
          return '<li><span class="comp-name">' + esc(c.name) + '</span>' +
            '<span class="comp-nums">mcap ' + dollars(c.mcap_usd) +
            ' · TVL ' + compactDollars(c.tvl_usd) +
            ' · mcap/TVL ' + (ratio == null ? '—' : ratio.toFixed(4)) + '</span></li>';
        }).join('') +
        '</ul>';
    } else {
      compHtml = '<h3>Category comparables</h3>' +
        '<p class="dim">No live-token comparables in this category; the board uses the ' +
        'overall median multiple ' + multiple(overallMultiple) + '.</p>';
    }

    dialogBody.innerHTML =
      '<h2>' + esc(row.name) +
        (row.watchlist ? ' <span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<p class="dim">' + esc(row.category) + ' · ' + esc((row.chains || []).join(', ')) +
      ' · listed ' + esc(row.listed_at || '—') +
      (row.age_days != null ? ' (' + row.age_days + ' days)' : '') + '</p>' +
      '<h3>Implied value</h3>' +
      '<table class="breakdown">' +
        '<tr><th>TVL</th><td class="num">' + dollars(row.tvl_usd) + '</td></tr>' +
        '<tr><th>× category multiple</th><td class="num">' + multiple(row.category_multiple) + '</td></tr>' +
        '<tr><th>= after multiple</th><td class="num">' + dollars(step1) + '</td></tr>' +
        '<tr><th>× growth multiplier</th><td class="num">' + multiple(row.growth_multiplier) + '</td></tr>' +
        '<tr><th>= after growth</th><td class="num">' + dollars(step2) + '</td></tr>' +
        '<tr><th>× maturity multiplier</th><td class="num">' + multiple(row.maturity_multiplier) + '</td></tr>' +
        '<tr><th>Implied value</th><td class="num strong">' + dollars(row.implied_value_usd) + '</td></tr>' +
      '</table>' +
      '<p class="dim">Step product ' + dollars(step3) + ' matches the stored implied value ' +
      'within rounding of the stored multipliers.</p>' +
      compHtml +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' +
      (row.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    if (!dialog.open) dialog.showModal();
  }

  dialog.addEventListener('close', function () {
    if (state.slug) {
      state.slug = null;
      writeHash();
    }
  });

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------

  tbody.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    state.slug = tr.getAttribute('data-slug');
    writeHash();
    openDetail(state.slug);
  });

  tbody.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    ev.preventDefault();
    state.slug = tr.getAttribute('data-slug');
    writeHash();
    openDetail(state.slug);
  });

  chainSelect.addEventListener('change', function () {
    state.chain = chainSelect.value;
    state.view = 'board';
    writeHash();
    render();
  });

  board.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.view = btn.getAttribute('data-view');
      writeHash();
      render();
    });
  });

  window.addEventListener('hashchange', function () {
    var next = readHash();
    state.view = next.view;
    state.chain = next.chain;
    state.slug = next.slug;
    render();
    if (state.slug) openDetail(state.slug);
    else if (dialog.open) dialog.close();
  });

  // ------------------------------------------------------------------
  // Boot from the hash so #p=<slug> and #chain=<name> deep-link.
  // ------------------------------------------------------------------

  var boot = readHash();
  state.view = boot.view;
  state.chain = boot.chain;
  state.slug = boot.slug;
  render();
  if (state.slug) openDetail(state.slug);
})();
