import {
  DEFAULT_INPUTS, STAMP_DUTY_DEFAULTS, LAND_TAX_RECOVERABLE_DEFAULTS, LEASE_TYPE_RECOVERY_RATE,
  SCENARIO_OVERLAYS, SIMPLE_SCENARIO_FACTORS, deriveEntryCapRate, computeAll, computeSensitivityGrid,
  computePortfolioSplit, computeSimpleProjection, applySimpleStressFactor, deriveExitAtYear, compoundGrowth,
  generateAdvice, generatePortfolioRecommendations,
  fmtMoney, fmtPct, fmtX,
} from './calc.mjs';
import { equityChart, cashFlowChart, sensitivityGrid, breakEvenBar, portfolioBar } from './charts.js';

// ---------------------------------------------------------------------------
// State — a single object, mutated through dispatch(), matching the spec's
// "state lives in a single reducer" requirement without needing a framework.
// ---------------------------------------------------------------------------

const state = {
  ...DEFAULT_INPUTS,
  exitCapRate: deriveEntryCapRate(DEFAULT_INPUTS),
  exitCapRateTouched: false,
  adviceExpanded: false,
  portfolioMetric: 'cashOnCash',
  simpleScenario: 'predicted',
};

const PCT_DECIMALS = {
  lvr: 0, interestRate: 2, netYield: 1, grossYield: 1, outgoingsPctOfRent: 1,
  outgoingsRecoveryRate: 0, managementFeePct: 1, capexReservePct: 1, structuralVacancyRate: 1,
  stampDutyPct: 2, legalAndOtherPct: 2, rentGrowth: 1, outgoingsInflation: 1,
  exitCapRate: 3, sellingCostPct: 1, bankRate: 1,
};

function pct(key, v) {
  const d = PCT_DECIMALS[key] ?? 1;
  return `${(v * 100).toFixed(d)}%`;
}

// ---------------------------------------------------------------------------
// Dispatch: apply a partial state patch, run Australian-rule side effects,
// then re-render. Every input change funnels through here.
// ---------------------------------------------------------------------------

function dispatch(patch, opts = {}) {
  Object.assign(state, patch);
  applySideEffects(patch, opts);
  syncInputsFromState();
  render();
}

function applySideEffects(patch) {
  if ('state' in patch) {
    state.stampDutyPct = STAMP_DUTY_DEFAULTS[state.state];
    state.landTaxRecoverable = LAND_TAX_RECOVERABLE_DEFAULTS[state.state];
    clampRecoveryForLandTax(true);
  }
  if ('leaseType' in patch) {
    state.outgoingsRecoveryRate = LEASE_TYPE_RECOVERY_RATE[state.leaseType];
    clampRecoveryForLandTax(false);
  }
  if ('landTaxRecoverable' in patch) {
    clampRecoveryForLandTax(true);
  }
  if ('outgoingsRecoveryRate' in patch) {
    clampRecoveryForLandTax(false);
  }

  if (('exitCapRate' in patch) && patch.__fromSlider) {
    state.exitCapRateTouched = true;
  }
  const affectsEntryCap = ['mode', 'netYield', 'grossYield', 'outgoingsPctOfRent'].some((k) => k in patch);
  if (affectsEntryCap && !state.exitCapRateTouched) {
    state.exitCapRate = deriveEntryCapRate(state);
  }

  state._recoveryClampedNote = state._pendingClampNote || null;
  state._pendingClampNote = null;
}

let clampNoteTimeout = null;
function clampRecoveryForLandTax(fromLandTaxChange) {
  if (state.landTaxRecoverable === false && state.outgoingsRecoveryRate > 0.85) {
    state.outgoingsRecoveryRate = 0.85;
    state._pendingClampNote = 'Outgoings recovery rate was capped at 85% — land tax isn’t recoverable from retail tenants in this state.';
  }
}

// ---------------------------------------------------------------------------
// Input binding
// ---------------------------------------------------------------------------

const NUMERIC_IDS = ['cash', 'loanTermYears', 'facilityReviewYears', 'numberOfAssets', 'tenantsPerAsset', 'dueDiligenceCostPerAsset'];
const PERCENT_SLIDER_IDS = Object.keys(PCT_DECIMALS);
const SELECT_IDS = ['repaymentType', 'state', 'leaseType'];
const CHECKBOX_IDS = ['landTaxRecoverable', 'retailTenancy'];

