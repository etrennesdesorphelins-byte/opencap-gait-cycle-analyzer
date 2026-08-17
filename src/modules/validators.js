import { hasColumn } from './motParser.js';

export const SIDE_VARIABLES = {
  R: { hip: 'hip_flexion_r', knee: 'knee_angle_r', ankle: 'ankle_angle_r' },
  L: { hip: 'hip_flexion_l', knee: 'knee_angle_l', ankle: 'ankle_angle_l' },
};

export function getRequiredVariableNames(side) {
  const v = SIDE_VARIABLES[side];
  return [v.hip, v.knee, v.ankle];
}

export function checkRequiredColumns(motData, side) {
  const required = getRequiredVariableNames(side);
  const missing = required.filter((name) => !hasColumn(motData, name));
  return { ok: missing.length === 0, missing };
}

// FR-016: 解析実行に必要な入力が揃っているか確認する
export function checkAnalysisReady({ motData, side, firstIC, secondIC }) {
  const errors = [];

  if (!motData) errors.push('MOTファイルが選択されていません。');
  if (!side) errors.push('解析側（Right / Left）が選択されていません。');
  if (!firstIC || firstIC.sampleIndex === null || firstIC.sampleIndex === undefined) {
    errors.push('1st ICが設定されていません。');
  }
  if (!secondIC || secondIC.sampleIndex === null || secondIC.sampleIndex === undefined) {
    errors.push('2nd ICが設定されていません。');
  }
  if (
    firstIC && secondIC &&
    firstIC.sampleIndex !== null && secondIC.sampleIndex !== null &&
    secondIC.sampleIndex !== undefined && firstIC.sampleIndex !== undefined &&
    secondIC.sampleIndex <= firstIC.sampleIndex
  ) {
    errors.push('2nd ICは1st ICより後の時点を選択してください。');
  }

  if (motData && side) {
    const { ok, missing } = checkRequiredColumns(motData, side);
    if (!ok) {
      errors.push(`解析に必要な列が見つかりません。Missing: ${missing.join(', ')}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
