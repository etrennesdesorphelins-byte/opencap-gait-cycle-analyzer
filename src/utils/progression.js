// 歩行周期ごとの進行方向（水平面 x-z）。OpenCapの地面座標系は y が鉛直上向きで、
// 水平面内の向きは撮影時のキャリブレーションに依存するため、周期内の水平変位の向きを前後(AP)軸とする。

// 進行方向を決めるのに必要な最小の水平変位 [m]（足踏みやトレッドミルでは方向を決められない）
export const MIN_PROGRESSION = 0.05;

// p0, p1: 周期開始・終了時の基準点 [x, y, z]
export function progressionFrame(p0, p1) {
  const dx = p1[0] - p0[0];
  const dz = p1[2] - p0[2];
  const distance = Math.hypot(dx, dz);
  const defined = distance >= MIN_PROGRESSION;
  const fwd = defined ? [dx / distance, dz / distance] : [1, 0];
  // 右方向 = 前方 × 上方（OpenSimの右手系: x前方, y上方 → z右方）
  const right = [-fwd[1], fwd[0]];
  return { defined, distance, fwd, right };
}

// 点 p の前後方向成分（原点基準）
export const alongForward = (frame, p) => p[0] * frame.fwd[0] + p[2] * frame.fwd[1];