const CASH_SLIDER_MIN = 100_000;
const CASH_SLIDER_MAX = 10_000_000;

function bindInputs() {
  for (const id of NUMERIC_IDS) {
    document.getElementById(id).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      dispatch({ [id]: isFinite(v) ? v : 0 });
    });
  }
  document.getElementById('cashSlider').addEventListener('input', (e) => {
    dispatch({ cash: Number(e.target.value) });
  });
  for (const id of PERCENT_SLIDER_IDS) {
    document.getElementById(id).addEventListener('input', (e) => {
      dispatch({ [id]: Number(e.target.value), __fromSlider: id === 'exitCapRate' });
    });
  }
  for (const id of SELECT_IDS) {
    document.getElementById(id).addEventListener('change', (e) => {
      dispatch({ [id]: e.target.value });
    });
  }
  for (const id of CHECKBOX_IDS) {
    document.getElementById(id).addEventListener('change', (e) => {
      dispatch({ [id]: e.target.checked });
    });
  }

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      document.querySelectorAll('.simple-only').forEach((el) => { el.hidden = btn.dataset.mode !== 'simple'; });
      document.querySelectorAll('.advanced-only').forEach((el) => { el.hidden = btn.dataset.mode !== 'advanced'; });
      dispatch({ mode: btn.dataset.mode });
    });
  });

  document.querySelectorAll('.accordion-head').forEach((head) => {
    head.addEventListener('click', () => {
      const acc = head.closest('.accordion');
      acc.dataset.open = acc.dataset.open === 'true' ? 'false' : 'true';
    });
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    Object.assign(state, DEFAULT_INPUTS, {
      exitCapRate: deriveEntryCapRate(DEFAULT_INPUTS), exitCapRateTouched: false,
      adviceExpanded: false, portfolioMetric: 'cashOnCash', simpleScenario: 'predicted',
    });
    document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    document.querySelectorAll('.simple-only').forEach((el) => { el.hidden = state.mode !== 'simple'; });
    document.querySelectorAll('.advanced-only').forEach((el) => { el.hidden = state.mode !== 'advanced'; });
    document.querySelectorAll('#simpleScenarioToggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scenario === 'predicted')));
    syncInputsFromState();
    render();
  });

  document.getElementById('showAllAdvice').addEventListener('click', () => {
    state.adviceExpanded = true;
    render();
  });

  document.querySelectorAll('#portfolioMetricToggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#portfolioMetricToggle button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.portfolioMetric = btn.dataset.metric;
      renderPortfolio(lastResults);
    });
  });

  document.querySelectorAll('#simpleScenarioToggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#simpleScenarioToggle button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      state.simpleScenario = btn.dataset.scenario;
      render();
    });
  });
}

