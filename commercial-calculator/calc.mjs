// Pure calculation engine for the Commercial Property Investment Calculator.
// No DOM access, no side effects — every export is a plain function of its inputs.

export const STAMP_DUTY_DEFAULTS = {
  NSW: 0.055, VIC: 0.055, QLD: 0.0575, WA: 0.0515,
  SA: 0.055, ACT: 0.050, NT: 0.0495, TAS: 0.0435,
};

// Recoverable from retail tenants: QLD, SA, WA, ACT, NT, TAS. Not recoverable: NSW, VIC.
export const LAND_TAX_RECOVERABLE_DEFAULTS = {
  NSW: false, VIC: false, QLD: true, WA: true,
  SA: true, ACT: true, NT: true, TAS: true,
};

export const LEASE_TYPE_RECOVERY_RATE = { gross: 0.00, net: 0.85, 'triple-net': 1.00 };

export const DEFAULT_INPUTS = {
  mode: 'simple',
  cash: 2_000_000,
  lvr: 0.50,
  interestRate: 0.070,
  repaymentType: 'io',
  loanTermYears: 15,
  facilityReviewYears: 3,
  state: 'QLD',
  numberOfAssets: 1,
  tenantsPerAsset: 4,
  leaseType: 'net',
  netYield: 0.060,
  grossYield: 0.070,
  outgoingsPctOfRent: 0.22,
  outgoingsRecoveryRate: 0.85,
  landTaxRecoverable: LAND_TAX_RECOVERABLE_DEFAULTS.QLD,
  managementFeePct: 0.06,
  capexReservePct: 0.05,
  structuralVacancyRate: 0.05,
  stampDutyPct: STAMP_DUTY_DEFAULTS.QLD,
  legalAndOtherPct: 0.005,
  dueDiligenceCostPerAsset: 22_000,
  holdYears: 5,
  rentGrowth: 0.030,
  outgoingsInflation: 0.040,
  exitCapRate: null, // derived from netYield if null: see deriveEntryCapRate
  sellingCostPct: 0.025,
  retailTenancy: false,
  largestTenantPct: null, // manual override for tenant concentration
  smallLotYieldPremiumPerAsset: 0.0015,
  rateUpliftPerExtraAsset: 0.0010,
};

export const SCENARIO_OVERLAYS = {
  worst: { interestRateDelta: 0.02, exitCapRateDelta: 0.015, rentGrowthOverride: 0, vacancyOverride: null, tenantLossEvent: true },
  base: { interestRateDelta: 0, exitCapRateDelta: 0, rentGrowthOverride: null, vacancyOverride: null, tenantLossEvent: false },
  best: { interestRateDelta: -0.005, exitCapRateDelta: -0.005, rentGrowthOverride: null, rentGrowthDelta: 0.01, vacancyOverride: 0, tenantLossEvent: false },
};

export function deriveEntryCapRate(inputs) {
  return inputs.mode === 'simple' ? inputs.netYield : inputs.grossYield * (1 - inputs.outgoingsPctOfRent * 0.3);
}

// --- 4.1 Purchase capacity ---------------------------------------------------

export function computeAcqCosts(inputs) {
  const acqCostPct = inputs.stampDutyPct + inputs.legalAndOtherPct;
  const fixedCosts = inputs.dueDiligenceCostPerAsset * inputs.numberOfAssets;
  return { acqCostPct, fixedCosts };
}

export function computePurchaseCapacity(inputs) {
  const { acqCostPct, fixedCosts } = computeAcqCosts(inputs);

  if (inputs.cash <= fixedCosts) {
    return { error: 'CASH_BELOW_FIXED_COSTS', acqCostPct, fixedCosts };
  }

  const denom = 1 - inputs.lvr + acqCostPct;
  if (denom <= 0) {
    return { error: 'INVALID_LVR_COST_COMBINATION', acqCostPct, fixedCosts };
  }

  const totalPrice = (inputs.cash - fixedCosts) / denom;
  const pricePerAsset = totalPrice / inputs.numberOfAssets;
  const loan = totalPrice * inputs.lvr;
  const acqCostsDollar = totalPrice * acqCostPct;

  return {
    totalPrice, pricePerAsset, loan, equityIn: inputs.cash,
    acqCostPct, fixedCosts, acqCostsDollar, error: null,
  };
}

