// 歩行周期ごとの時間・距離因子（歩行速度、歩幅、立脚・遊脚時間、荷重応答期・前遊脚期時間）。
// 定義は OpenCap の gait_analysis.py に合わせる:
// - 歩幅: 同側IC時の同側踵マーカー（*_calc_study）と、その直前の対側IC時の対側踵マーカーの進行方向距離
// - 歩行速度: 周期開始IC→次ICの基準点（身体重心。なければ骨盤マーカー中心）の水平変位 ÷ 周期時間
// - 立脚時間: IC→同側TO、遊脚時間: 同側TO→次の同側IC
// - 荷重応答期: IC→対側TO（第1両脚支持期）、前遊脚期: 対側IC→同側TO（第2両脚支持期）

import { scalarMeanSD } from './normalizer.js';
import { progressionFrame, alongForward } from '../utils/progression.js';

export const SPATIOTEMPORAL_PARAMS = [
  { key: 'speed', label: '歩行速度', en: 'Walking speed', unit: 'm/s', digits: 2 },
  { key: 'stepLength', label: '歩幅', en: 'Step length', unit: 'm', digits: 3 },
  { key: 'stanceTime', label: '立脚時間', en: 'Stance time', unit: 's', digits: 3, percentKey: 'stancePercent' },
  { key: 'swingTime', label: '遊脚時間', en: 'Swing time', unit: 's', digits: 3, percentKey: 'swingPercent' },
  { key: 'loadingResponse', label: '荷重応答期時間', en: 'Loading response time', unit: 's', digits: 3, percentKey: 'loadingResponsePercent' },
  { key: 'preSwing', label: '前遊脚期時間', en: 'Pre-swing time', unit: 's', digits: 3, percentKey: 'preSwingPercent' },
];

export const HEEL_MARKERS = { R: 'r_calc_study', L: 'L_calc_study' };
export const PELVIS_MARKERS = ['r.ASIS_study', 'L.ASIS_study', 'r.PSIS_study', 'L.PSIS_study'];

function findMarker(markerData, name) {
  if (!markerData) return null;
  const key = Object.keys(markerData.markers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? markerData.markers[key] : null;
}

function nearestIndex(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[hi] - t) < Math.abs(times[lo] - t) ? hi : lo;
}

// 時刻 t における基準点（進行方向・歩行速度用）
function referenceAt(sources, event) {
  if (sources.com) {
    const i = event.sampleIndex;
    return [sources.com.x[i], sources.com.y[i], sources.com.z[i]];
  }
  const pelvis = PELVIS_MARKERS.map((n) => findMarker(sources.markers, n));
  if (pelvis.every(Boolean)) {
    const i = nearestIndex(sources.markers.time, event.motTime);
    return [0, 1, 2].map((a) => pelvis.reduce((s, m) => s + m[i][a], 0) / pelvis.length);
  }
  return null;
}

function heelAt(sources, side, event) {
  const traj = findMarker(sources.markers, HEEL_MARKERS[side]);
  if (!traj) return null;
  return traj[nearestIndex(sources.markers.time, event.motTime)];
}

const pct = (value, duration) => (value === null ? null : (value / duration) * 100);

// sources: { com: 身体重心時系列 | null, markers: { time, markers } | null }
export function computeCycleParameters(cycle, sources) {
  const opposite = cycle.side === 'R' ? 'L' : 'R';
  const t0 = cycle.start.motTime;
  const t1 = cycle.end.motTime;
  const duration = t1 - t0;
  const tTO = cycle.toeOff ? cycle.toeOff.motTime : null;

  const stanceTime = tTO === null ? null : tTO - t0;
  const swingTime = tTO === null ? null : t1 - tTO;
  // 対側TOが同側TOより前（立脚期内）にある場合のみ有効
  const loadingResponse =
    cycle.oppositeToeOff && (tTO === null || cycle.oppositeToeOff.motTime < tTO)
      ? cycle.oppositeToeOff.motTime - t0
      : null;
  const preSwing =
    cycle.oppositeIC && tTO !== null && cycle.oppositeIC.motTime < tTO ? tTO - cycle.oppositeIC.motTime : null;

  let speed = null;
  let stepLength = null;
  const p0 = referenceAt(sources, cycle.start);
  const p1 = referenceAt(sources, cycle.end);
  const frame = p0 && p1 ? progressionFrame(p0, p1) : null;
  if (frame && frame.defined) {
    speed = frame.distance / duration;
    if (cycle.oppositeIC) {
      const heel = heelAt(sources, cycle.side, cycle.end);
      const oppHeel = heelAt(sources, opposite, cycle.oppositeIC);
      if (heel && oppHeel) stepLength = alongForward(frame, heel) - alongForward(frame, oppHeel);
    }
  }

  return {
    speed,
    stepLength,
    stanceTime,
    swingTime,
    loadingResponse,
    preSwing,
    stancePercent: pct(stanceTime, duration),
    swingPercent: pct(swingTime, duration),
    loadingResponsePercent: pct(loadingResponse, duration),
    preSwingPercent: pct(preSwing, duration),
  };
}

export function analyzeSpatioTemporal(cycles, sources) {
  const perCycle = cycles.map((c) => computeCycleParameters(c, sources));
  const summary = {};
  for (const p of SPATIOTEMPORAL_PARAMS) {
    summary[p.key] = scalarMeanSD(perCycle.map((c) => c[p.key]));
    if (p.percentKey) summary[p.percentKey] = scalarMeanSD(perCycle.map((c) => c[p.percentKey]));
  }
  return { cycles: perCycle, summary };
}
