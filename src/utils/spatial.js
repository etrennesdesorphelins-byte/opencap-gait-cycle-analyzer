// 3次元の剛体変換（回転行列 R: 行優先の長さ9配列、並進 p: 長さ3配列）の最小限の演算。

export const IDENTITY_R = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function identityTransform() {
  return { R: IDENTITY_R.slice(), p: [0, 0, 0] };
}

export function mulR(a, b) {
  const out = new Array(9);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return out;
}

export function mulRv(R, v) {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}

export function transposeR(R) {
  return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
}

// 単位ベクトル axis まわりに angle [rad] 回転する行列（Rodriguesの公式）
export function axisAngleR(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

export function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n === 0) throw new Error('長さ0の軸ベクトルは使用できません。');
  return [v[0] / n, v[1] / n, v[2] / n];
}

// OpenSimの PhysicalOffsetFrame の orientation（フレーム固定 X-Y-Z 回転列）
export function bodyFixedXYZ([a, b, c]) {
  return mulR(mulR(axisAngleR([1, 0, 0], a), axisAngleR([0, 1, 0], b)), axisAngleR([0, 0, 1], c));
}

// X_AC = X_AB * X_BC
export function compose(X_AB, X_BC) {
  const p = mulRv(X_AB.R, X_BC.p);
  return {
    R: mulR(X_AB.R, X_BC.R),
    p: [X_AB.p[0] + p[0], X_AB.p[1] + p[1], X_AB.p[2] + p[2]],
  };
}

export function invert(X) {
  const Rt = transposeR(X.R);
  const p = mulRv(Rt, X.p);
  return { R: Rt, p: [-p[0], -p[1], -p[2]] };
}

export function transformPoint(X, v) {
  const p = mulRv(X.R, v);
  return [X.p[0] + p[0], X.p[1] + p[1], X.p[2] + p[2]];
}
