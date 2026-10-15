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

// sides: [{ side, label, cycles: [[101点], ...], mean, sd, toeOffPercent }]
function buildConfig(title, sides, yLabel) {
  const datasets = [];
  const lines = [];

  sides.forEach(({ side, label, cycles, mean, sd, toeOffPercent }) => {
    const color = SIDE_COLORS[side];

    cycles.forEach((values, i) => {
      datasets.push({
        label: `${label} cycle ${i + 1}`,
        data: toPoints(values),
        borderColor: withAlpha(color, 0.3),
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        isAux: true,
      });
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

export function renderChart(canvas, title, sides, yLabel = 'Angle (deg)') {
  const existing = chartRegistry.get(canvas);
  if (existing) {
    existing.destroy();
  }
  const chart = new Chart(canvas, buildConfig(title, sides, yLabel));
  chartRegistry.set(canvas, chart);
  return chart;
}

export function chartToPngDataUrl(chart) {
  return chart.canvas.toDataURL('image/png');
}