// --- 4.2 Net operating income -------------------------------------------------

// Used both for the "as entered" NOI and for grown/projected years — the caller
// supplies baseRent/outgoingsTotal already grown to the target year.
export function computeOperatingFinancialsFromBase(baseRent, outgoingsTotal, inputs, totalPriceForYield) {
  const occupancy = 1 - inputs.structuralVacancyRate;
  const EGI = baseRent * occupancy;
  const recoveredOutgoings = outgoingsTotal * inputs.outgoingsRecoveryRate * occupancy;
  const nonRecoverable = outgoingsTotal - recoveredOutgoings;
  const managementFee = (EGI + recoveredOutgoings) * inputs.managementFeePct;
  const capexReserve = baseRent * inputs.capexReservePct;
  const NOI = EGI - nonRecoverable - managementFee - capexReserve;
  const netYieldDerived = totalPriceForYield > 0 ? NOI / totalPriceForYield : 0;
  return { baseRent, outgoingsTotal, occupancy, EGI, recoveredOutgoings, nonRecoverable, managementFee, capexReserve, NOI, netYieldDerived };
}

export function computeOperatingFinancials(inputs, totalPrice) {
  if (inputs.mode === 'simple') {
    const NOI = totalPrice * inputs.netYield;
    const baseRent = (totalPrice * inputs.netYield) / 0.85; // implied, for break-even calc
    const outgoingsTotal = baseRent * inputs.outgoingsPctOfRent;
    const occupancy = 1 - inputs.structuralVacancyRate;
    const recoveredOutgoings = outgoingsTotal * inputs.outgoingsRecoveryRate * occupancy;
    const nonRecoverable = outgoingsTotal - recoveredOutgoings;
    const EGI = baseRent * occupancy;
    const managementFee = (EGI + recoveredOutgoings) * inputs.managementFeePct;
    const capexReserve = baseRent * inputs.capexReservePct;
    const netYieldDerived = totalPrice > 0 ? NOI / totalPrice : 0;
    return { baseRent, outgoingsTotal, occupancy, EGI, recoveredOutgoings, nonRecoverable, managementFee, capexReserve, NOI, netYieldDerived };
  }
  const baseRent = totalPrice * inputs.grossYield;
  const outgoingsTotal = baseRent * inputs.outgoingsPctOfRent;
  return computeOperatingFinancialsFromBase(baseRent, outgoingsTotal, inputs, totalPrice);
}

// --- 4.3 Debt service ---------------------------------------------------------

