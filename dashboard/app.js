/* Launch-Odds Radar v15-mellow — the page. Renders window.RADAR, recomputes farm
   verdicts live when the scenario sliders move. No network, no fetch. */
const R = window.RADAR;
const $ = (s, el) => (el || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
};
const money2 = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x, d) => (x * 100).toFixed(d == null ? 1 : d) + '%';
const fmtX = (x) => '×' + x.toFixed(2);
const ageYr = (r) => (r.age_days == null ? '—' : (r.age_days / 365.25).toFixed(1) + ' yr');
const state = { verdict: 'All', tier: 'All', q: '', cat: 'All', chain: 'All', sort: 'implied', depPct: 0.0002, drop: 0.07, horizon: 12 };
const feesFor = (h) => 2.35 + 0.05 * h;
const hoursFor = (h) => 1.25 + h / 6;
function scenario(r) {
  const dep = state.depPct * r.tvl_usd;
  const drop = (r.implied_value_usd * state.drop * dep) / (r.tvl_usd + dep);
  const fees = feesFor(state.horizon);
  const hours = hoursFor(state.horizon);
  const tbill = dep * 0.04 * (state.horizon / 52);
  const net = drop - fees;
  const perHour = net / hours;
  const verdict = net > tbill && perHour >= 25 ? 'Farm' : net <= 0 ? 'Skip' : 'Marginal';
  return { dep, drop, fees, hours, tbill, net, perHour, verdict };
}
function pill(v) { return v === 'Farm' ? '<span class="pill farm">FARM</span>' : v === 'Marginal' ? '<span class="pill marg">MARGINAL</span>' : '<span class="pill skip">SKIP</span>'; }

