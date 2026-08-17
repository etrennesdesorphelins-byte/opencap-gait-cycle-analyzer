import ExcelJS from 'exceljs';

const IMAGE_ROW_POSITIONS = { hip: 1, knee: 18, ankle: 35 };

export function buildWorkbook({ chartImages, normalized, original, metadata, allNormalized }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OpenCap Gait Cycle Analyzer';
  workbook.created = new Date();

  // Sheet 1: Graphs
  const graphsSheet = workbook.addWorksheet('Graphs');
  Object.entries(IMAGE_ROW_POSITIONS).forEach(([key, row]) => {
    const dataUrl = chartImages[key];
    if (!dataUrl) return;
    const imageId = workbook.addImage({ base64: dataUrl, extension: 'png' });
    graphsSheet.addImage(imageId, {
      tl: { col: 0, row: row - 1 },
      ext: { width: 600, height: 300 },
    });
  });

  // Sheet 2: Normalized_Data
  const normSheet = workbook.addWorksheet('Normalized_Data');
  normSheet.columns = [
    { header: 'Gait cycle (%)', key: 'pct', width: 16 },
    { header: 'Hip flexion (deg)', key: 'hip', width: 18 },
    { header: 'Knee flexion (deg)', key: 'knee', width: 18 },
    { header: 'Ankle angle (deg)', key: 'ankle', width: 18 },
  ];
  for (let i = 0; i <= 100; i += 1) {
    normSheet.addRow({
      pct: normalized.gaitCyclePercent[i],
      hip: normalized.hip[i],
      knee: normalized.knee[i],
      ankle: normalized.ankle[i],
    });
  }

  // Sheet 3: Original_Data (1st ICから2nd ICまでの正規化前データ)
  const origSheet = workbook.addWorksheet('Original_Data');
  origSheet.columns = [
    { header: 'Sample', key: 'sample', width: 10 },
    { header: 'Time (s)', key: 'time', width: 12 },
    { header: 'Gait cycle (%)', key: 'pct', width: 16 },
    { header: 'Hip flexion (deg)', key: 'hip', width: 18 },
    { header: 'Knee flexion (deg)', key: 'knee', width: 18 },
    { header: 'Ankle angle (deg)', key: 'ankle', width: 18 },
  ];
  original.sampleIndices.forEach((_sampleIdx, i) => {
    origSheet.addRow({
      sample: i + 1, // 人が確認しやすい1始まり表示（内部インデックスは0始まりのまま）
      time: original.time[i],
      pct: original.gaitCyclePercent[i],
      hip: original.hip[i],
      knee: original.knee[i],
      ankle: original.ankle[i],
    });
  });

  // Sheet 4: Metadata
  const metaSheet = workbook.addWorksheet('Metadata');
  metaSheet.columns = [
    { header: 'Parameter', key: 'param', width: 24 },
    { header: 'Value', key: 'value', width: 44 },
  ];
  Object.entries(metadata).forEach(([key, value]) => {
    metaSheet.addRow({ param: key, value });
  });

  // Sheet 5: Normalized_All_Data（MOTファイルの全変数を101点正規化したもの）
  if (allNormalized) {
    const allSheet = workbook.addWorksheet('Normalized_All_Data');
    allSheet.columns = [
      { header: 'Gait cycle (%)', key: 'pct', width: 16 },
      ...allNormalized.variableNames.map((name) => ({ header: name, key: name, width: 16 })),
    ];
    for (let i = 0; i <= 100; i += 1) {
      const row = { pct: allNormalized.gaitCyclePercent[i] };
      allNormalized.variableNames.forEach((name) => {
        row[name] = allNormalized.values[name][i];
      });
      allSheet.addRow(row);
    }
  }

  return workbook;
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