export function buildAmortizationSchedule(loan, interestRate, loanTermYears, repaymentType, holdYears) {
  const years = Math.max(1, Math.ceil(holdYears));
  const schedule = [];

  if (loan <= 0) {
    for (let t = 1; t <= years; t++) schedule.push({ year: t, interest: 0, principal: 0, closingBalance: 0, debtService: 0 });
    return schedule;
  }

  if (repaymentType === 'io') {
    const interestExpense = loan * interestRate;
    for (let t = 1; t <= years; t++) {
      schedule.push({ year: t, interest: interestExpense, principal: 0, closingBalance: loan, debtService: interestExpense });
    }
    return schedule;
  }

  const r = interestRate / 12;
  const n = Math.round(loanTermYears * 12);
  const monthlyPayment = r === 0 ? loan / n : (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

  let balance = loan;
  const monthly = [];
  for (let m = 1; m <= n; m++) {
    const interest = balance * r;
    let principal = monthlyPayment - interest;
    if (principal > balance) principal = balance;
    balance = Math.max(0, balance - principal);
    monthly.push({ interest, principal, balance });
  }

  for (let t = 1; t <= years; t++) {
    const startIdx = (t - 1) * 12;
    const yearMonths = monthly.slice(startIdx, startIdx + 12);
    if (yearMonths.length === 0) {
      schedule.push({ year: t, interest: 0, principal: 0, closingBalance: 0, debtService: 0 });
      continue;
    }
    const interest = yearMonths.reduce((s, m) => s + m.interest, 0);
    const principal = yearMonths.reduce((s, m) => s + m.principal, 0);
    const closingBalance = yearMonths[yearMonths.length - 1].balance;
    schedule.push({ year: t, interest, principal, closingBalance, debtService: monthlyPayment * 12 * (yearMonths.length / 12) });
  }
  return schedule;
}

export function monthlyPI(loan, interestRate, loanTermYears) {
  const r = interestRate / 12;
  const n = Math.round(loanTermYears * 12);
  return r === 0 ? loan / n : (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// --- 4.4 Core metrics ----------------------------------------------------------

export function computeCoreMetrics({ NOI, debtService, interestExpense, cash, totalPrice, acqCostsDollar, fixedCosts }) {
  const CFBT = NOI - debtService;
  const cashOnCash = cash !== 0 ? CFBT / cash : 0;
  const ICR = interestExpense > 0 ? NOI / interestExpense : Infinity;
  const DSCR = debtService > 0 ? NOI / debtService : Infinity;
  const costBase = totalPrice + acqCostsDollar + fixedCosts;
  const netYieldOnCost = costBase > 0 ? NOI / costBase : 0;
  return { CFBT, cashOnCash, ICR, DSCR, netYieldOnCost };
}

// Linear break-even model per spec §4.4 (management fee applied to the base-rent
// share only). Kept as an explicit closed form plus a matching CFBT(o) so the two
// can be cross-checked by bisection.
export function computeBreakEvenOccupancy({ debtService, outgoingsTotal, capexReserve, baseRent, managementFeePct, outgoingsRecoveryRate }) {
  const denom = baseRent * (1 - managementFeePct) + outgoingsTotal * outgoingsRecoveryRate;
  if (denom <= 0) return Infinity;
  return (debtService + outgoingsTotal + capexReserve) / denom;
}

export function breakEvenCFBT(o, { debtService, outgoingsTotal, capexReserve, baseRent, managementFeePct, outgoingsRecoveryRate }) {
  return o * (baseRent * (1 - managementFeePct) + outgoingsTotal * outgoingsRecoveryRate) - (debtService + outgoingsTotal + capexReserve);
}

export function breakEvenOccupancyByBisection(params, lo = 0, hi = 3, tol = 1e-9, maxIter = 200) {
  let a = lo, b = hi;
  let fa = breakEvenCFBT(a, params);
  for (let i = 0; i < maxIter; i++) {
    const m = (a + b) / 2;
    const fm = breakEvenCFBT(m, params);
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return m;
    if ((fa < 0 && fm < 0) || (fa > 0 && fm > 0)) { a = m; fa = fm; } else { b = m; }
  }
  return (a + b) / 2;
}

export function computeTenantConcentration(inputs, baseRent) {
  const totalTenants = inputs.tenantsPerAsset * inputs.numberOfAssets;
  const concentrationPct = inputs.largestTenantPct != null
    ? inputs.largestTenantPct
    : (totalTenants > 0 ? 1 / totalTenants : 1);
  const incomeLossOneTenant = baseRent * concentrationPct;
  return { totalTenants, concentrationPct, incomeLossOneTenant };
}

// --- 4.6 IRR -------------------------------------------------------------------

export function irr(cashflows, lo = -0.99, hi = 2.0, tol = 1e-7, maxIter = 200) {
  const npv = (rate) => cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);
  let a = lo, b = hi;
  let fa = npv(a), fb = npv(b);
  if (!isFinite(fa) || !isFinite(fb) || fa * fb > 0) return null;
  for (let i = 0; i < maxIter; i++) {
    const m = (a + b) / 2;
    const fm = npv(m);
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return m;
    if ((fa < 0 && fm < 0) || (fa > 0 && fm > 0)) { a = m; fa = fm; } else { b = m; }
  }
  return (a + b) / 2;
}

// --- 4.5 / 4.6 Full projection for one scenario --------------------------------

// overrides holds ABSOLUTE values (not deltas): interestRate, exitCapRate, rentGrowth,
// vacancy, tenantLossEvent. Used directly by the sensitivity grid sweep.
export function runCustomScenario(inputs, purchase, financials, concentration, overrides) {
  const scenInterestRate = overrides.interestRate;
  const scenExitCapRate = Math.max(0.001, overrides.exitCapRate);
  const scenRentGrowth = overrides.rentGrowth;
  const scenVacancy = overrides.vacancy;
  const tenantLossEvent = !!overrides.tenantLossEvent;
  const scenInputs = { ...inputs, structuralVacancyRate: scenVacancy };

  const schedule = buildAmortizationSchedule(purchase.loan, scenInterestRate, inputs.loanTermYears, inputs.repaymentType, inputs.holdYears);

  const holdYears = Math.max(1, Math.round(inputs.holdYears));
  const years = [];
  let cumCFBT = 0;
  const lostIncomeBase = financials.baseRent * concentration.concentrationPct;

  for (let t = 1; t <= holdYears; t++) {
    let baseRentT = financials.baseRent * Math.pow(1 + scenRentGrowth, t);
    const outgoingsTotalT = financials.outgoingsTotal * Math.pow(1 + inputs.outgoingsInflation, t);
    let relettingCost = 0;

    if (tenantLossEvent) {
      if (t === 1) {
        baseRentT -= lostIncomeBase; // building vacant for the tenant's share, 12 months
        relettingCost = lostIncomeBase * 0.5; // 6 months' rent: incentive + fitout + agent fee
      } else {
        baseRentT -= lostIncomeBase * 0.05 * Math.pow(1 + scenRentGrowth, t); // re-let at -5%
      }
    }
    if (baseRentT < 0) baseRentT = 0;

    const fin = computeOperatingFinancialsFromBase(baseRentT, outgoingsTotalT, scenInputs, purchase.totalPrice);
    const debt = schedule[t - 1];
    const value = scenExitCapRate > 0 ? fin.NOI / scenExitCapRate : 0;
    const equity = value - debt.closingBalance;
    const CFBT = fin.NOI - debt.debtService - relettingCost;
    const lvrActual = value > 0 ? debt.closingBalance / value : Infinity;
    const ICR = debt.interest > 0 ? fin.NOI / debt.interest : Infinity;

    cumCFBT += CFBT;
    years.push({ t, ...fin, debtService: debt.debtService, interest: debt.interest, principal: debt.principal, closingBalance: debt.closingBalance, relettingCost, value, equity, CFBT, lvrActual, ICR });
  }

  const last = years[years.length - 1];
  const grossSale = last.value;
  const netSale = grossSale * (1 - inputs.sellingCostPct) - last.closingBalance;
  const cashflows = [-inputs.cash, ...years.map((y, i) => (i === years.length - 1 ? y.CFBT + netSale : y.CFBT))];
  const irrVal = irr(cashflows);
  const equityMultiple = inputs.cash !== 0 ? (cumCFBT + netSale) / inputs.cash : null;
  const totalProfit = cumCFBT + netSale - inputs.cash;
  const equityLossPct = inputs.cash > 0 ? Math.max(0, (inputs.cash - last.equity) / inputs.cash) : 0;

  return {
    years, grossSale, netSale, irr: irrVal, equityMultiple, totalProfit, cumCFBT,
    equityAtHold: last.equity, lvrActualAtHold: last.lvrActual, equityLossPct,
    yearAt: (t) => years[Math.min(Math.max(1, Math.round(t)), years.length) - 1],
  };
}

export function runScenario(inputs, purchase, financials, concentration, overlayKey) {
  const overlay = SCENARIO_OVERLAYS[overlayKey];
  return runCustomScenario(inputs, purchase, financials, concentration, {
    interestRate: inputs.interestRate + overlay.interestRateDelta,
    exitCapRate: inputs.exitCapRate + overlay.exitCapRateDelta,
    rentGrowth: overlay.rentGrowthOverride != null ? overlay.rentGrowthOverride : inputs.rentGrowth + (overlay.rentGrowthDelta || 0),
    vacancy: overlay.vacancyOverride != null ? overlay.vacancyOverride : inputs.structuralVacancyRate,
    tenantLossEvent: overlay.tenantLossEvent,
  });
}

// Day-one metrics under a scenario overlay: applies the overlay's rate shock and
// tenant-loss event immediately (no year of rent growth first), so the metric
// strip reads as "if this happened today", not "one year into the hold".
export function computeEntryScenarioMetrics(inputs, purchase, financials, concentration, overlayKey) {
  const overlay = SCENARIO_OVERLAYS[overlayKey];
  const scenInterestRate = inputs.interestRate + overlay.interestRateDelta;
  const scenVacancy = overlay.vacancyOverride != null ? overlay.vacancyOverride : inputs.structuralVacancyRate;
  const scenInputs = { ...inputs, structuralVacancyRate: scenVacancy };

  let baseRent = financials.baseRent;
  let relettingCost = 0;
  if (overlay.tenantLossEvent) {
    const lostIncomeBase = financials.baseRent * concentration.concentrationPct;
    baseRent = Math.max(0, baseRent - lostIncomeBase);
    relettingCost = lostIncomeBase * 0.5;
  }

  const fin = computeOperatingFinancialsFromBase(baseRent, financials.outgoingsTotal, scenInputs, purchase.totalPrice);
  const debt = buildAmortizationSchedule(purchase.loan, scenInterestRate, inputs.loanTermYears, inputs.repaymentType, 1)[0];
  const CFBT = fin.NOI - debt.debtService - relettingCost;
  const cashOnCash = inputs.cash !== 0 ? CFBT / inputs.cash : 0;
  const ICR = debt.interest > 0 ? fin.NOI / debt.interest : Infinity;
  const breakEvenOccupancy = computeBreakEvenOccupancy({
    debtService: debt.debtService, outgoingsTotal: fin.outgoingsTotal, capexReserve: fin.capexReserve,
    baseRent: fin.baseRent, managementFeePct: inputs.managementFeePct, outgoingsRecoveryRate: inputs.outgoingsRecoveryRate,
  });
  return { ...fin, debtService: debt.debtService, interest: debt.interest, CFBT, cashOnCash, ICR, breakEvenOccupancy };
}

// --- Master orchestrator ---------------------------------------------------

export function computeAll(rawInputs) {
  const inputs = { ...rawInputs };
  if (inputs.exitCapRate == null) inputs.exitCapRate = deriveEntryCapRate(inputs);

  const purchase = computePurchaseCapacity(inputs);
  if (purchase.error) {
    return { inputs, purchase, error: purchase.error };
  }

  const financials = computeOperatingFinancials(inputs, purchase.totalPrice);
  const concentration = computeTenantConcentration(inputs, financials.baseRent);

  const entrySchedule = buildAmortizationSchedule(purchase.loan, inputs.interestRate, inputs.loanTermYears, inputs.repaymentType, 1);
  const entryDebt = entrySchedule[0];
  const core = computeCoreMetrics({
    NOI: financials.NOI, debtService: entryDebt.debtService, interestExpense: entryDebt.interest,
    cash: inputs.cash, totalPrice: purchase.totalPrice, acqCostsDollar: purchase.acqCostsDollar, fixedCosts: purchase.fixedCosts,
  });

  const breakEvenParams = {
    debtService: entryDebt.debtService, outgoingsTotal: financials.outgoingsTotal, capexReserve: financials.capexReserve,
    baseRent: financials.baseRent, managementFeePct: inputs.managementFeePct, outgoingsRecoveryRate: inputs.outgoingsRecoveryRate,
  };
  const breakEvenOccupancy = computeBreakEvenOccupancy(breakEvenParams);

  const scenarios = {
    worst: runScenario(inputs, purchase, financials, concentration, 'worst'),
    base: runScenario(inputs, purchase, financials, concentration, 'base'),
    best: runScenario(inputs, purchase, financials, concentration, 'best'),
  };

  const entryScenarios = {
    worst: computeEntryScenarioMetrics(inputs, purchase, financials, concentration, 'worst'),
    base: { ...financials, debtService: entryDebt.debtService, interest: entryDebt.interest, CFBT: core.CFBT, cashOnCash: core.cashOnCash, ICR: core.ICR, breakEvenOccupancy },
    best: computeEntryScenarioMetrics(inputs, purchase, financials, concentration, 'best'),
  };

  return {
    inputs, purchase, financials, concentration, entryDebt, core,
    breakEvenOccupancy, breakEvenParams, scenarios, entryScenarios, error: null,
  };
}

// --- 8.3 Sensitivity grid data ----------------------------------------------

export function computeSensitivityGrid(inputs, purchase, financials, concentration) {
  const rateDeltas = [-0.01, -0.005, 0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03];
  const capDeltas = [-0.01, -0.0075, -0.005, -0.0025, 0, 0.0025, 0.005, 0.0075, 0.01, 0.0125, 0.015, 0.0175, 0.02];
  const values = rateDeltas.map((rd) =>
    capDeltas.map((cd) => {
      const scen = runCustomScenario(inputs, purchase, financials, concentration, {
        interestRate: Math.max(0, inputs.interestRate + rd),
        exitCapRate: Math.max(0.001, inputs.exitCapRate + cd),
        rentGrowth: inputs.rentGrowth,
        vacancy: inputs.structuralVacancyRate,
        tenantLossEvent: false,
      });
      return scen.equityMultiple;
    })
  );
  return { rateDeltas, capDeltas, values, currentRowIdx: rateDeltas.indexOf(0), currentColIdx: capDeltas.indexOf(0) };
}

// --- §6 Portfolio split module --------------------------------------------

export function computePortfolioSplit(inputs, maxN = 4) {
  const rows = [];
  for (let n = 1; n <= maxN; n++) {
    const scenInputs = {
      ...inputs,
      numberOfAssets: n,
      netYield: inputs.netYield + inputs.smallLotYieldPremiumPerAsset * (n - 1),
      grossYield: inputs.grossYield + inputs.smallLotYieldPremiumPerAsset * (n - 1),
      interestRate: inputs.interestRate + inputs.rateUpliftPerExtraAsset * (n - 1),
    };
    const result = computeAll(scenInputs);
    rows.push({ n, inputs: scenInputs, result });
  }
  return rows;
}

export function stressedEquityLoss(row) {
  if (row.result.error) return 1;
  return row.result.scenarios.worst.equityLossPct;
}

export function generatePortfolioRecommendations(rows, cash) {
  const messages = [];
  const currentN = rows.find((r) => r.n === rows[0].inputs.numberOfAssets) || rows[0];
  for (const row of rows) {
    if (row.result.error) continue;
    const { n } = row;
    const { pricePerAsset, fixedCosts } = row.result.purchase;
    const { totalTenants, concentrationPct } = row.result.concentration;
    const notes = [];

    if (pricePerAsset < 1_200_000) {
      notes.push({
        n, severity: 'warning',
        text: `At ${n} asset${n > 1 ? 's' : ''} you're buying at ${fmtMoney(pricePerAsset)} each. Below ~$1.2m, genuine multi-tenant stock in a capital city is scarce and you'll drift into single-tenant strata — which defeats the diversification you're splitting for.`,
      });
    }
    if (totalTenants < 4) {
      notes.push({
        n, severity: 'warning',
        text: `${totalTenants} tenanc${totalTenants === 1 ? 'y' : 'ies'} means one vacancy costs you ${fmtPct(concentrationPct)} of income. That's single-asset risk wearing a portfolio costume.`,
      });
    }
    if (fixedCosts / cash > 0.04) {
      notes.push({
        n, severity: 'warning',
        text: `Splitting ${n} way${n > 1 ? 's' : ''} burns ${fmtMoney(fixedCosts)} in due diligence before you own anything — ${fmtPct(fixedCosts / cash)} of your capital, and it buys you no income.`,
      });
    }
    const n1 = rows.find((r) => r.n === 1);
    if (n > 1 && n1 && !n1.result.error && stressedEquityLoss(row) < stressedEquityLoss(n1) - 0.05) {
      const a = stressedEquityLoss(n1) * 100, b = stressedEquityLoss(row) * 100;
      notes.push({
        n, severity: 'positive',
        text: `Splitting across ${n} assets cuts your worst-case equity loss from ${a.toFixed(0)}% to ${b.toFixed(0)}%. That's the case for diversifying: you're paying ${fmtMoney(fixedCosts)} in extra acquisition costs to buy that protection.`,
      });
    }
    if (n === 1 && totalTenants >= 5) {
      notes.push({
        n, severity: 'info',
        text: `A single building with ${totalTenants} tenancies already gives you income diversification. Splitting further mainly adds cost and management load — it diversifies location and sector, not tenant risk.`,
      });
    }
    messages.push(...notes);
  }
  return messages;
}

// --- §7 Advisory engine ------------------------------------------------------

export function generateAdvice(inputs, results) {
  if (!results || results.error) return [];
  const advice = [];
  const push = (severity, title, body) => advice.push({ severity, title, body });

  const { core, breakEvenOccupancy, concentration, scenarios, entryScenarios, financials, entryDebt, purchase } = results;
  const worst = scenarios.worst;
  const base = scenarios.base;
  const worstEntry = entryScenarios.worst;
  const reviewYear = Math.min(inputs.facilityReviewYears, inputs.holdYears);
  const worstAtReview = worst.yearAt(reviewYear);

  if (core.ICR < 1.25) {
    push('critical', 'Interest cover is below lending appetite',
      `Interest cover of ${fmtX(core.ICR)} is below where most commercial lenders will write the loan. Expect a decline, or a materially lower LVR offer.`);
  } else if (core.ICR < 1.50) {
    push('warning', 'Interest cover has no headroom',
      `Interest cover of ${fmtX(core.ICR)} sits under the 1.5× most lenders want. You have no headroom — one vacancy or one rate rise breaches it.`);
  }

  if (worstEntry && worstEntry.ICR < 1.0) {
    const shortfall = (worstEntry.debtService - worstEntry.NOI);
    push('critical', "You can't service the loan in the stress case",
      `In the stress case you cannot service the loan from the property. You'd be funding ${fmtMoney(shortfall)}/yr from your own pocket.`);
  }

  if (breakEvenOccupancy > 0.80) {
    const currentOccupancy = financials.occupancy;
    const tenantsThatCanLeave = Math.max(0, Math.floor((currentOccupancy - breakEvenOccupancy) * concentration.totalTenants));
    push('warning', 'Break-even occupancy is high',
      `You need ${fmtPct(breakEvenOccupancy)} of the building let just to break even. With ${concentration.totalTenants} tenancies, losing ${tenantsThatCanLeave + 1} puts you under water.`);
  }

  if (core.cashOnCash < 0.045) {
    push('warning', 'Cash-on-cash is close to a term deposit',
      `Cash-on-cash of ${fmtPct(core.cashOnCash)} is close to what a term deposit pays with none of the vacancy, illiquidity or capital risk. The case for this deal has to be growth, not income.`);
  }

  if (inputs.lvr > 0.65) {
    push('warning', 'Above standard bank appetite',
      `Above 65% LVR you're outside standard bank appetite for investment commercial. Expect private credit pricing of 8–14% and a much shorter leash.`);
  }

  if (worstAtReview && worstAtReview.lvrActual > 0.70) {
    push('critical', 'Facility review breach in the stress case',
      `At the ${reviewYear}-year facility review your LVR is ${fmtPct(worstAtReview.lvrActual)} in the stress case. That's a covenant breach at exactly the moment you can't sell well. Lenders can demand a paydown.`);
  }

  if (inputs.holdYears < 5) {
    const roundTrip = purchase.acqCostPct + inputs.sellingCostPct;
    push('warning', 'Short hold makes round-trip costs a hurdle',
      `Over ${inputs.holdYears} year${inputs.holdYears === 1 ? '' : 's'}, entry and exit costs of ~${fmtPct(roundTrip)} mean you need real growth just to break even. Commercial suits 5–7 year holds.`);
  }

  if (inputs.exitCapRate < deriveEntryCapRate(inputs)) {
    push('info', 'You are assuming cap rate compression',
      `You're assuming the cap rate compresses from ${fmtPct(deriveEntryCapRate(inputs))} to ${fmtPct(inputs.exitCapRate)}. That's a bet on the rate cycle turning. The RBA has raised three times in 2026 and holds a tightening bias — model this flat before you rely on it.`);
  }

  if (inputs.outgoingsRecoveryRate < 0.7 && inputs.mode === 'advanced') {
    const amount = financials.nonRecoverable;
    const bp = (financials.nonRecoverable / purchase.totalPrice) * 10000;
    push('warning', 'Outgoings recovery gap',
      `Only ${fmtPct(inputs.outgoingsRecoveryRate)} of outgoings are recoverable. That gap costs you ${fmtMoney(amount)}/yr and about ${bp.toFixed(0)}bp of net yield. Check the lease structure before you price off the headline yield.`);
  }

  if ((inputs.state === 'NSW' || inputs.state === 'VIC') && inputs.retailTenancy) {
    const amount = financials.outgoingsTotal * 0.20; // land tax typically 15-25% of the outgoings pool
    push('info', 'Land tax is not recoverable here',
      `In ${inputs.state}, land tax generally can't be recovered from retail tenants. On this asset that's roughly ${fmtMoney(amount)}/yr you absorb permanently.`);
  }

  if (financials.netYieldDerived < 0.06) {
    push('warning', 'Net yield is below your target',
      `The build-up gives ${fmtPct(financials.netYieldDerived)} net, below your 6% target. The headline yield is being flattered by outgoings, vacancy or management costs the ad didn't mention.`);
  }

  if (concentration.concentrationPct > 0.35) {
    push('warning', 'Tenant concentration is high',
      `One tenant is ${fmtPct(concentration.concentrationPct)} of your income. That's a single-tenant asset with extra steps — price it like one.`);
  }

  if (worst.equityLossPct > 0.40) {
    push('critical', 'Stress case removes a large share of your cash',
      `The stress case removes ${fmtPct(worst.equityLossPct)} of your ${fmtMoney(inputs.cash)}. That is the number to sit with. Rate rise, one vacancy, and cap rate softening are not independent events — they arrive together.`);
  }

  if (core.ICR > 2.0 && core.cashOnCash > 0.055 && breakEvenOccupancy < 0.65) {
    push('positive', 'This structure has real headroom',
      `This structure has real headroom: ${fmtX(core.ICR)} cover, break-even at ${fmtPct(breakEvenOccupancy)} occupancy. You can absorb a vacancy and a rate rise without selling.`);
  }

  if (inputs.capexReservePct < 0.03 && inputs.tenantsPerAsset > 2) {
    push('info', 'Capex reserve looks light',
      `You've reserved ${fmtPct(inputs.capexReservePct)} for capital works. Multi-tenant buildings generate recurring fitout contributions, leasing fees and make-good disputes — 5% is a more honest long-run number.`);
  }

  const growthToDouble = inputs.holdYears > 0 ? Math.pow(2, 1 / inputs.holdYears) - 1 : 0;
  if (growthToDouble > 0.15) {
    push('info', 'Doubling your money implies unrealistic growth',
      `Doubling your money in ${inputs.holdYears} years needs ${fmtPct(growthToDouble)} annual value growth. Since value = NOI ÷ cap rate, that requires roughly doubling net income or halving the cap rate. Passive multi-tenant assets don't do that — it's a value-add or rezoning outcome, and a different risk profile.`);
  }

  const order = { critical: 0, warning: 1, info: 2, positive: 3 };
  advice.sort((a, b) => order[a.severity] - order[b.severity]);
  return advice;
}

// --- Formatting helpers (pure, used by both advice text and UI) ---------------

export function fmtMoney(v, opts = {}) {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v);
  const cents = abs < 10000 ? 2 : 0;
  return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: opts.cents ?? cents, maximumFractionDigits: opts.cents ?? cents });
}

export function fmtPct(v, digits = 1) {
  if (v == null || !isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtX(v, digits = 2) {
  if (v == null || !isFinite(v)) return '∞×';
  return `${v.toFixed(digits)}×`;
}