function syncInputsFromState() {
  for (const id of NUMERIC_IDS) document.getElementById(id).value = state[id];
  document.getElementById('cashSlider').value = Math.min(CASH_SLIDER_MAX, Math.max(CASH_SLIDER_MIN, state.cash));
  for (const id of PERCENT_SLIDER_IDS) {
    const el = document.getElementById(id);
    el.value = state[id];
    const label = document.getElementById(id + 'Val');
    if (label) label.textContent = pct(id, state[id]);
  }
  document.getElementById('repaymentType').value = state.repaymentType;
  document.getElementById('state').value = state.state;
  document.getElementById('leaseType').value = state.leaseType;
  document.getElementById('landTaxRecoverable').checked = state.landTaxRecoverable;
  document.getElementById('retailTenancy').checked = state.retailTenancy;

  document.getElementById('holdYearsVal').textContent = `${state.holdYears} year${state.holdYears === 1 ? '' : 's'}`;
  document.getElementById('holdYearsHint').hidden = state.holdYears >= 5;
  document.getElementById('retailHint').hidden = !state.retailTenancy;

  const leaseHints = {
    gross: 'Landlord absorbs outgoings.',
    net: 'Tenant recovers most outgoings; structural, capital and (in some states) land tax stay with the landlord.',
    'triple-net': 'A true triple-net structure — where structural repairs, capital works and land tax all shift to the tenant — is generally only achievable in QLD, SA, WA, ACT and NT, and is rare in multi-tenant buildings.',
  };
  document.getElementById('leaseTypeHint').textContent = leaseHints[state.leaseType];

  document.getElementById('landTaxHint').textContent = state.landTaxRecoverable
    ? 'Land tax can generally be recovered from retail tenants in this state.'
    : `Land tax generally can't be recovered from retail tenants in ${state.state}. Recovery rate is capped at 85%.`;

  const entryCap = deriveEntryCapRate(state);
  const deltaBp = Math.round((state.exitCapRate - entryCap) * 10000);
  const deltaEl = document.getElementById('exitCapDeltaHint');
  deltaEl.textContent = deltaBp === 0
    ? 'Matches entry cap rate.'
    : `${deltaBp > 0 ? '+' : ''}${deltaBp}bp vs entry cap rate (${pct('exitCapRate', entryCap)}).`;
  deltaEl.className = 'hint ' + (deltaBp < 0 ? 'warning' : '');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let lastResults = null;
let sensitivityDebounceHandle = null;

function render() {
  const results = computeAll(state);
  lastResults = results;

  const errorBanner = document.getElementById('errorBanner');
  const heroSection = document.getElementById('heroMetric');
  const advancedSection = document.getElementById('advancedAnalysis');
  const bodySections = [
    'simpleScenarioToggle', 'simpleCashFlowChartWrap', 'sellSummaryWrap', 'advicePanel',
    'breakEvenChartWrap', 'portfolioModule', 'assumptionsSummary',
  ];

  if (results.error) {
    errorBanner.hidden = false;
    errorBanner.textContent = results.error === 'CASH_BELOW_FIXED_COSTS'
      ? `Your cash doesn't cover the fixed due-diligence costs for ${state.numberOfAssets} asset(s) (${fmtMoney(state.dueDiligenceCostPerAsset * state.numberOfAssets)}). Reduce the number of assets or increase your cash.`
      : 'This LVR and cost combination is not viable — reduce LVR or acquisition cost assumptions.';
    heroSection.hidden = true;
    advancedSection.hidden = true;
    bodySections.forEach((id) => { document.getElementById(id).closest('section').hidden = true; });
    updateMobileSummary(null);
    return;
  }

  errorBanner.hidden = true;
  heroSection.hidden = false;
  advancedSection.hidden = state.mode !== 'advanced';
  bodySections.forEach((id) => { const s = document.getElementById(id).closest('section'); if (s) s.hidden = false; });

  const simpleYears = applySimpleStressFactor(
    computeSimpleProjection(state, results.purchase, results.financials, 10),
    SIMPLE_SCENARIO_FACTORS[state.simpleScenario]
  );

  renderHero(results);
  renderSimpleCashFlow(simpleYears);
  renderSellSummary(simpleYears);
  renderAdvice(results);
  renderBreakEvenChart(results);
  renderPortfolio(results);
  renderAssumptions(results);
  updateMobileSummary(results);

  if (state.mode === 'advanced') {
    renderScenarioKey();
    renderMetricStrip(results);
    renderEquityChart(results);
    renderExitSummary(results);
    renderCashFlowChart(results);
    scheduleSensitivityRender(results);
  }
}

function updateMobileSummary(results) {
  document.getElementById('msPrice').textContent = results ? fmtMoney(results.purchase.totalPrice) : '—';
  document.getElementById('msCoC').textContent = results ? fmtPct(results.core.cashOnCash) : '—';
  document.getElementById('msICR').textContent = results ? fmtX(results.core.ICR) : '—';
}

function renderHero(results) {
  document.getElementById('heroPrice').textContent = fmtMoney(results.purchase.totalPrice);
  const perAsset = state.numberOfAssets > 1 ? ` · ${fmtMoney(results.purchase.pricePerAsset)} per asset across ${state.numberOfAssets}` : '';
  document.getElementById('heroSub').textContent =
    `Loan ${fmtMoney(results.purchase.loan)} at ${pct('lvr', state.lvr)} LVR · equity in ${fmtMoney(results.purchase.equityIn)}${perAsset}`;
}

function fmtDeltaPct(v) {
  const s = Math.abs(v * 100).toFixed(2).replace(/\.?0+$/, '');
  return `${s}%`;
}

function renderScenarioKey() {
  const w = SCENARIO_OVERLAYS.worst, b = SCENARIO_OVERLAYS.best;
  document.getElementById('scenarioKey').innerHTML = `
    <div class="scenario-key-item worst">
      <div class="sk-title">Worst case</div>
      <div class="sk-body">Rates rise ${fmtDeltaPct(w.interestRateDelta)}, you lose your largest tenant for a year and re-let ${fmtDeltaPct(-0.05)} cheaper, rent doesn't grow that year, and the cap rate softens ${fmtDeltaPct(w.exitCapRateDelta)} — buyers pay less for the same income.</div>
    </div>
    <div class="scenario-key-item base">
      <div class="sk-title">Base case</div>
      <div class="sk-body">Exactly what you've entered on the left. No shocks, no windfalls — your numbers, run forward.</div>
    </div>
    <div class="scenario-key-item best">
      <div class="sk-title">Best case</div>
      <div class="sk-body">Rates fall ${fmtDeltaPct(b.interestRateDelta)}, the cap rate firms ${fmtDeltaPct(b.exitCapRateDelta)}, rent grows ${fmtDeltaPct(b.rentGrowthDelta)} faster than you assumed, and every tenancy stays full.</div>
    </div>
  `;
}

function renderExitSummary(results) {
  document.getElementById('exitSummarySub').textContent =
    `What you'd actually be left with after ${state.holdYears} year${state.holdYears === 1 ? '' : 's'}, if you sold on these assumptions.`;
  const rows = [
    ['worst', 'Worst'],
    ['base', 'Base'],
    ['best', 'Best'],
  ];
  document.getElementById('exitSummaryWrap').innerHTML = `
    <div class="exit-summary-grid">
      ${rows.map(([key, label]) => {
        const s = results.scenarios[key];
        const loanLeft = s.years[s.years.length - 1].closingBalance;
        return `
        <div class="exit-summary-card ${key}">
          <div class="esc-title">${label}</div>
          <div class="esc-row"><span>Property worth</span><b>${fmtMoney(s.grossSale)}</b></div>
          <div class="esc-row"><span>Loan remaining</span><b>${fmtMoney(loanLeft)}</b></div>
          <div class="esc-row esc-highlight"><span>What you'd walk away with</span><b>${fmtMoney(s.netSale)}</b></div>
          <div class="esc-row"><span>Return on your cash</span><b>${fmtX(s.equityMultiple)} · ${fmtPct(s.irr)}/yr</b></div>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderSimpleCashFlow(years) {
  const scenarioNote = {
    worst: ' (worst case: everything 20% below plan)',
    predicted: '',
    best: ' (best case: everything 20% above plan)',
  }[state.simpleScenario];
  document.getElementById('simpleCashFlowSub').textContent =
    `Assuming rent grows ${pct('rentGrowth', state.rentGrowth)} a year as entered, and your interest rate stays flat at ${pct('interestRate', state.interestRate)}${scenarioNote}.`;
  document.getElementById('simpleCashFlowChartWrap').innerHTML = cashFlowChart({
    years: years.map((y) => y.t),
    noi: years.map((y) => y.NOI),
    debtService: years.map((y) => y.debtService),
    netCF: years.map((y) => y.CFBT),
    tooltips: years.map((y) =>
      `Year ${y.t}\nCash the property generates: ${fmtMoney(y.NOI)}\nYour loan repayment: ${fmtMoney(y.debtService)}\nNet cash in your pocket: ${fmtMoney(y.CFBT)}`
    ),
  });
}

function renderSellSummary(years) {
  const g5 = compoundGrowth(state.rentGrowth, 5);
  const g10 = compoundGrowth(state.rentGrowth, 10);
  document.getElementById('sellSummarySub').textContent =
    `Property value compounds at exactly ${pct('rentGrowth', state.rentGrowth)} a year (cap rate held flat) — that's +${fmtPct(g5)} over 5 years and +${fmtPct(g10)} over 10 years, before the ${state.simpleScenario === 'predicted' ? 'predicted' : state.simpleScenario} adjustment below. Plus cash collected along the way, and what selling would net you.`;
  const points = [5, 10].filter((t) => t <= years.length);
  document.getElementById('sellSummaryWrap').innerHTML = `
    <div class="exit-summary-grid">
      ${points.map((t) => {
        const e = deriveExitAtYear(years, t, state);
        const ahead = e.aheadOfBankBy >= 0;
        return `
        <div class="exit-summary-card ${state.simpleScenario === 'worst' ? 'worst' : state.simpleScenario === 'best' ? 'best' : 'base'}">
          <div class="esc-title">After ${e.year} years</div>
          <div class="esc-row"><span>Property worth then</span><b>${fmtMoney(e.propertyValue)}</b></div>
          <div class="esc-row"><span>Loan remaining</span><b>${fmtMoney(e.loanRemaining)}</b></div>
          <div class="esc-row"><span>Cash already collected</span><b>${fmtMoney(e.cumCFBT)}</b></div>
          <div class="esc-row"><span>Net proceeds from selling</span><b>${fmtMoney(e.netSale)}</b></div>
          <div class="esc-row esc-highlight"><span>Total you'd walk away with</span><b>${fmtMoney(e.totalWalkAway)}</b></div>
          <div class="esc-row"><span>Cash in the bank instead, at ${pct('bankRate', state.bankRate)}</span><b>${fmtMoney(e.bankValue)}</b></div>
          <div class="esc-row"><span>${ahead ? 'Ahead of the bank by' : 'Behind the bank by'}</span><b class="${ahead ? 'esc-good' : 'esc-bad'}">${fmtMoney(Math.abs(e.aheadOfBankBy))}</b></div>
        </div>`;
      }).join('')}
    </div>
  `;
}

function renderMetricStrip(results) {
  const wrap = document.getElementById('metricStrip');
  const { financials, entryScenarios } = results;

  if (financials.NOI <= 0) {
    wrap.innerHTML = `<div class="metric-card"><div class="metric-card-title">Income</div><p class="advice-empty">This asset doesn't produce income on these assumptions.</p></div>`;
    return;
  }

  const rows = [
    { title: 'Net yield', get: (e) => fmtPct(e.netYieldDerived) },
    { title: 'Cash-on-cash', get: (e) => fmtPct(e.cashOnCash) },
    { title: 'Interest cover (ICR)', get: (e) => fmtX(e.ICR) },
    { title: 'Break-even occupancy', get: (e) => fmtPct(e.breakEvenOccupancy) },
  ];

  wrap.innerHTML = rows.map((row) => `
    <div class="metric-card">
      <div class="metric-card-title">${row.title}</div>
      <div class="metric-scenarios">
        <div class="metric-scenario worst"><div class="msc-label">Worst</div><div class="msc-value">${row.get(entryScenarios.worst)}</div></div>
        <div class="metric-scenario base"><div class="msc-label">Base</div><div class="msc-value">${row.get(entryScenarios.base)}</div></div>
        <div class="metric-scenario best"><div class="msc-label">Best</div><div class="msc-value">${row.get(entryScenarios.best)}</div></div>
      </div>
    </div>
  `).join('');
}

function renderAdvice(results) {
  const advice = generateAdvice(state, results);
  const list = document.getElementById('adviceList');
  const showAllBtn = document.getElementById('showAllAdvice');

  if (advice.length === 0) {
    list.innerHTML = '<p class="advice-empty">No flags on these assumptions.</p>';
    showAllBtn.hidden = true;
    return;
  }

  const visible = state.adviceExpanded ? advice : advice.slice(0, 6);
  list.innerHTML = visible.map((a) => `
    <div class="advice-item ${a.severity}">
      <span class="advice-badge">${a.severity}</span>
      <div>
        <div class="advice-title">${a.title}</div>
        <div class="advice-body">${a.body}</div>
      </div>
    </div>
  `).join('');

  showAllBtn.hidden = state.adviceExpanded || advice.length <= 6;
}

function renderEquityChart(results) {
  const { scenarios } = results;
  const n = scenarios.base.years.length;
  const series = (scen) => [state.cash, ...scen.years.map((y) => y.equity)];
  const worstS = series(scenarios.worst), baseS = series(scenarios.base), bestS = series(scenarios.best);
  document.getElementById('equityChartWrap').innerHTML = equityChart({
    years: Array.from({ length: n + 1 }, (_, i) => i),
    worst: worstS, base: baseS, best: bestS,
    initialCash: state.cash, reviewYear: state.facilityReviewYears,
    tooltips: worstS.map((_, i) =>
      `Year ${i}\nWorst: ${fmtMoney(worstS[i])}\nBase: ${fmtMoney(baseS[i])}\nBest: ${fmtMoney(bestS[i])}`
    ),
  });
}

function renderCashFlowChart(results) {
  const base = results.scenarios.base;
  document.getElementById('cashFlowChartWrap').innerHTML = cashFlowChart({
    years: base.years.map((y) => y.t),
    noi: base.years.map((y) => y.NOI),
    debtService: base.years.map((y) => y.debtService),
    netCF: base.years.map((y) => y.CFBT),
    tooltips: base.years.map((y) =>
      `Year ${y.t}\nNOI: ${fmtMoney(y.NOI)}\nDebt service: ${fmtMoney(y.debtService)}\nNet cash flow: ${fmtMoney(y.CFBT)}`
    ),
  });
}

function renderBreakEvenChart(results) {
  const totalTenants = results.concentration.totalTenants;
  const ticks = Array.from({ length: totalTenants }, (_, i) => (totalTenants - 1 - i) / totalTenants).filter((t) => t > 0);
  document.getElementById('breakEvenChartWrap').innerHTML = breakEvenBar({
    breakEven: results.breakEvenOccupancy,
    currentOccupancy: results.financials.occupancy,
    tenantTicks: ticks,
  });
}

function scheduleSensitivityRender(results) {
  if (sensitivityDebounceHandle) clearTimeout(sensitivityDebounceHandle);
  sensitivityDebounceHandle = setTimeout(() => renderSensitivityChart(results), 100);
}

function renderSensitivityChart(results) {
  const grid = computeSensitivityGrid(state, results.purchase, results.financials, results.concentration);
  document.getElementById('sensitivityChartWrap').innerHTML = sensitivityGrid({
    rows: grid.rateDeltas.map((d) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(2)}%`),
    cols: grid.capDeltas.map((d) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(2)}%`),
    values: grid.values, currentRowIdx: grid.currentRowIdx, currentColIdx: grid.currentColIdx,
    fmt: (v) => (isFinite(v) ? `${v.toFixed(2)}x` : '—'),
  });
}

function renderPortfolio(results) {
  if (!results || results.error) return;
  const rows = computePortfolioSplit(state, 4);

  const metricDefs = {
    cashOnCash: { label: 'Cash-on-cash', get: (r) => r.result.error ? null : r.result.core.cashOnCash, fmt: fmtPct },
    equityRemaining: { label: 'Worst-case equity remaining', get: (r) => r.result.error ? null : Math.max(0, 1 - r.result.scenarios.worst.equityLossPct), fmt: fmtPct },
    concentration: { label: 'Tenant concentration (largest tenant)', get: (r) => r.result.error ? null : r.result.concentration.concentrationPct, fmt: fmtPct },
    purchasingPower: { label: 'Total purchasing power', get: (r) => r.result.error ? null : r.result.purchase.totalPrice, fmt: fmtMoney },
  };
  const def = metricDefs[state.portfolioMetric];
  const values = rows.map((r) => def.get(r) ?? 0);

  document.getElementById('portfolioChartWrap').innerHTML = portfolioBar({
    labels: rows.map((r) => `n=${r.n}`), values, fmt: def.fmt,
  });

  const tableRows = rows.map((r) => {
    if (r.result.error) return `<tr><td>n = ${r.n}</td><td colspan="7">Not viable — cash below fixed costs</td></tr>`;
    const { purchase, core, concentration, scenarios } = r.result;
    return `<tr>
      <td>n = ${r.n}</td>
      <td>${fmtMoney(purchase.totalPrice)}</td>
      <td>${fmtMoney(purchase.pricePerAsset)}</td>
      <td>${fmtPct(r.result.financials.netYieldDerived)}</td>
      <td>${fmtPct(core.cashOnCash)}</td>
      <td>${fmtX(core.ICR)}</td>
      <td>${concentration.totalTenants}</td>
      <td>${fmtPct(concentration.concentrationPct)}</td>
      <td>${fmtPct(Math.max(0, 1 - scenarios.worst.equityLossPct))}</td>
    </tr>`;
  }).join('');

  document.getElementById('portfolioTableWrap').innerHTML = `
    <table class="portfolio-table">
      <thead><tr>
        <th>Assets</th><th>Purchasing power</th><th>Price / asset</th><th>Net yield</th>
        <th>Cash-on-cash</th><th>ICR</th><th>Tenants</th><th>Loss if largest tenant leaves</th><th>Worst-case equity remaining</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;

  const recs = generatePortfolioRecommendations(rows, state.cash);
  document.getElementById('portfolioRecommendations').innerHTML = recs.length === 0 ? '' : recs.map((r) => `
    <div class="portfolio-recommendation">
      <span class="n-badge">n=${r.n}</span>
      <span>${r.text}</span>
    </div>
  `).join('');
}

const ASSUMPTION_ROWS = [
  ['Interest rate', (s) => pct('interestRate', s.interestRate), 'Bank first mortgage on a tenanted asset at ≤65% LVR is competitive at 6.25–7.5%'],
  ['Stress rate', () => '+2.00%', 'RBA at 4.35% after three 2026 rises, explicit tightening bias'],
  ['Bank LVR ceiling', () => '65%', 'Investment commercial; 80% is owner-occupier / specialist territory'],
  ['Entry yield', (s) => pct('netYield', s.mode === 'simple' ? s.netYield : s.grossYield), 'Achievable in Brisbane / Perth / Adelaide and suburban Sydney / Melbourne; not in prime CBD'],
  ['Outgoings', (s) => pct('outgoingsPctOfRent', s.outgoingsPctOfRent), 'Multi-tenant metro'],
  ['Recovery rate', (s) => pct('outgoingsRecoveryRate', s.outgoingsRecoveryRate), 'Reflects non-recoverable structural, capital and (in NSW/VIC) land tax items'],
  ['Management fee', (s) => pct('managementFeePct', s.managementFeePct), '5–7% typical where outgoings are administered'],
  ['Capex reserve', (s) => pct('capexReservePct', s.capexReservePct), 'Multi-tenant re-letting, incentives, make-good'],
  ['Structural vacancy', (s) => pct('structuralVacancyRate', s.structuralVacancyRate), ''],
  ['Fixed annual rent increase', (s) => pct('rentGrowth', s.rentGrowth), 'Fixed increase clause written into every lease, not a market forecast'],
  ['Outgoings inflation', (s) => pct('outgoingsInflation', s.outgoingsInflation), 'Deliberately above rent growth — margin compresses'],
  ['DD cost per asset', (s) => fmtMoney(s.dueDiligenceCostPerAsset), '$15k–$30k is the normal range on a ~$2m asset'],
  ['Selling costs', (s) => pct('sellingCostPct', s.sellingCostPct), 'Agent, legal, marketing'],
  ['Stamp duty', (s) => pct('stampDutyPct', s.stampDutyPct), 'Indicative only — confirm with the state revenue office'],
  ['Hold period', (s) => `${s.holdYears} years`, ''],
];

function renderAssumptions() {
  document.getElementById('assumptionsGrid').innerHTML = ASSUMPTION_ROWS.map(([label, val, basis]) => `
    <div class="assumption-row"><span>${label}${typeof basis === 'string' && basis ? ` — ${basis}` : ''}</span><span>${val(state)}</span></div>
  `).join('');
}

// ---------------------------------------------------------------------------
// Chart tooltips — one delegated listener handles every chart, since chart
// markup is replaced wholesale on each render() and per-element listeners
// would need to be re-bound every time.
// ---------------------------------------------------------------------------

function initChartTooltips() {
  const tip = document.getElementById('chartTooltip');
  const place = (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.textContent = target.getAttribute('data-tooltip');
    const margin = 14;
    const x = Math.min(window.innerWidth - margin, Math.max(margin, e.clientX));
    const y = Math.max(margin, e.clientY);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  document.addEventListener('pointermove', place);
  document.addEventListener('pointerdown', place);
  document.addEventListener('scroll', () => { tip.hidden = true; }, true);
}

// ---------------------------------------------------------------------------

bindInputs();
initChartTooltips();
document.getElementById('landTaxRecoverable').checked = state.landTaxRecoverable;
syncInputsFromState();
render();
