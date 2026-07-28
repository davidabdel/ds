// Minimal dependency-free SVG chart helpers. Each function returns an SVG string.

const NS = 'http://www.w3.org/2000/svg';

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function el(tag, attrs = {}, children = []) {
  const parts = [`<${tag}`];
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    parts.push(` ${k}="${escapeAttr(v)}"`);
  }
  if (children.length === 0) return parts.join('') + '/>';
  return parts.join('') + '>' + children.join('') + `</${tag}>`;
}

function scaleLinear(domain, range) {
  const [d0, d1] = domain, [r0, r1] = range;
  const m = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * m;
}

// --- 8.1 Equity over time ------------------------------------------------

export function equityChart({ years, worst, base, best, initialCash, reviewYear, tooltips, width = 640, height = 300 }) {
  const margin = { top: 16, right: 16, bottom: 28, left: 64 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  const allVals = [0, initialCash, ...worst, ...base, ...best];
  const yMax = Math.max(...allVals) * 1.08;
  const yMin = Math.min(0, Math.min(...allVals) * 1.08);

  const x = scaleLinear([0, years.length - 1], [0, w]);
  const y = scaleLinear([yMin, yMax], [h, 0]);

  const path = (vals) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const band = worst.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    + ' ' + best.map((v, i) => `L${x(years.length - 1 - i).toFixed(1)},${y(best[years.length - 1 - i]).toFixed(1)}`).join(' ') + ' Z';

  const yTicks = 5;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks);

  const reviewX = reviewYear != null && reviewYear <= years.length - 1 ? x(reviewYear) : null;

  const colW = years.length > 1 ? w / (years.length - 1) : w;
  const hitColumns = tooltips ? years.map((_, i) => el('rect', {
    x: (x(i) - colW / 2).toFixed(1), y: 0, width: colW.toFixed(1), height: h.toFixed(1),
    fill: 'transparent', 'pointer-events': 'all', 'data-tooltip': tooltips[i],
  })) : [];

  const parts = [];
  parts.push(el('g', { transform: `translate(${margin.left},${margin.top})` }, [
    ...ticks.map((t) => el('line', { x1: 0, x2: w, y1: y(t).toFixed(1), y2: y(t).toFixed(1), stroke: 'var(--line)', 'stroke-width': 1 })),
    ...ticks.map((t) => el('text', { x: -8, y: y(t).toFixed(1), 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'chart-label' }, [fmtCompact(t)])),
    el('line', { x1: 0, x2: w, y1: y(initialCash).toFixed(1), y2: y(initialCash).toFixed(1), stroke: 'var(--ink)', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.6 }),
    el('text', { x: w, y: y(initialCash) - 6, 'text-anchor': 'end', class: 'chart-label' }, ['starting cash']),
    reviewX != null ? el('line', { x1: reviewX.toFixed(1), x2: reviewX.toFixed(1), y1: 0, y2: h, stroke: 'var(--gold-line, #9a7b12)', 'stroke-width': 1, 'stroke-dasharray': '4 3' }) : '',
    reviewX != null ? el('text', { x: reviewX.toFixed(1), y: -4, 'text-anchor': 'middle', class: 'chart-label' }, ['facility review']) : '',
    el('path', { d: band, fill: 'var(--band)', stroke: 'none' }),
    el('path', { d: path(worst), fill: 'none', stroke: 'var(--worst)', 'stroke-width': 2 }),
    el('path', { d: path(base), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2.5 }),
    el('path', { d: path(best), fill: 'none', stroke: 'var(--best)', 'stroke-width': 2 }),
    ...years.map((_, i) => el('text', { x: x(i).toFixed(1), y: h + 18, 'text-anchor': 'middle', class: 'chart-label' }, [`Y${i}`])),
    ...hitColumns,
  ]));
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Equity over time, worst base best">${parts.join('')}</svg>`;
}

// --- 8.2 Annual cash flow -------------------------------------------------

