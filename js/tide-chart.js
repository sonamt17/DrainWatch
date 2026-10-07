// Small inline-SVG chart of the next 48 h of predicted water levels,
// with NOAA's minor / moderate / major flood thresholds drawn across it.

const W = 340;
const H = 170;
const PAD = { top: 10, right: 58, bottom: 20, left: 30 };

export function tideChartSvg({ predictions, latest, surge, thresholds }) {
  if (!predictions.length) return '';
  const shift = surge != null && surge > 0 ? surge : 0;
  const values = predictions.map((p) => p.v + shift);
  const yMin = Math.floor(Math.min(...values, -6));
  const yMax = Math.ceil(Math.max(...values, thresholds.major + 0.5));
  const x = (i) => PAD.left + (i / (predictions.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(values.length - 1).toFixed(1)},${y(yMin)}L${x(0).toFixed(1)},${y(yMin)}Z`;

  // keep the three threshold labels from overlapping when they sit close together
  let lastLabelY = Infinity;
  const thresholdLines = [
    ['minor', thresholds.minor],
    ['moderate', thresholds.moderate],
    ['major', thresholds.major],
  ]
    .map(([name, v]) => {
      const labelY = Math.min(y(v) + 3, lastLabelY - 11);
      lastLabelY = labelY;
      return `
      <line class="thr thr-${name}" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" />
      <text class="thr-label thr-${name}" x="${W - PAD.right + 4}" y="${labelY}">${name}</text>`;
    })
    .join('');

  // y-axis ticks every 2 ft
  let ticks = '';
  for (let v = Math.ceil(yMin / 2) * 2; v <= yMax; v += 2) {
    ticks += `<text class="tick" x="${PAD.left - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  }

  // label each midnight along the x-axis
  let days = '';
  predictions.forEach((p, i) => {
    if (p.t.endsWith('00:00')) {
      const d = new Date(p.t.slice(0, 10) + 'T12:00:00');
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      days += `<line class="day" x1="${x(i)}" x2="${x(i)}" y1="${PAD.top}" y2="${H - PAD.bottom}" />
        <text class="tick" x="${x(i) + 3}" y="${H - 6}">${label}</text>`;
    }
  });

  const nowDot = latest ? `<circle class="now" cx="${x(0)}" cy="${y(latest.v)}" r="4"><title>Now: ${latest.v.toFixed(2)} ft</title></circle>` : '';

  return `
    <svg class="tide-chart" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Predicted water level for the next 48 hours compared with flood thresholds">
      ${ticks}${days}
      <path class="tide-area" d="${area}" />
      <path class="tide-line" d="${line}" />
      ${thresholdLines}
      ${nowDot}
    </svg>
    <p class="chart-note">Feet above normal high tide (MHHW). Forecast = predicted tide${shift ? ` + ${shift.toFixed(2)} ft current surge` : ''}.</p>`;
}
