// 身体重心(COM)時系列を歩行周期ごとに切り出し、進行方向基準の成分に分解して101点へ正規化する。
// OpenCapの地面座標系は y が鉛直上向きだが、水平面内の向きは撮影時のキャリブレーションに依存する。
// そのため周期ごとに、開始IC→次ICの水平COM変位の向きを前後(AP)軸、AP×鉛直を左右(ML, 右が正)軸とする。

import { normalizeTo101Points, meanAndSD, scalarMeanSD } from './normalizer.js';
import { progressionFrame } from '../utils/progression.js';

export const COM_SERIES = [
  // 原点基準の位置。鉛直は地面座標系の y（OpenCapでは床がほぼ y=0）、
  // 左右は原点からの水平位置を周期ごとの左右軸（右が正）へ投影した値
  { key: 'verticalPos', label: 'COM vertical position', unit: 'm' },
  { key: 'mlPos', label: 'COM mediolateral position', unit: 'm' },
  { key: 'vertical', label: 'COM vertical displacement', unit: 'cm' },
  { key: 'ml', label: 'COM mediolateral displacement', unit: 'cm' },
  { key: 'ap', label: 'COM anteroposterior displacement', unit: 'cm' },
  { key: 'vVertical', label: 'COM vertical velocity', unit: 'm/s' },
  { key: 'vAp', label: 'COM anteroposterior velocity', unit: 'm/s' },
];

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function analyzeCycle(com, cycle) {
  const start = cycle.start.sampleIndex;
  const end = cycle.end.sampleIndex;
  const idx = [];
  for (let i = start; i <= end; i += 1) idx.push(i);

  const time = idx.map((i) => com.time[i]);
  const t0 = time[0];
  const t1 = time[time.length - 1];
  const pct = time.map((t) => ((t - t0) / (t1 - t0)) * 100);

  const { defined: directionDefined, fwd, right } = progressionFrame(
    [com.x[start], com.y[start], com.z[start]],
    [com.x[end], com.y[end], com.z[end]]
  );

  const xs = idx.map((i) => com.x[i]);
  const ys = idx.map((i) => com.y[i]);
  const zs = idx.map((i) => com.z[i]);
  const mx = mean(xs);
  const my = mean(ys);
  const mz = mean(zs);

  const series = {
    verticalPos: ys,
    mlPos: xs.map((x, k) => x * right[0] + zs[k] * right[1]),
    vertical: ys.map((y) => (y - my) * 100),
    ml: xs.map((x, k) => ((x - mx) * right[0] + (zs[k] - mz) * right[1]) * 100),
    ap: xs.map((x, k) => ((x - xs[0]) * fwd[0] + (zs[k] - zs[0]) * fwd[1]) * 100),
    vVertical: idx.map((i) => com.vy[i]),
    vAp: idx.map((i) => com.vx[i] * fwd[0] + com.vz[i] * fwd[1]),
  };
  const absolute = { x: xs, y: ys, z: zs };

  const normalized = {};
  for (const { key } of COM_SERIES) normalized[key] = normalizeTo101Points(pct, series[key]);
  const normalizedAbsolute = {
    x: normalizeTo101Points(pct, absolute.x),
    y: normalizeTo101Points(pct, absolute.y),
    z: normalizeTo101Points(pct, absolute.z),
  };

  const range = (a) => Math.max(...a) - Math.min(...a);
  return {
    directionDefined,
    normalized,
    normalizedAbsolute,
    verticalExcursion: range(series.vertical),
    mlExcursion: range(series.ml),
  };
}

// 1試行の各周期についてCOMを解析する
export function analyzeComCycles(com, cycles) {
  return cycles.map((c) => analyzeCycle(com, c));
}

// COM解析済みの周期（複数試行から集めたものでもよい）の周期間の平均±SDをまとめる
export function summarizeCom(perCycle) {
  const summary = {};
  for (const { key } of COM_SERIES) {
    summary[key] = meanAndSD(perCycle.map((c) => c.normalized[key]));
  }
  return {
    cycles: perCycle,
    summary,
    verticalExcursion: scalarMeanSD(perCycle.map((c) => c.verticalExcursion)),
    mlExcursion: scalarMeanSD(perCycle.map((c) => c.mlExcursion)),
    undefinedDirectionCount: perCycle.filter((c) => !c.directionDefined).length,
  };
}
