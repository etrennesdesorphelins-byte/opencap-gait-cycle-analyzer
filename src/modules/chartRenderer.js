import Chart from 'chart.js/auto';

const chartRegistry = new Map();

function buildConfig(title, values) {
  return {
    type: 'line',
    data: {
      labels: Array.from({ length: 101 }, (_, i) => i),
      datasets: [
        {
          label: title,
          data: values,
          borderColor: '#2563eb',
          backgroundColor: '#2563eb',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        title: { display: true, text: title },
        legend: { display: false },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 100,
          title: { display: true, text: 'Gait Cycle (%)' },
        },
        y: {
          title: { display: true, text: 'Angle (deg)' },
        },
      },
    },
  };
}

export function renderChart(canvas, title, values) {
  const existing = chartRegistry.get(canvas);
  if (existing) {
    existing.destroy();
  }
  const chart = new Chart(canvas, buildConfig(title, values));
  chartRegistry.set(canvas, chart);
  return chart;
}

export function chartToPngDataUrl(chart) {
  return chart.canvas.toDataURL('image/png');
}
