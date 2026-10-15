import { getColumn } from './motParser.js';
import { SIDE_VARIABLES } from './validators.js';

// x は昇順であることを前提とする。targetXを挟む2点を線形補間して返す。
export function linearInterpolate(x, y, targetX) {
  const n = x.length;
  if (n === 0) return NaN;
  if (n === 1) return y[0];
  if (targetX <= x[0]) return y[0];
  if (targetX >= x[n - 1]) return y[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= targetX) lo = mid;
    else hi = mid;
  }

  const x1 = x[lo];
  const x2 = x[hi];
  const y1 = y[lo];
  const y2 = y[hi];
  if (x2 === x1) return y1;
  return y1 + ((targetX - x1) * (y2 - y1)) / (x2 - x1);
}

// 1st IC〜2nd IC (両端を含む) の区間を抽出し、gait cycle %を付与する
export function extractGaitCycleSegment(motData, side, firstIC, secondIC) {
  const vars = SIDE_VARIABLES[side];
  const time = getColumn(motData, 'time');
  const hip = getColumn(motData, vars.hip);
  const knee = getColumn(motData, vars.knee);
  const ankle = getColumn(motData, vars.ankle);

  const start = firstIC.sampleIndex;
  const end = secondIC.sampleIndex;

  const segTime = time.slice(start, end + 1);
  const segHip = hip.slice(start, end + 1);
  const segKnee = knee.slice(start, end + 1);
  const segAnkle = ankle.slice(start, end + 1);

  const timeStart = segTime[0];
  const timeEnd = segTime[segTime.length - 1];
  const gaitCyclePercent = segTime.map(
    (t) => ((t - timeStart) / (timeEnd - timeStart)) * 100
  );

  const sampleIndices = [];
  for (let i = start; i <= end; i += 1) sampleIndices.push(i);

  return {
    sampleIndices,
    time: segTime,
    gaitCyclePercent,
    hip: segHip,
    knee: segKnee,
    ankle: segAnkle,
    timeStart,
    timeEnd,
  };
}

// gait cycle %(不等間隔)を0-100%の101点へ線形補間する。境界は元IC1/IC2の値と厳密一致させる。
export function normalizeTo101Points(gaitCyclePercent, values) {
  const targets = Array.from({ length: 101 }, (_, i) => i);
  const normalized = targets.map((t) => linearInterpolate(gaitCyclePercent, values, t));
  normalized[0] = values[0];
  normalized[100] = values[values.length - 1];
  return normalized;
}

export function normalizeGaitCycle(motData, side, firstIC, secondIC) {
  const segment = extractGaitCycleSegment(motData, side, firstIC, secondIC);

  const normalized = {
    gaitCyclePercent: Array.from({ length: 101 }, (_, i) => i),
    hip: normalizeTo101Points(segment.gaitCyclePercent, segment.hip),
    knee: normalizeTo101Points(segment.gaitCyclePercent, segment.knee),
    ankle: normalizeTo101Points(segment.gaitCyclePercent, segment.ankle),
  };

  return { original: segment, normalized };
}

// MOTファイルに含まれる全変数（pelvis, lumbar, arm等を含む）を101点へ正規化する。
// hip/knee/ankleの3角度に限定しない拡張出力用（NFR-006: 追加変数への拡張性）。
export function normalizeAllVariables(motData, firstIC, secondIC) {
  const time = getColumn(motData, 'time');
  const start = firstIC.sampleIndex;
  const end = secondIC.sampleIndex;

  const segTime = time.slice(start, end + 1);
  const timeStart = segTime[0];
  const timeEnd = segTime[segTime.length - 1];
  const gaitCyclePercent = segTime.map(
    (t) => ((t - timeStart) / (timeEnd - timeStart)) * 100
  );

  const variableNames = motData.headers.filter((name) => name.toLowerCase() !== 'time');
  const values = {};
  variableNames.forEach((name) => {
    const seg = motData.columns[name].slice(start, end + 1);
    values[name] = normalizeTo101Points(gaitCyclePercent, seg);
  });

  return {
    gaitCyclePercent: Array.from({ length: 101 }, (_, i) => i),
    variableNames,
    values,
  };
}

// 101点の系列の配列から、各点の平均と標本標準偏差（n-1）を求める。1周期のみの場合SDは空欄(null)。
export function meanAndSD(seriesList) {
  const n = seriesList.length;
  const mean = [];
  const sd = [];
  for (let i = 0; i <= 100; i += 1) {
    const values = seriesList.map((s) => s[i]);
    const m = values.reduce((a, b) => a + b, 0) / n;
    mean.push(m);
    sd.push(n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) : null);
  }
  return { mean, sd };
}

export function scalarMeanSD(values) {
  const valid = values.filter((v) => v !== null && v !== undefined);
  if (valid.length === 0) return { mean: null, sd: null, n: 0 };
  const m = valid.reduce((a, b) => a + b, 0) / valid.length;
  const sd =
    valid.length > 1 ? Math.sqrt(valid.reduce((a, v) => a + (v - m) ** 2, 0) / (valid.length - 1)) : null;
  return { mean: m, sd, n: valid.length };
}

// 指定側の全歩行周期をそれぞれ101点へ正規化し、周期間の平均±SDをまとめる。
export function analyzeSide(motData, side, cycles) {
  const analyzedCycles = cycles.map((cycle) => {
    const { original, normalized } = normalizeGaitCycle(motData, side, cycle.start, cycle.end);
    const allNormalized = normalizeAllVariables(motData, cycle.start, cycle.end);
    return { ...cycle, original, normalized, allNormalized };
  });

  const summary = {};
  for (const joint of ['hip', 'knee', 'ankle']) {
    summary[joint] = meanAndSD(analyzedCycles.map((c) => c.normalized[joint]));
  }

  return {
    side,
    cycles: analyzedCycles,
    summary,
    duration: scalarMeanSD(analyzedCycles.map((c) => c.duration)),
    stancePercent: scalarMeanSD(analyzedCycles.map((c) => c.stancePercent)),
    oppositeToeOffPercent: scalarMeanSD(analyzedCycles.map((c) => c.oppositeToeOffPercent)),
    oppositeICPercent: scalarMeanSD(analyzedCycles.map((c) => c.oppositeICPercent)),
  };
}