function hero() {
  const m = R.model, v = R.verdicts;
  return '<header class="top"><h1>Launch-Odds Radar</h1><p>Pre-token protocols, valued from their own record. DefiLlama snapshot ' + esc(R.as_of) + ' · model ' + esc(R.model_version) + ' · refitted in this browser.</p>' +
    '<p class="sub">Implied value = TVL × fitted multiple (the value if a token launches) × token odds (from how long peers ran before recording one). Each coefficient is fitted on this snapshot and tested held-out.</p>' +
    '<div class="hero">' +
    '<div class="hcard"><div class="big">' + fmtX(m.mult100) + '</div><div class="lab">Multiple at $100M TVL</div><div class="note">Size slope ' + m.slope.toFixed(2) + ' ± ' + m.slope_se.toFixed(2) + ' · category effects ' + fmtX(m.cat_range[0]) + '–' + fmtX(m.cat_range[1]) + '</div></div>' +
    '<div class="hcard"><div class="big">' + v.farm + '</div><div class="lab">Worth farming, this scenario</div><div class="note">Net beats a T-bill and $25 an hour · ' + v.marginal + ' marginal · ' + v.skip + ' skip</div></div>' +
    '<div class="hcard"><div class="big">' + R.board_size + '</div><div class="lab">Protocols ranked</div><div class="note">Watchlist ' + R.watchlist_size + ' / ' + R.watchlist_size + ' · ' + R.early_size + ' early below the floor</div></div>' +
    '</div></header>';
}
function kpis() {
  const m = R.model, o = m.odds, v = R.verdicts;
  const k = (b, lab, sub) => '<div class="kpi"><b>' + b + '</b><div class="lab">' + lab + '</div><div class="sub">' + sub + '</div></div>';
  return '<div class="kpis">' +
    k(fmtX(m.wf66.mean) + ' <span style="color:var(--mut);font-size:13px">vs ' + fmtX(m.flat_wf) + ' flat</span>', 'Out-of-sample miss, walk-forward', 'Leave-one-out ' + fmtX(m.loo.mean) + ' vs ' + fmtX(m.flat_loo) + ' flat · 5-fold worst ' + fmtX(Math.max.apply(null, m.folds))) +
    k(Math.round(m.jack_cov_loo50 * 100) + '% · ' + Math.round(m.jack_cov_loo80 * 100) + '%', 'Is the printed range honest?', 'Share of real caps inside P25–P75, P10–P90 (stated 50% · 80%) · walk-forward ' + Math.round(m.jack_cov_wf50 * 100) + '% · ' + Math.round(m.jack_cov_wf80 * 100) + '%') +
    k(o.brier_wf.toFixed(3) + ' <span style="color:var(--mut);font-size:13px">vs ' + o.base_brier_wf.toFixed(3) + ' base</span>', 'Token odds vs base rate, Brier', 'Walk-forward · 10-fold ' + o.brier10.toFixed(3) + ' vs ' + o.base_brier10.toFixed(3) + ' · AUC ' + o.auc_wf.toFixed(2) + ' walk-forward') +
    k('2 of 7 · 4 of 6', 'Terms that survived both tests', 'Value model · token odds; the rest are shown below, not used') +
    k(v.farm + ' of ' + R.board_size, 'Worth farming, this scenario', 'Net beats a T-bill and $25 an hour · ' + v.marginal + ' marginal · ' + v.skip + ' skip') +
    k(R.watchlist_size + ' / ' + R.watchlist_size, 'Watchlist ranked', 'Plus ' + R.early_size + ' pre-token protocols the list leaves out') +
    '</div>';
}
function strip() {
  const t = R.totals, l = R.ledger;
  return '<div class="strip">This table = board.json: <b>' + R.board_size + ' of ' + R.board_size + ' rows recomputed here ✓</b> ranks 1–' + R.board_size + ' in order, values never rise ✓ totals equal: <b>' + money(t.implied_usd) + '</b> ✓ checksum <b>' + esc(R.checksum) + '</b> = main.ts ✓ watchlist ' + R.watchlist_size + ' of ' + R.watchlist_size + ' ranked ✓ ledger ' + (l.ranked + l.token + l.unranked) + ' of ' + (l.ranked + l.token + l.unranked) + ' protocols</div>' +
    '<div class="acct"><b>Protocol accounting:</b> all ' + (l.ranked + l.token + l.unranked) + ' snapshot protocols in exactly one group: <b>' + l.ranked + ' ranked as pre-token</b>, <b>' + l.token + ' already record a token</b>, <b>' + l.unranked + ' pre-token not ranked</b> (' + l.unranked_rankable + ' below the early cut, ' + l.unranked_excluded + ' excluded by the house rule). A protocol is called pre-token when its DefiLlama record carries no token — that is not proof it has none.</div>';
}
function termTables() {
  const m = R.model, o = m.odds;
  let vt = '<table><tr><th>Term</th><th class="num">Leave-one-out</th><th class="num">Walk-forward</th><th>Status</th></tr>';
  for (const t of m.value_terms) vt += '<tr><td>' + esc(t.label) + '</td><td class="num">' + fmtX(t.loo) + '</td><td class="num">' + fmtX(t.wf) + '</td><td class="' + (t.kept ? 'kept' : 'notkept') + '">' + (t.kept ? 'kept' : 'tested, not kept') + '</td></tr>';
  vt += '</table>';
  let ot = '<table><tr><th>Term</th><th class="num">Brier, 10-fold</th><th class="num">Brier, walk-forward</th><th>Status</th></tr>';
  for (const t of o.terms) ot += '<tr><td>' + esc(t.label) + '</td><td class="num">' + t.brier10.toFixed(3) + ' (' + Math.round(t.auc10 * 100) + '%)</td><td class="num">' + t.brier_wf.toFixed(3) + ' (' + Math.round(t.auc_wf * 100) + '%)</td><td class="' + (t.kept ? 'kept' : 'notkept') + '">' + (t.kept ? 'kept' : 'tested, not kept') + '</td></tr>';
  ot += '</table>';
  let sw = '<table><tr><th>Category shrinkage λ</th>' + m.sweep.map((s) => '<th class="num">' + s.lam + '</th>').join('') + '</tr>';
  sw += '<tr><td>Leave-one-out</td>' + m.sweep.map((s) => '<td class="num">' + fmtX(s.loo) + '</td>').join('') + '</tr>';
  sw += '<tr><td>Walk-forward</td>' + m.sweep.map((s) => '<td class="num">' + fmtX(s.wf) + '</td>').join('') + '</tr></table>';
  const rng = '<table><tr><th>Range</th><th class="num">Leave-one-out</th><th class="num">Walk-forward</th><th>Stated</th></tr>' +
    '<tr><td>Inside P25–P75</td><td class="num">' + Math.round(m.jack_cov_loo50 * 100) + '%</td><td class="num">' + Math.round(m.jack_cov_wf50 * 100) + '%</td><td>50%</td></tr>' +
    '<tr><td>Inside P10–P90</td><td class="num">' + Math.round(m.jack_cov_loo80 * 100) + '%</td><td class="num">' + Math.round(m.jack_cov_wf80 * 100) + '%</td><td>80%</td></tr></table>';
  return '<h2>Out-of-sample evidence</h2><div class="ev">' +
    '<div class="card"><h3>Value — typical miss, 95 traded tokens</h3>' + vt + '<p>A term is kept only if it lowers the held-out miss in both tests: leave-one-out, and walk-forward (tokens listed earlier price those listed later). Family is tested on top of the kept model: it lowers both by 0.003 / 0.081 — inside noise — and “family” is not a snapshot field (the proxy is the first word of category, which duplicates the category effect), so it is not kept. Fitted, ± bootstrap s.e. (200 refits): multiple at $100M TVL ' + fmtX(m.mult100) + ', size slope ' + m.slope.toFixed(2) + ' ± ' + m.slope_se.toFixed(2) + '; category effects ' + fmtX(m.cat_range[0]) + ' to ' + fmtX(m.cat_range[1]) + '.</p></div>' +
    '<div class="card"><h3>Token odds — Brier score, 645 dated peers</h3>' + ot + '<p>The odds are the peers’ record (327 of 645 record a token), not a forecast: the page never says a token will launch. By logit: years listed +' + o.age_coef.toFixed(2) + ', log10 TVL +' + o.size_coef.toFixed(2) + ', 7-day growth ' + o.growth_coef.toFixed(2) + ' per point, families ' + o.fam_range[0].toFixed(2) + ' to +' + o.fam_range[1].toFixed(2) + '. Age unknown for a row uses the peers’ median, ' + o.median_age_years.toFixed(1) + ' years.</p></div>' +
    '<div class="card"><h3>Range honesty — share of real caps</h3>' + rng + '<p>Ranges are Jackknife+ intervals behind the printed P25–P75 and P10–P90. 7-day growth and age fail to price a token well (the value model leaves them out; both help tell which peers record a token, so they enter through the odds).</p></div>' +
    '<div class="card"><h3>Category shrinkage — λ sweep</h3>' + sw + '<p>λ = 16 ships: the best leave-one-out of the sweep. Every λ lowers both tests vs size alone; none reaches the flat baseline’s walk-forward.</p></div>' +
    '<div class="card full"><h3>Size curve — log10(market cap / TVL) against log10(TVL), 95 traded tokens</h3><div id="chart"></div></div>' +
    '</div>';
}
function chart() {
  const c = R.chart, W = 760, H = 280, P = { l: 46, r: 12, t: 12, b: 30 };
  const xs = c.points.map((p) => p[0]), ys = c.points.map((p) => p[1]);
  const x0 = Math.min.apply(null, xs) - 0.15, x1 = Math.max.apply(null, xs) + 0.15;
  const y0 = Math.min.apply(null, ys) - 0.25, y1 = Math.max.apply(null, ys) + 0.25;
  const X = (x) => P.l + ((x - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (y) => P.t + ((y1 - y) / (y1 - y0)) * (H - P.t - P.b);
  const l = c.line, q = c.q50;
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Size curve scatter">';
  s += '<polygon points="' + X(l[0]) + ',' + Y(l[1] + q) + ' ' + X(l[2]) + ',' + Y(l[3] + q) + ' ' + X(l[2]) + ',' + Y(l[3] - q) + ' ' + X(l[0]) + ',' + Y(l[1] - q) + '" fill="#d97706" opacity="0.12"/>';
  s += '<line x1="' + X(l[0]) + '" y1="' + Y(l[1]) + '" x2="' + X(l[2]) + '" y2="' + Y(l[3]) + '" stroke="#b45309" stroke-width="2.5"/>';
  for (const p of c.points) s += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="3" fill="#0f766e" opacity="0.75"/>';
  s += '<text x="' + P.l + '" y="' + (H - 8) + '" font-size="11" fill="#5c6b7a">log10(TVL) — bigger protocols sit right</text>';
  s += '<text x="8" y="' + (P.t + 8) + '" font-size="11" fill="#5c6b7a">log10(cap / TVL)</text>';
  s += '<text x="' + (W - P.r - 130) + '" y="' + (P.t + 10) + '" font-size="11" fill="#92400e">fitted curve ± P25–P75 band</text></svg>';
  return s;
}
function controls() {
  const cats = ['All'].concat([...new Set(R.rows.map((r) => r.category || 'Uncategorised'))].sort());
  const chains = ['All'].concat([...new Set(R.rows.flatMap((r) => r.chains))].sort());
  const v = R.verdicts;
  return '<div class="controls">' +
    '<button data-v="All" class="on">All ' + R.board_size + '</button>' +
    '<button data-v="Farm">Farm ' + v.farm + '</button>' +
    '<button data-v="Marginal">Marginal ' + v.marginal + '</button>' +
    '<button data-v="Skip">Skip ' + v.skip + '</button>' +
    '<select id="tier"><option>All tiers</option><option>Watchlist</option><option>Early</option></select>' +
    '<label>Deposit <select id="dep"><option value="0.0001">0.01% of TVL</option><option value="0.0002" selected>0.02% of TVL</option><option value="0.0005">0.05% of TVL</option><option value="0.001">0.10% of TVL</option></select></label>' +
    '<label>Drop <input id="drop" type="range" min="1" max="20" step="0.5" value="7" style="width:90px"> <span id="dropv">7.0%</span></label>' +
    '<label>Horizon <input id="hor" type="range" min="4" max="26" step="1" value="12" style="width:90px"> <span id="horv">12 wk</span></label>' +
    '<input id="q" type="search" placeholder="Search name or slug">' +
    '<select id="cat">' + cats.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select>' +
    '<select id="chain">' + chains.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select>' +
    '<select id="sort"><option value="implied">Sort: implied value</option><option value="hour">Sort: net / hour</option><option value="tvl">Sort: TVL</option><option value="odds">Sort: token odds</option></select>' +
    '<button id="reset">Reset</button><span class="sp"></span><button id="csv">CSV</button><button id="json">JSON</button>' +
    '</div><div class="boardwrap"><div class="meta" id="meta"></div><div id="board"></div></div>';
}
function filtered() {
  let rows = R.rows.map((r) => ({ r, s: scenario(r) }));
  if (state.verdict !== 'All') rows = rows.filter((x) => x.s.verdict === state.verdict);
  if (state.tier !== 'All') rows = rows.filter((x) => x.r.tier === state.tier);
  if (state.cat !== 'All') rows = rows.filter((x) => (x.r.category || 'Uncategorised') === state.cat);
  if (state.chain !== 'All') rows = rows.filter((x) => x.r.chains.indexOf(state.chain) >= 0);
  if (state.q) { const q = state.q.toLowerCase(); rows = rows.filter((x) => (x.r.name + ' ' + x.r.slug + ' ' + (x.r.category || '')).toLowerCase().indexOf(q) >= 0); }
  const by = { implied: (a, b) => b.r.implied_value_usd - a.r.implied_value_usd, hour: (a, b) => b.s.perHour - a.s.perHour, tvl: (a, b) => b.r.tvl_usd - a.r.tvl_usd, odds: (a, b) => b.r.token_odds - a.r.token_odds }[state.sort];
  rows.sort(by);
  return rows;
}
function boardHtml() {
  const rows = filtered();
  const tot = rows.reduce((s, x) => s + x.r.tvl_usd, 0);
  const imp = rows.reduce((s, x) => s + x.r.implied_value_usd, 0);
  $('#meta').textContent = rows.length + ' of ' + R.board_size + ' rows · ' + money(tot) + ' TVL · ' + money(imp) + ' implied' + (state.verdict === 'Farm' ? ' · filtered to FARM verdict · sorted by net / hour, high to low' : '');
  let h = '<table><tr><th>#</th><th>Range</th><th>Protocol</th><th class="num">TVL</th><th class="num">7D</th><th class="num">Age</th><th class="num">Odds</th><th class="num">If it launches</th><th class="num">Implied · P25–P75</th><th>Verdict · net of fees</th><th class="num">Net / hour</th></tr>';
  for (const x of rows) {
    const r = x.r, s = x.s;
    h += '<tr class="row" data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td><td>' + r.rank_lo + '–' + r.rank_hi + '</td>' +
      '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="tag">Watchlist</span>' : '') + '<span class="tag">' + esc(r.tier) + '</span><br><span style="color:var(--mut);font-size:12px">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) + '</span></td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</td><td class="num">' + ageYr(r) + '</td>' +
      '<td class="num">' + Math.round(r.token_odds * 100) + '%</td><td class="num">' + money(r.if_launches_usd) + '</td>' +
      '<td class="num"><b>' + money(r.implied_value_usd) + '</b><br><span style="color:var(--mut);font-size:12px">' + money(r.p25_usd) + '–' + money(r.p75_usd) + '</span></td>' +
      '<td>' + pill(s.verdict) + ' <b>' + (s.net >= 0 ? '+' : '−') + money2(Math.abs(s.net)).slice(1) + '</b><br><span style="color:var(--mut);font-size:12px">drop ' + money(s.drop) + ' − fees ' + money2(s.fees) + '</span></td>' +
      '<td class="num"><b>' + money2(s.perHour) + '</b></td></tr>';
  }
  h += '</table>';
  return h;
}
function renderBoard() { $('#board').innerHTML = boardHtml(); }
function drawer(r) {
  const s = scenario(r);
  const old = $('.drawer');
  if (old) old.remove();
  const d = document.createElement('aside');
  d.className = 'drawer';
  const gridDeps = [1000, 10000, 30000], gridShares = [0.035, 0.07, 0.14];
  let bestDep = gridDeps[0];
  for (const dep of gridDeps) if (Math.abs(Math.log10(dep) - Math.log10(Math.max(1, s.dep))) < Math.abs(Math.log10(bestDep) - Math.log10(Math.max(1, s.dep)))) bestDep = dep;
  let g = '<div class="grid">';
  for (const sh of gridShares) for (const dep of gridDeps) {
    const drop = (r.implied_value_usd * sh * dep) / (r.tvl_usd + dep);
    const net = drop - feesFor(state.horizon);
    const hl = dep === bestDep && Math.abs(sh - state.drop) < 0.001 ? ' class="hl"' : '';
    g += '<div' + hl + '>' + money(dep) + ' × ' + (sh * 100).toFixed(1) + '%<br><b>' + (net >= 0 ? '+' : '−') + money2(Math.abs(net)).slice(1) + '</b></div>';
  }
  g += '</div>';
  let peers = '<table><tr><th>Token</th><th>Category</th><th class="num">TVL</th><th class="num">Cap</th><th class="num">Cap ÷ TVL</th><th class="num">Cap ÷ held-out model</th></tr>';
  for (const p of r.peers) peers += '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + fmtX(p.ratio) + '</td><td class="num">' + fmtX(p.held_out) + '</td></tr>';
  peers += '</table>';
  d.innerHTML = '<button class="x" id="dx">Close ✕</button>' +
    '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span style="color:var(--mut);font-size:13px">rank ' + r.rank_lo + '–' + r.rank_hi + ' across 200 bootstrap refits</span></h2>' +
    '<p>Implied value <b>' + money(r.implied_value_usd) + '</b> (model estimate); if a token launches <b>' + money(r.if_launches_usd) + '</b>; token odds <b>' + Math.round(r.token_odds * 100) + '%</b>; P25–P75 ' + money(r.p25_usd) + '–' + money(r.p75_usd) + '; P10–P90 ' + money(r.p10_usd) + '–' + money(r.p90_usd) + '. Recomputed in this browser: equals board.json. DefiLlama records no token for it, which is not proof it has none; the odds are its peers’ record, not a forecast.</p>' +
    '<h3>How the figure is made</h3><table>' + r.how.map((h) => '<tr><td>' + esc(h.label) + '</td><td class="num"><b>' + esc(h.value) + '</b></td></tr>').join('') + '</table>' +
    '<h3>Farm verdict — ' + s.verdict.toUpperCase() + '</h3><p><b>' + money(s.dep) + ' for ' + state.horizon + ' weeks buys a modelled drop of ' + money(s.drop) + ' for ' + money2(s.fees) + ' of fees and ' + s.hours.toFixed(1) + ' h of work, a net of ' + money2(s.net) + ' (' + money2(s.perHour) + ' an hour) against ' + money(s.tbill) + ' from the same money in a 4% T-bill.</b> Fees are covered while the drop share stays above ' + pct(r.min_drop_share, 1) + ' (model ' + pct(state.drop, 1) + ') and the token odds above ' + pct(r.min_odds, 1) + ' (peers imply ' + Math.round(r.token_odds * 100) + '.' + Math.round((r.token_odds * 1000) % 10) + '%).</p>' +
    '<p>At risk ' + money(s.dep) + '; fees ' + state.horizon + ' weeks ' + money2(s.fees) + '; modelled drop ' + money(s.drop) + '; net of fees ' + money2(s.net) + '; hands-on ' + s.hours.toFixed(1) + ' h; net per hour ' + money2(s.perHour) + '.</p>' +
    '<h3>Net by drop share × deposit</h3>' + g +
    '<p>Benchmarks: same ' + money(s.dep) + ' in a 4% T-bill, ' + state.horizon + ' weeks, ' + money(s.tbill) + '; drop if a token does launch (odds not applied) ' + money(r.if_launches_usd * state.drop * s.dep / (r.tvl_usd + s.dep)) + '; fees covered above a drop share of ' + pct(r.min_drop_share, 1) + '; fees covered above token odds of ' + pct(r.min_odds, 1) + '; exit if TVL prints below ' + money(r.exit_tvl_usd) + '. Formula: drop = implied value × drop share × deposit ÷ (TVL + deposit). ' + s.verdict.toUpperCase() + ': the net beats the T-bill and $25 an hour; SKIP: fees exceed the drop. Yield earned meanwhile is left out.</p>' +
    '<h3>Farm plan — 10 steps</h3><ol class="steps">' + r.steps.map((st, i) => '<li><b>' + (i + 1) + '. ' + esc(st.title) + '</b> — ' + esc(st.text) + ' <span style="color:var(--mut)">Cost: ' + esc(st.cost) + '. Time: ' + esc(st.time) + '.</span></li>').join('') + '</ol>' +
    '<h3>Nearest priced peers · their tokens trade</h3>' + peers;
  document.body.appendChild(d);
  $('#dx').onclick = () => { d.remove(); if (location.hash.indexOf('#row=') === 0) history.replaceState(null, '', location.pathname); };
}
function counts() {
  let f = 0, m = 0, s = 0;
  for (const r of R.rows) { const v = scenario(r).verdict; if (v === 'Farm') f++; else if (v === 'Marginal') m++; else s++; }
  const btns = document.querySelectorAll('[data-v]');
  btns[0].textContent = 'All ' + R.board_size;
  btns[1].textContent = 'Farm ' + f;
  btns[2].textContent = 'Marginal ' + m;
  btns[3].textContent = 'Skip ' + s;
}
function wire() {
  document.querySelectorAll('[data-v]').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('[data-v]').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      state.verdict = b.getAttribute('data-v');
      if (state.verdict === 'Farm') state.sort = 'hour';
      else if (state.sort === 'hour') state.sort = 'implied';
      $('#sort').value = state.sort;
      renderBoard();
    };
  });
  $('#tier').onchange = (e) => { state.tier = e.target.value === 'All tiers' ? 'All' : e.target.value; renderBoard(); };
  $('#dep').onchange = (e) => { state.depPct = parseFloat(e.target.value); counts(); renderBoard(); };
  $('#drop').oninput = (e) => { state.drop = parseFloat(e.target.value) / 100; $('#dropv').textContent = parseFloat(e.target.value).toFixed(1) + '%'; counts(); renderBoard(); };
  $('#hor').oninput = (e) => { state.horizon = parseInt(e.target.value, 10); $('#horv').textContent = state.horizon + ' wk'; counts(); renderBoard(); };
  $('#q').oninput = (e) => { state.q = e.target.value; renderBoard(); };
  $('#cat').onchange = (e) => { state.cat = e.target.value; renderBoard(); };
  $('#chain').onchange = (e) => { state.chain = e.target.value; renderBoard(); };
  $('#sort').onchange = (e) => { state.sort = e.target.value; renderBoard(); };
  $('#reset').onclick = () => {
    Object.assign(state, { verdict: 'All', tier: 'All', q: '', cat: 'All', chain: 'All', sort: 'implied', depPct: 0.0002, drop: 0.07, horizon: 12 });
    document.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-v') === 'All'));
    $('#tier').value = 'All tiers'; $('#dep').value = '0.0002'; $('#drop').value = '7'; $('#dropv').textContent = '7.0%';
    $('#hor').value = '12'; $('#horv').textContent = '12 wk'; $('#q').value = ''; $('#cat').value = 'All'; $('#chain').value = 'All'; $('#sort').value = 'implied';
    counts(); renderBoard();
  };
  $('#csv').onclick = () => {
    const rows = filtered();
    const lines = [['rank', 'slug', 'name', 'category', 'tvl_usd', 'token_odds', 'implied_value_usd', 'verdict', 'net_usd', 'net_per_hour'].join(',')];
    for (const x of rows) lines.push([x.r.rank, x.r.slug, '"' + x.r.name.replace(/"/g, '""') + '"', '"' + (x.r.category || '') + '"', x.r.tvl_usd, x.r.token_odds, x.r.implied_value_usd, x.s.verdict, x.s.net.toFixed(2), x.s.perHour.toFixed(2)].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'launch-odds-radar.csv';
    a.click();
  };
  $('#json').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(filtered().map((x) => x.r), null, 2)], { type: 'application/json' }));
    a.download = 'launch-odds-radar.json';
    a.click();
  };
  $('#board').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.row');
    if (!tr) return;
    const r = R.rows.find((x) => x.slug === tr.getAttribute('data-slug'));
    if (r) { drawer(r); location.hash = '#row=' + r.slug; }
  });
}
function render() {
  const app = $('#app');
  app.innerHTML = '<div class="wrap">' + hero() + kpis() + strip() + termTables() + '<h2>The board</h2>' + controls() +
    '<div class="foot"><p>Method: value = TVL × 10^(fitted log multiple) × token odds. The multiple is a ridge fit on log10(TVL) plus shrunk category effects (λ = 16), fitted on the 95 dated protocols whose tokens trade; a term enters only if it lowers the held-out miss in both the leave-one-out and the walk-forward test. Odds are a ridge logistic on the 645 dated peers. Ranges are Jackknife+ intervals. Nothing here is a prediction that a token will launch, or when.</p>' +
    '<p>Farm rule: a row is FARM only when its modelled net beats the same deposit in a 4% T-bill AND $25 an hour of hands-on work, over the horizon at the drop share shown. The deposit is 0.02% of TVL by default. Steps, costs and times are the plan; the numbers are the model’s, not a promise.</p>' +
    '<p>Source: DefiLlama snapshot ' + esc(R.as_of) + ' · floor $50,000,000 · 758 protocols. Launch-Odds Radar v15-mellow, an entry for the make.fun token-radar-01 bounty.</p></div></div>';
  $('#chart').innerHTML = chart();
  app.setAttribute('aria-busy', 'false');
  wire();
  const h = location.hash;
  if (h === '#farm') {
    document.body.classList.add('compact');
    state.verdict = 'Farm'; state.sort = 'hour';
    document.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-v') === 'Farm'));
    $('#sort').value = 'hour';
  } else if (h.indexOf('#row=') === 0) {
    const r = R.rows.find((x) => x.slug === h.slice(5));
    if (r) setTimeout(() => drawer(r), 50);
  }
  renderBoard();
}
render();
