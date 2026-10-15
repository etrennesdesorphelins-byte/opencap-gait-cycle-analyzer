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

// FR-016: 解析実行に必要な入力が揃っているか確認する。
// cyclesBySide: { R: [...], L: [...] }（gaitEvents.buildCycles の結果）
// 1周期以上あり、必要列が揃っている側を解析対象（sides）として返す。
export function checkAnalysisReady({ motData, cyclesBySide }) {
  const errors = [];
  const sides = [];

  if (!motData) {
    errors.push('MOTファイルが選択されていません。');
    return { ok: false, errors, sides };
  }

  for (const side of ['R', 'L']) {
    const cycles = cyclesBySide[side] || [];
    if (cycles.length === 0) continue;
    const { ok, missing } = checkRequiredColumns(motData, side);
    if (ok) {
      sides.push(side);
    } else {
      errors.push(`${side === 'R' ? 'Right' : 'Left'} の解析に必要な列が見つかりません。Missing: ${missing.join(', ')}`);
    }
  }

  if (sides.length === 0 && errors.length === 0) {
    errors.push('解析には同じ側のICを2回以上設定してください（連続する同側IC間を1歩行周期とします）。');
  }

  return { ok: sides.length > 0, errors, sides };
}