export function cashFlowChart({ years, noi, debtService, netCF, tooltips, width = 640, height = 300 }) {
  const margin = { top: 16, right: 40, bottom: 28, left: 56 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const n = years.length;
  const bw = (w / n) * 0.6;
  const colW = w / n;

  const yMax = Math.max(...noi, 1) * 1.15;
  const yMin = Math.min(0, ...debtService.map((d) => -d)) * 1.15;
  const y = scaleLinear([yMin, yMax], [h, 0]);
  const x = (i) => (w / n) * i + (w / n - bw) / 2;

  const cfMax = Math.max(...netCF.map(Math.abs), 1) * 1.2;
  const yCF = scaleLinear([-cfMax, cfMax], [h, 0]);

  const zero = y(0);
  const bars = years.map((_, i) => {
    const bx = x(i);
    const noiH = zero - y(noi[i]);
    const dsH = y(0) - y(-debtService[i]);
    return el('g', {}, [
      el('rect', { x: bx.toFixed(1), y: y(noi[i]).toFixed(1), width: bw.toFixed(1), height: Math.max(0, noiH).toFixed(1), fill: 'var(--ink)', opacity: 0.85 }),
      el('rect', { x: bx.toFixed(1), y: zero.toFixed(1), width: bw.toFixed(1), height: Math.max(0, dsH).toFixed(1), fill: 'var(--worst)', opacity: 0.75 }),
    ]);
  });

  const linePts = netCF.map((v, i) => `${x(i) + bw / 2},${yCF(v).toFixed(1)}`);
  const line = 'M' + linePts.join(' L');

  const hitColumns = tooltips ? years.map((_, i) => el('rect', {
    x: (colW * i).toFixed(1), y: 0, width: colW.toFixed(1), height: h.toFixed(1),
    fill: 'transparent', 'pointer-events': 'all', 'data-tooltip': tooltips[i],
  })) : [];

  const parts = [];
  parts.push(el('g', { transform: `translate(${margin.left},${margin.top})` }, [
    el('line', { x1: 0, x2: w, y1: zero.toFixed(1), y2: zero.toFixed(1), stroke: 'var(--line)', 'stroke-width': 1 }),
    ...bars,
    el('path', { d: line, fill: 'none', stroke: 'var(--best)', 'stroke-width': 2 }),
    ...netCF.map((v, i) => el('circle', { cx: (x(i) + bw / 2).toFixed(1), cy: yCF(v).toFixed(1), r: 3, fill: v < 0 ? 'var(--worst)' : 'var(--best)' })),
    ...years.map((_, i) => el('text', { x: (x(i) + bw / 2).toFixed(1), y: h + 18, 'text-anchor': 'middle', class: 'chart-label' }, [`Y${i + 1}`])),
    ...hitColumns,
  ]));
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Annual cash flow: NOI, debt service, net cash flow">${parts.join('')}</svg>`;
}

// --- 8.3 Sensitivity grid --------------------------------------------------

export function sensitivityGrid({ rows, cols, values, currentRowIdx, currentColIdx, width = 640, height = 340, fmt }) {
  const margin = { top: 30, right: 16, bottom: 16, left: 70 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const cw = w / cols.length;
  const ch = h / rows.length;

  const flat = values.flat().filter((v) => isFinite(v));
  const maxAbsDelta = Math.max(0.01, ...flat.map((v) => Math.abs(v - 1)));

  function color(v) {
    if (!isFinite(v)) return '#888';
    const t = Math.max(-1, Math.min(1, (v - 1) / maxAbsDelta));
    if (t >= 0) {
      const g = Math.round(180 - t * 60), r = Math.round(200 - t * 140);
      return `rgb(${r},${Math.round(120+t*70)},${g > 90 ? 90 : g})`;
    }
    const r = Math.round(200 + Math.abs(t) * 30);
    return `rgb(${Math.min(200,r)},${Math.round(70 - Math.abs(t) * 30)},${Math.round(60 - Math.abs(t) * 30)})`;
  }

  const cells = [];
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < cols.length; ci++) {
      const v = values[ri][ci];
      const cx = margin.left + ci * cw, cy = margin.top + ri * ch;
      const isCurrent = ri === currentRowIdx && ci === currentColIdx;
      cells.push(el('rect', {
        x: cx.toFixed(1), y: cy.toFixed(1), width: cw.toFixed(1), height: ch.toFixed(1),
        fill: color(v), stroke: isCurrent ? 'var(--ink)' : '#fff', 'stroke-width': isCurrent ? 2.5 : 1,
      }));
      cells.push(el('text', {
        x: (cx + cw / 2).toFixed(1), y: (cy + ch / 2 + 4).toFixed(1), 'text-anchor': 'middle',
        class: 'chart-cell-label',
      }, [fmt ? fmt(v) : v.toFixed(2)]));
    }
  }

  const colLabels = cols.map((c, ci) => el('text', {
    x: (margin.left + ci * cw + cw / 2).toFixed(1), y: margin.top - 10, 'text-anchor': 'middle', class: 'chart-label',
  }, [c]));
  const rowLabels = rows.map((r, ri) => el('text', {
    x: margin.left - 10, y: (margin.top + ri * ch + ch / 2 + 4).toFixed(1), 'text-anchor': 'end', class: 'chart-label',
  }, [r]));

  const parts = [...colLabels, ...rowLabels, ...cells];
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Sensitivity grid of equity multiple by interest rate and exit cap rate">${parts.join('')}</svg>`;
}

