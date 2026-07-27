import assert from 'node:assert/strict';
import {
  DEFAULT_INPUTS, computePurchaseCapacity, computeOperatingFinancials,
  monthlyPI, computeBreakEvenOccupancy, breakEvenOccupancyByBisection,
  irr, computeAll,
} from './calc.mjs';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(`       ${e.message}`);
    process.exitCode = 1;
  }
}

function approx(actual, expected, tolAbs, msg) {
  assert.ok(Math.abs(actual - expected) <= tolAbs, `${msg}: expected ~${expected}, got ${actual}`);
}

console.log('calc.mjs unit tests\n');

test('$2,000,000 cash, 50% LVR, 5.5% duty, 0.5% legal, $22k DD -> totalPrice ~ 3,532,000, loan ~ 1,766,000', () => {
  const inputs = { ...DEFAULT_INPUTS, cash: 2_000_000, lvr: 0.50, stampDutyPct: 0.055, legalAndOtherPct: 0.005, dueDiligenceCostPerAsset: 22_000, numberOfAssets: 1 };
  const r = computePurchaseCapacity(inputs);
  approx(r.totalPrice, 3_532_000, 1_000, 'totalPrice');
  approx(r.loan, 1_766_000, 1_000, 'loan');
});

test('Same inputs at 0% LVR -> totalPrice ~ 1,868,000', () => {
  const inputs = { ...DEFAULT_INPUTS, cash: 2_000_000, lvr: 0, stampDutyPct: 0.055, legalAndOtherPct: 0.005, dueDiligenceCostPerAsset: 22_000, numberOfAssets: 1 };
  const r = computePurchaseCapacity(inputs);
  approx(r.totalPrice, 1_868_000, 3_000, 'totalPrice');
});

test('P&I on $1,766,000 at 7.0% over 15 years -> ~ $15,875/month', () => {
  const payment = monthlyPI(1_766_000, 0.07, 15);
  approx(payment, 15_875, 5, 'monthly payment');
});

test('Break-even occupancy: closed form matches numeric bisection on CFBT(o)=0', () => {
  const inputs = { ...DEFAULT_INPUTS, mode: 'advanced' };
  const results = computeAll(inputs);
  const closedForm = results.breakEvenOccupancy;
  const bisected = breakEvenOccupancyByBisection(results.breakEvenParams);
  approx(closedForm, bisected, 1e-6, 'break-even occupancy');
});

test('IRR of [-100, 10, 10, 110] ~ 10%', () => {
  const rate = irr([-100, 10, 10, 110]);
  approx(rate, 0.10, 1e-4, 'irr');
});

test('numberOfAssets = 3 reduces totalPrice by exactly 2 x dueDiligenceCostPerAsset / (1 - lvr + acqCostPct)', () => {
  const base = { ...DEFAULT_INPUTS, cash: 2_000_000, lvr: 0.50, stampDutyPct: 0.055, legalAndOtherPct: 0.005, dueDiligenceCostPerAsset: 22_000 };
  const r1 = computePurchaseCapacity({ ...base, numberOfAssets: 1 });
  const r3 = computePurchaseCapacity({ ...base, numberOfAssets: 3 });
  const denom = 1 - base.lvr + (base.stampDutyPct + base.legalAndOtherPct);
  const expectedDelta = (2 * base.dueDiligenceCostPerAsset) / denom;
  approx(r1.totalPrice - r3.totalPrice, expectedDelta, 0.01, 'delta');
});

test('cash <= fixedCosts returns an error state, not a negative price', () => {
  const r = computePurchaseCapacity({ ...DEFAULT_INPUTS, cash: 10_000, dueDiligenceCostPerAsset: 22_000, numberOfAssets: 1 });
  assert.equal(r.error, 'CASH_BELOW_FIXED_COSTS');
});

test('lvr = 0 makes ICR infinite (no debt)', () => {
  const results = computeAll({ ...DEFAULT_INPUTS, lvr: 0 });
  assert.equal(results.core.ICR, Infinity);
});

test('numberOfAssets change recomputes fixedCosts before totalPrice (no stale purchasing power)', () => {
  const r3 = computePurchaseCapacity({ ...DEFAULT_INPUTS, numberOfAssets: 3, dueDiligenceCostPerAsset: 22_000 });
  assert.equal(r3.fixedCosts, 66_000);
  assert.ok(r3.totalPrice < computePurchaseCapacity({ ...DEFAULT_INPUTS, numberOfAssets: 1, dueDiligenceCostPerAsset: 22_000 }).totalPrice);
});

test('advanced-mode NOI waterfall is internally consistent (EGI - nonRecoverable - mgmt - capex)', () => {
  const inputs = { ...DEFAULT_INPUTS, mode: 'advanced' };
  const fin = computeOperatingFinancials(inputs, 3_500_000);
  const recomputed = fin.EGI - fin.nonRecoverable - fin.managementFee - fin.capexReserve;
  approx(fin.NOI, recomputed, 1e-6, 'NOI waterfall');
});

test('outgoingsInflation > rentGrowth compresses NOI margin over the hold (base scenario)', () => {
  const inputs = { ...DEFAULT_INPUTS, mode: 'advanced', holdYears: 10, rentGrowth: 0.03, outgoingsInflation: 0.04 };
  const results = computeAll(inputs);
  const base = results.scenarios.base;
  const marginYear1 = base.years[0].NOI / base.years[0].baseRent;
  const marginYear10 = base.years[9].NOI / base.years[9].baseRent;
  assert.ok(marginYear10 < marginYear1, 'NOI margin should compress, not improve, by default');
});

test('the 4% fixed lease-increase default compounds into a higher property value at exit', () => {
  const lower = computeAll({ ...DEFAULT_INPUTS, mode: 'advanced', holdYears: 5, rentGrowth: 0.02 });
  const higher = computeAll({ ...DEFAULT_INPUTS, mode: 'advanced', holdYears: 5, rentGrowth: 0.04 });
  const lowerExitValue = lower.scenarios.base.years[4].value;
  const higherExitValue = higher.scenarios.base.years[4].value;
  assert.ok(higherExitValue > lowerExitValue, 'a higher fixed rent increase should raise projected NOI and thus exit value');
});

test('DEFAULT_INPUTS.rentGrowth reflects the standard 4% p.a. lease increase clause', () => {
  assert.equal(DEFAULT_INPUTS.rentGrowth, 0.04);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.log('SOME TESTS FAILED');
} else {
  console.log('ALL TESTS PASSED');
}
