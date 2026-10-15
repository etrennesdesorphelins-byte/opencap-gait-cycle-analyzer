import Chart from 'chart.js/auto';

const chartRegistry = new Map();

export const SIDE_COLORS = { R: '#dc2626', L: '#2563eb' };

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const toPoints = (values) => values.map((y, x) => ({ x, y }));

// 各側の平均Toe Off(%)位置に破線の縦線を描く
const toeOffLinePlugin = {
  id: 'toeOffLines',
  afterDatasetsDraw(chart, _args, opts) {
    const lines = (opts && opts.lines) || [];
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    lines.forEach(({ percent, color, label }, idx) => {
      if (percent === null || percent === undefined) return;
      const x = scales.x.getPixelForValue(percent);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, chartArea.top + 12 + idx * 13);
    });
    ctx.restore();
  },
};

// 選択した歩行周期の強調表示色（左右の色と区別できる色）
const SELECTED_COLOR = '#f59e0b';
// クリック位置から歩行周期の線を選ぶときの許容距離 [px]
const PICK_TOLERANCE = 10;

function cycleStyle(dataset, selected) {
  return selected
    ? { borderColor: SELECTED_COLOR, borderWidth: 3, order: -1 }
    : { borderColor: withAlpha(SIDE_COLORS[dataset.side], 0.3), borderWidth: 1, order: 0 };
}

// クリック位置に最も近い歩行周期の線（細線）を探す。平均・SDは対象外
function pickCycle(chart, event) {
  const { x: xScale, y: yScale } = chart.scales;
  const { chartArea } = chart;
  if (event.x < chartArea.left || event.x > chartArea.right || event.y < chartArea.top || event.y > chartArea.bottom) {
    return null;
  }
  const xValue = xScale.getValueForPixel(event.x);
  const i0 = Math.max(0, Math.min(99, Math.floor(xValue)));
  const t = Math.max(0, Math.min(1, xValue - i0));
  let best = null;
  chart.data.datasets.forEach((ds, di) => {
    if (!ds.cycleKey || !chart.isDatasetVisible(di)) return;
    const y = ds.data[i0].y + (ds.data[i0 + 1].y - ds.data[i0].y) * t;
    const dist = Math.abs(yScale.getPixelForValue(y) - event.y);
    if (dist <= PICK_TOLERANCE && (!best || dist < best.dist)) best = { key: ds.cycleKey, dist };
  });
  return best ? best.key : null;
}

// sides: [{ side, label, cycles: [[101点], ...], cycleKeys: [周期の識別子, ...], mean, sd, toeOffPercent }]
function buildConfig(title, sides, yLabel, { onCycleClick, selectedKey } = {}) {
  const datasets = [];
  const lines = [];

  sides.forEach(({ side, label, cycles, cycleKeys, mean, sd, toeOffPercent }) => {
    const color = SIDE_COLORS[side];

    cycles.forEach((values, i) => {
      const dataset = {
        label: `${label} cycle ${i + 1}`,
        data: toPoints(values),
        pointRadius: 0,
        fill: false,
        isAux: true,
        side,
        cycleKey: cycleKeys ? cycleKeys[i] : null,
      };
      Object.assign(dataset, cycleStyle(dataset, dataset.cycleKey !== null && dataset.cycleKey === selectedKey));
      datasets.push(dataset);
    });

    if (sd.every((v) => v !== null)) {
      datasets.push({
        label: `${label} +SD`,
        data: toPoints(mean.map((m, i) => m + sd[i])),
        borderWidth: 0,
        pointRadius: 0,
        backgroundColor: withAlpha(color, 0.15),
        fill: '+1',
        isAux: true,
      });
      datasets.push({
        label: `${label} -SD`,
        data: toPoints(mean.map((m, i) => m - sd[i])),
        borderWidth: 0,
        pointRadius: 0,
        fill: false,
        isAux: true,
      });
    }

    datasets.push({
      label: cycles.length > 1 ? `${label} mean (n=${cycles.length})` : label,
      data: toPoints(mean),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2.5,
      pointRadius: 0,
      fill: false,
    });

    lines.push({ percent: toeOffPercent, color, label: `${side} TO` });
  });

  return {
    type: 'line',
    data: { datasets },
    plugins: [toeOffLinePlugin],
    options: {
      responsive: true,
      animation: false,
      parsing: false,
      onClick: onCycleClick ? (event, _els, chart) => onCycleClick(pickCycle(chart, event)) : undefined,
      onHover: onCycleClick
        ? (event, _els, chart) => {
            chart.canvas.style.cursor = pickCycle(chart, event) ? 'pointer' : 'default';
          }
        : undefined,
      plugins: {
        title: { display: true, text: title },
        legend: {
          display: true,
          labels: { filter: (item, data) => !data.datasets[item.datasetIndex].isAux },
        },
        tooltip: { filter: (item) => !item.dataset.isAux },
        toeOffLines: { lines },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 100,
          title: { display: true, text: 'Gait Cycle (%)' },
        },
        y: {
          title: { display: true, text: yLabel },
        },
      },
    },
  };
}

// options.onCycleClick(key | null): 歩行周期の線（またはそれ以外の場所）がクリックされたとき
// options.selectedKey: 最初から強調表示する周期
export function renderChart(canvas, title, sides, yLabel = 'Angle (deg)', options = {}) {
  const existing = chartRegistry.get(canvas);
  if (existing) {
    existing.destroy();
  }
  const chart = new Chart(canvas, buildConfig(title, sides, yLabel, options));
  chartRegistry.set(canvas, chart);
  return chart;
}

// 指定した周期（key、null で解除）を強調表示する
export function highlightCycle(chart, key) {
  chart.data.datasets.forEach((ds) => {
    if (ds.cycleKey === undefined || ds.cycleKey === null) return;
    Object.assign(ds, cycleStyle(ds, ds.cycleKey === key));
  });
  chart.update('none');
}

export function chartToPngDataUrl(chart) {
  return chart.canvas.toDataURL('image/png');
}