// --- 8.4 Break-even occupancy ----------------------------------------------

export function breakEvenBar({ breakEven, currentOccupancy, tenantTicks, width = 640, height = 120 }) {
  const margin = { left: 12, right: 12, top: 40, bottom: 28 };
  const w = width - margin.left - margin.right;
  const x = scaleLinear([0, 1], [0, w]);
  const barH = 22;

  const segs = [];
  const clampedBE = Math.min(1, breakEven);
  segs.push(el('rect', { x: 0, y: 0, width: w, height: barH, fill: 'var(--track)', rx: 4 }));
  segs.push(el('rect', { x: 0, y: 0, width: x(clampedBE).toFixed(1), height: barH, fill: breakEven > 1 ? 'var(--worst)' : 'var(--band-strong)', rx: 4 }));

  const ticks = tenantTicks.map((t) => el('g', {}, [
    el('line', { x1: x(t).toFixed(1), x2: x(t).toFixed(1), y1: -4, y2: barH + 4, stroke: 'var(--grey)', 'stroke-width': 1 }),
  ]));

  const beMarker = el('g', {}, [
    el('line', { x1: x(clampedBE).toFixed(1), x2: x(clampedBE).toFixed(1), y1: -8, y2: barH + 8, stroke: 'var(--ink)', 'stroke-width': 2 }),
    el('text', { x: x(clampedBE).toFixed(1), y: -12, 'text-anchor': 'middle', class: 'chart-label-bold' }, [`break-even ${(breakEven * 100).toFixed(0)}%`]),
  ]);
  const occMarker = el('g', {}, [
    el('circle', { cx: x(Math.min(1, currentOccupancy)).toFixed(1), cy: barH / 2, r: 6, fill: '#fff', stroke: 'var(--ink)', 'stroke-width': 2 }),
    el('text', { x: x(Math.min(1, currentOccupancy)).toFixed(1), y: barH + 24, 'text-anchor': 'middle', class: 'chart-label' }, [`current ${(currentOccupancy * 100).toFixed(0)}%`]),
  ]);

  const parts = el('g', { transform: `translate(${margin.left},${margin.top})` }, [...segs, ...ticks, beMarker, occMarker]);
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Break-even occupancy">${parts}</svg>`;
}

// --- 8.5 Portfolio split comparison -----------------------------------------

export function portfolioBar({ labels, values, fmt, width = 640, height = 260 }) {
  const margin = { top: 16, right: 16, bottom: 32, left: 64 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  const n = values.length;
  const bw = (w / n) * 0.55;
  const vMax = Math.max(...values, 0) * 1.15 || 1;
  const vMin = Math.min(0, ...values) * 1.15;
  const y = scaleLinear([vMin, vMax], [h, 0]);
  const zero = y(0);

  const bars = values.map((v, i) => {
    const bx = (w / n) * i + (w / n - bw) / 2;
    const barH = Math.abs(y(v) - zero);
    return el('g', {}, [
      el('rect', { x: bx.toFixed(1), y: Math.min(y(v), zero).toFixed(1), width: bw.toFixed(1), height: barH.toFixed(1), fill: 'var(--ink)', rx: 3 }),
      el('text', { x: (bx + bw / 2).toFixed(1), y: (y(v) - (v >= 0 ? 8 : -18)).toFixed(1), 'text-anchor': 'middle', class: 'chart-label-bold' }, [fmt ? fmt(v) : v]),
      el('text', { x: (bx + bw / 2).toFixed(1), y: h + 18, 'text-anchor': 'middle', class: 'chart-label' }, [labels[i]]),
    ]);
  });

  const parts = el('g', { transform: `translate(${margin.left},${margin.top})` }, [
    el('line', { x1: 0, x2: w, y1: zero.toFixed(1), y2: zero.toFixed(1), stroke: 'var(--line)', 'stroke-width': 1 }),
    ...bars,
  ]);
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Portfolio split comparison">${parts}</svg>`;
}

function fmtCompact(v) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v)}`;
}
