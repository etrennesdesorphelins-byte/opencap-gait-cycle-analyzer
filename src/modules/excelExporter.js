import ExcelJS from 'exceljs';
import { SIDE_VARIABLES } from './validators.js';
import { COM_SERIES } from './comAnalysis.js';
import { SPATIOTEMPORAL_PARAMS, WALKING_SPEED } from './spatioTemporal.js';

const IMAGE_ROW_POSITIONS = { hip: 1, knee: 22, ankle: 43, comVertical: 64, comMl: 85 };
const JOINTS = [
  { key: 'hip', label: 'Hip flexion' },
  { key: 'knee', label: 'Knee flexion' },
  { key: 'ankle', label: 'Ankle angle' },
];
const SIDE_NAMES = { R: 'Right', L: 'Left' };

const blankIfNull = (v) => (v === null || v === undefined ? null : v);

// 複数のZIP・試行の歩行周期をまとめた解析結果をExcelにする。
// sideResults: { R?: summarizeSide結果, L?: ... }（cycles は側ごとの通し番号順。zipName/trialName/cycleInTrial を持つ）
// stResults: { R?: summarizeSpatioTemporal結果, L?: ... }（cycles は sideResults と同じ順）
// comResults: { R?: summarizeCom結果, L?: ... }（cycles は同じ順）または null（身体重心を算出できない試行がある場合）
// events: 全試行のイベント（zipName/trialName 付き）
// trials: 試行ごとの情報（歩行速度など）、overallSpeed: 試行間の歩行速度の平均/SD
// excluded: 解析から除外した歩行周期の情報
export function buildWorkbook({ chartImages, events, sideResults, stResults, comResults, trials, overallSpeed, excluded = [], metadata }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OpenCap Gait Cycle Analyzer';
  workbook.created = new Date();
  const sides = ['R', 'L'].filter((s) => sideResults[s]);

  // Sheet 1: Graphs
  const graphsSheet = workbook.addWorksheet('Graphs');
  Object.entries(IMAGE_ROW_POSITIONS).forEach(([key, row]) => {
    const dataUrl = chartImages[key];
    if (!dataUrl) return;
    const imageId = workbook.addImage({ base64: dataUrl, extension: 'png' });
    graphsSheet.addImage(imageId, {
      tl: { col: 0, row: row - 1 },
      ext: { width: 720, height: 360 },
    });
  });

  // Sheet 2: Gait_Events（設定した全イベント）
  const eventSheet = workbook.addWorksheet('Gait_Events');
  eventSheet.columns = [
    ...SOURCE_COLUMNS,
    { header: 'Side', key: 'side', width: 8 },
    { header: 'Event', key: 'type', width: 10 },
    { header: 'MOT sample', key: 'sample', width: 12 },
    { header: 'MOT time (s)', key: 'time', width: 14 },
    { header: 'Video time (s)', key: 'videoTime', width: 14 },
  ];
  events.forEach((e) => {
    eventSheet.addRow({
      zip: e.zipName,
      trial: e.trialName,
      side: SIDE_NAMES[e.side],
      type: e.type === 'IC' ? 'IC' : 'Toe Off',
      sample: e.sampleIndex + 1,
      time: e.motTime,
      videoTime: e.videoTime,
    });
  });

  // Sheet 3: Cycles（周期ごとの時間・立脚期% と、側ごとの平均/SD）
  const cycleSheet = workbook.addWorksheet('Cycles');
  cycleSheet.columns = [
    { header: 'Side', key: 'side', width: 8 },
    { header: 'Cycle', key: 'cycle', width: 8 },
    ...SOURCE_COLUMNS,
    { header: 'Cycle in trial', key: 'cycleInTrial', width: 14 },
    { header: 'IC sample', key: 'icSample', width: 11 },
    { header: 'IC time (s)', key: 'icTime', width: 12 },
    { header: 'Next IC sample', key: 'nextSample', width: 15 },
    { header: 'Next IC time (s)', key: 'nextTime', width: 15 },
    { header: 'Cycle duration (s)', key: 'duration', width: 17 },
    { header: 'Toe Off sample', key: 'toSample', width: 14 },
    { header: 'Toe Off time (s)', key: 'toTime', width: 15 },
    { header: 'Stance (%)', key: 'stance', width: 11 },
    { header: 'Swing (%)', key: 'swing', width: 11 },
    { header: 'Opposite Toe Off (%)', key: 'oppTo', width: 19 },
    { header: 'Opposite IC (%)', key: 'oppIc', width: 15 },
    // 立脚/遊脚の%GCは既存の Stance (%) / Swing (%) 列と同じ値なので重複させない
    ...ST_COLUMNS.filter((c) => c.key !== 'stancePercent' && c.key !== 'swingPercent').map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 2) })),
    ...(comResults
      ? [
          { header: 'COM vertical excursion (cm)', key: 'comV', width: 25 },
          { header: 'COM ML excursion (cm)', key: 'comMl', width: 21 },
        ]
      : []),
  ];
  sides.forEach((side) => {
    const result = sideResults[side];
    result.cycles.forEach((c) => {
      cycleSheet.addRow({
        side: SIDE_NAMES[side],
        cycle: c.number,
        zip: c.zipName,
        trial: c.trialName,
        cycleInTrial: c.cycleInTrial,
        icSample: c.start.sampleIndex + 1,
        icTime: c.start.motTime,
        nextSample: c.end.sampleIndex + 1,
        nextTime: c.end.motTime,
        duration: c.duration,
        toSample: c.toeOff ? c.toeOff.sampleIndex + 1 : null,
        toTime: c.toeOff ? c.toeOff.motTime : null,
        stance: blankIfNull(c.stancePercent),
        swing: blankIfNull(c.swingPercent),
        oppTo: blankIfNull(c.oppositeToeOffPercent),
        oppIc: blankIfNull(c.oppositeICPercent),
        ...stValues((key) => stResults[side].cycles[c.number - 1][key]),
        ...(comResults ? comCycleValues(comResults[side].cycles[c.number - 1]) : {}),
      });
    });
    const stance = result.stancePercent;
    for (const [label, pick] of [['Mean', 'mean'], ['SD', 'sd']]) {
      const row = cycleSheet.addRow({
        side: SIDE_NAMES[side],
        cycle: label,
        duration: blankIfNull(result.duration[pick]),
        stance: blankIfNull(stance[pick]),
        swing: stance[pick] === null ? null : pick === 'mean' ? 100 - stance.mean : stance.sd,
        oppTo: blankIfNull(result.oppositeToeOffPercent[pick]),
        oppIc: blankIfNull(result.oppositeICPercent[pick]),
        ...stValues((key) => stResults[side].summary[key][pick]),
        ...(comResults ? comSummaryValues(comResults[side], pick) : {}),
      });
      row.font = { bold: true };
    }
  });

  // Sheet 4: Spatiotemporal（歩行速度は全体の平均/SD（n=試行数）、他の時間・距離因子は側ごとの平均/SD）
  const stSheet = workbook.addWorksheet('Spatiotemporal');
  stSheet.columns = [
    { header: 'Parameter', key: 'param', width: 26 },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Overall mean', key: 'all_mean', width: 13 },
    { header: 'Overall SD', key: 'all_sd', width: 12 },
    { header: 'Overall n (trials)', key: 'all_n', width: 17 },
    ...sides.flatMap((side) => [
      { header: `${SIDE_NAMES[side]} mean`, key: `${side}_mean`, width: 13 },
      { header: `${SIDE_NAMES[side]} SD`, key: `${side}_sd`, width: 12 },
      { header: `${SIDE_NAMES[side]} n`, key: `${side}_n`, width: 9 },
    ]),
  ];
  stSheet.addRow({
    param: WALKING_SPEED.en,
    unit: WALKING_SPEED.unit,
    all_mean: blankIfNull(overallSpeed.mean),
    all_sd: blankIfNull(overallSpeed.sd),
    all_n: overallSpeed.n,
  });
  ST_COLUMNS.forEach((col) => {
    const row = { param: col.label, unit: col.unit };
    sides.forEach((side) => {
      const stat = stResults[side].summary[col.key];
      row[`${side}_mean`] = blankIfNull(stat.mean);
      row[`${side}_sd`] = blankIfNull(stat.sd);
      row[`${side}_n`] = stat.n;
    });
    stSheet.addRow(row);
  });

  // Sheet 5: Trials（試行ごとの歩行速度と周期数、データの出所）
  const trialSheet = workbook.addWorksheet('Trials');
  trialSheet.columns = [
    ...SOURCE_COLUMNS,
    { header: 'Right cycles', key: 'rCycles', width: 13 },
    { header: 'Left cycles', key: 'lCycles', width: 12 },
    { header: 'Excluded cycles', key: 'excluded', width: 16 },
    { header: 'Walking speed (m/s)', key: 'speed', width: 19 },
    { header: 'Distance (m)', key: 'distance', width: 13 },
    { header: 'Duration (s)', key: 'duration', width: 13 },
    { header: 'First IC time (s)', key: 'start', width: 16 },
    { header: 'Last IC time (s)', key: 'end', width: 16 },
    { header: 'Speed reference', key: 'ref', width: 20 },
    { header: 'COM model file', key: 'model', width: 40 },
    { header: 'COM model total mass (kg)', key: 'mass', width: 24 },
    { header: 'Step length marker source', key: 'markers', width: 40 },
  ];
  trials.forEach((t) => {
    trialSheet.addRow({
      zip: t.zipName,
      trial: t.trialName,
      rCycles: t.cycles.R,
      lCycles: t.cycles.L,
      excluded: t.excludedCycles,
      speed: t.speed ? t.speed.speed : null,
      distance: t.speed ? t.speed.distance : null,
      duration: t.speed ? t.speed.duration : null,
      start: t.speed ? t.speed.startTime : null,
      end: t.speed ? t.speed.endTime : null,
      ref: t.speedReference,
      model: t.comModel ? t.comModel.path : null,
      mass: t.comModel ? t.comModel.totalMass : null,
      markers: t.markerSource,
    });
  });

  // Sheet 6: Normalized_Data（側ごとの平均/SDと、各周期の101点正規化データ。周期番号の出所は Cycles シート参照）
  const normSheet = workbook.addWorksheet('Normalized_Data');
  const normColumns = [{ header: 'Gait cycle (%)', key: 'pct', width: 14 }];
  sides.forEach((side) => {
    JOINTS.forEach((j) => {
      normColumns.push({ header: `${side} ${j.label} mean (deg)`, key: `${side}_${j.key}_mean`, width: 22 });
      normColumns.push({ header: `${side} ${j.label} SD (deg)`, key: `${side}_${j.key}_sd`, width: 20 });
    });
  });
  sides.forEach((side) => {
    sideResults[side].cycles.forEach((c) => {
      JOINTS.forEach((j) => {
        normColumns.push({ header: `${side} C${c.number} ${j.label} (deg)`, key: `${side}_${c.number}_${j.key}`, width: 22 });
      });
    });
  });
  normSheet.columns = normColumns;
  for (let i = 0; i <= 100; i += 1) {
    const row = { pct: i };
    sides.forEach((side) => {
      const result = sideResults[side];
      JOINTS.forEach((j) => {
        row[`${side}_${j.key}_mean`] = result.summary[j.key].mean[i];
        row[`${side}_${j.key}_sd`] = blankIfNull(result.summary[j.key].sd[i]);
      });
      result.cycles.forEach((c) => {
        JOINTS.forEach((j) => {
          row[`${side}_${c.number}_${j.key}`] = c.normalized[j.key][i];
        });
      });
    });
    normSheet.addRow(row);
  }

  // Sheet 7: Original_Data（各周期の正規化前データ、縦持ち）
  const origSheet = workbook.addWorksheet('Original_Data');
  origSheet.columns = [
    { header: 'Side', key: 'side', width: 8 },
    { header: 'Cycle', key: 'cycle', width: 8 },
    ...SOURCE_COLUMNS,
    { header: 'MOT sample', key: 'sample', width: 12 },
    { header: 'Time (s)', key: 'time', width: 12 },
    { header: 'Gait cycle (%)', key: 'pct', width: 14 },
    { header: 'Hip flexion (deg)', key: 'hip', width: 18 },
    { header: 'Knee flexion (deg)', key: 'knee', width: 18 },
    { header: 'Ankle angle (deg)', key: 'ankle', width: 18 },
  ];
  sides.forEach((side) => {
    sideResults[side].cycles.forEach((c) => {
      const o = c.original;
      o.sampleIndices.forEach((sampleIdx, i) => {
        origSheet.addRow({
          side: SIDE_NAMES[side],
          cycle: c.number,
          zip: c.zipName,
          trial: c.trialName,
          sample: sampleIdx + 1, // 人が確認しやすい1始まり表示（内部インデックスは0始まりのまま）
          time: o.time[i],
          pct: o.gaitCyclePercent[i],
          hip: o.hip[i],
          knee: o.knee[i],
          ankle: o.ankle[i],
        });
      });
    });
  });

  // Sheet 8: Metadata
  const metaSheet = workbook.addWorksheet('Metadata');
  metaSheet.columns = [
    { header: 'Parameter', key: 'param', width: 24 },
    { header: 'Value', key: 'value', width: 60 },
  ];
  Object.entries(metadata).forEach(([key, value]) => {
    metaSheet.addRow({ param: key, value });
  });
  sides.forEach((side) => {
    const vars = SIDE_VARIABLES[side];
    metaSheet.addRow({ param: `${SIDE_NAMES[side]} variables`, value: `${vars.hip}, ${vars.knee}, ${vars.ankle}` });
    metaSheet.addRow({ param: `${SIDE_NAMES[side]} cycles`, value: sideResults[side].cycles.length });
  });

  // Sheet 9: Normalized_All_Data（MOTファイルの全変数を周期ごとに101点正規化したもの、縦持ち）
  // 試行によって変数が異なる場合に備え、全周期の変数名の和集合を列にする（ない変数は空欄）
  const allVariableNames = [];
  sides.forEach((side) =>
    sideResults[side].cycles.forEach((c) =>
      c.allNormalized.variableNames.forEach((name) => {
        if (!allVariableNames.includes(name)) allVariableNames.push(name);
      })
    )
  );
  const allSheet = workbook.addWorksheet('Normalized_All_Data');
  allSheet.columns = [
    { header: 'Side', key: 'side', width: 8 },
    { header: 'Cycle', key: 'cycle', width: 8 },
    ...SOURCE_COLUMNS,
    { header: 'Gait cycle (%)', key: 'pct', width: 14 },
    ...allVariableNames.map((name) => ({ header: name, key: `v_${name}`, width: 16 })),
  ];
  sides.forEach((side) => {
    sideResults[side].cycles.forEach((c) => {
      for (let i = 0; i <= 100; i += 1) {
        const row = { side: SIDE_NAMES[side], cycle: c.number, zip: c.zipName, trial: c.trialName, pct: i };
        allVariableNames.forEach((name) => {
          const values = c.allNormalized.values[name];
          row[`v_${name}`] = values ? values[i] : null;
        });
        allSheet.addRow(row);
      }
    });
  });

  // Sheet 10: COM_Normalized（身体重心。側ごとの平均/SDと、各周期の101点正規化データ）
  if (comResults) {
    const comSheet = workbook.addWorksheet('COM_Normalized');
    const columns = [{ header: 'Gait cycle (%)', key: 'pct', width: 14 }];
    sides.forEach((side) => {
      COM_SERIES.forEach((s) => {
        columns.push({ header: `${side} ${s.label} mean (${s.unit})`, key: `${side}_${s.key}_mean`, width: 30 });
        columns.push({ header: `${side} ${s.label} SD (${s.unit})`, key: `${side}_${s.key}_sd`, width: 28 });
      });
    });
    sides.forEach((side) => {
      comResults[side].cycles.forEach((_c, ci) => {
        COM_SERIES.forEach((s) => {
          columns.push({ header: `${side} C${ci + 1} ${s.label} (${s.unit})`, key: `${side}_${ci}_${s.key}`, width: 30 });
        });
        ['x', 'y', 'z'].forEach((axis) => {
          columns.push({ header: `${side} C${ci + 1} COM ground ${axis.toUpperCase()} (m)`, key: `${side}_${ci}_abs_${axis}`, width: 24 });
        });
      });
    });
    comSheet.columns = columns;
    for (let i = 0; i <= 100; i += 1) {
      const row = { pct: i };
      sides.forEach((side) => {
        const r = comResults[side];
        COM_SERIES.forEach((s) => {
          row[`${side}_${s.key}_mean`] = r.summary[s.key].mean[i];
          row[`${side}_${s.key}_sd`] = blankIfNull(r.summary[s.key].sd[i]);
        });
        r.cycles.forEach((c, ci) => {
          COM_SERIES.forEach((s) => {
            row[`${side}_${ci}_${s.key}`] = c.normalized[s.key][i];
          });
          ['x', 'y', 'z'].forEach((axis) => {
            row[`${side}_${ci}_abs_${axis}`] = c.normalizedAbsolute[axis][i];
          });
        });
      });
      comSheet.addRow(row);
    }
  }

  // Sheet 11: Excluded_Cycles（グラフから除外した歩行周期。解析の再現用）
  const exSheet = workbook.addWorksheet('Excluded_Cycles');
  exSheet.columns = [
    { header: 'Side', key: 'side', width: 8 },
    ...SOURCE_COLUMNS,
    { header: 'Cycle in trial', key: 'cycleInTrial', width: 14 },
    { header: 'IC sample', key: 'startSample', width: 11 },
    { header: 'IC time (s)', key: 'startTime', width: 12 },
    { header: 'Next IC sample', key: 'endSample', width: 15 },
    { header: 'Next IC time (s)', key: 'endTime', width: 15 },
  ];
  excluded.forEach((x) => {
    exSheet.addRow({
      side: SIDE_NAMES[x.side],
      zip: x.zipName,
      trial: x.trialName,
      cycleInTrial: x.cycleInTrial,
      startSample: x.startSample,
      startTime: x.startTime,
      endSample: x.endSample,
      endTime: x.endTime,
    });
  });

  return workbook;
}

// データの出所（ZIPファイル・試行）の列
const SOURCE_COLUMNS = [
  { header: 'ZIP file', key: 'zip', width: 36 },
  { header: 'Trial', key: 'trial', width: 16 },
];

// 時間・距離因子の列（秒/距離の列と、%GCの列）
const ST_COLUMNS = SPATIOTEMPORAL_PARAMS.flatMap((p) => [
  { key: p.key, label: p.en, unit: p.unit, header: `${p.en} (${p.unit})` },
  ...(p.percentKey
    ? [{ key: p.percentKey, label: `${p.en.replace(/ time$/, '')} (%GC)`, unit: '%', header: `${p.en.replace(/ time$/, '')} (%GC)` }]
    : []),
]);

function stValues(get) {
  return Object.fromEntries(ST_COLUMNS.map((c) => [c.key, blankIfNull(get(c.key))]));
}

function comCycleValues(c) {
  return { comV: c.verticalExcursion, comMl: c.mlExcursion };
}

function comSummaryValues(r, pick) {
  return {
    comV: blankIfNull(r.verticalExcursion[pick]),
    comMl: blankIfNull(r.mlExcursion[pick]),
  };
}

export async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
