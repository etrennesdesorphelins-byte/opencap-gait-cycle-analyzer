// OpenSimモデルとMOTの関節角度から、各ボディの姿勢（順運動学）と身体重心を計算する。
// OpenSim の Model::calcMassCenterPosition と同様に、全ボディの質量加重平均を地面座標系で求める。

import { compose, invert, transformPoint } from '../utils/spatial.js';
import { getColumn } from './motParser.js';

// MOTヘッダーの inDegrees を読む（記載がなければ OpenCap の既定である度とみなす）
function motInDegrees(motData) {
  const line = (motData.headerLines || []).find((l) => /^\s*inDegrees\s*=/i.test(l));
  return line ? /=\s*yes/i.test(line) : true;
}

// MOTの各行を、モデル座標名 → 値（回転: rad、並進: m）の配列に変換する。
// MOTにない座標は既定値、従属座標（膝蓋骨など）は CoordinateCouplerConstraint から求める。
export function coordinateFramesFromMot(model, motData) {
  const toRad = motInDegrees(motData) ? Math.PI / 180 : 1;
  const columns = [];
  const missing = [];
  for (const coord of model.coordinates.values()) {
    const values = getColumn(motData, coord.name);
    if (values) {
      columns.push({ name: coord.name, values, factor: coord.motionType === 'rotational' ? toRad : 1 });
    } else if (!model.couplers.some((c) => c.dependent === coord.name)) {
      missing.push(coord.name);
    }
  }

  const frames = [];
  for (let i = 0; i < motData.rowCount; i += 1) {
    const q = {};
    for (const coord of model.coordinates.values()) q[coord.name] = coord.defaultValue;
    for (const col of columns) q[col.name] = col.values[i] * col.factor;
    for (const c of model.couplers) q[c.dependent] = c.scale * c.fn(q[c.independent]);
    frames.push(q);
  }
  return { frames, missing };
}

// 全ボディの地面座標系での姿勢 X_GB を返す（Map: ボディ名 → {R, p}）
export function computeBodyTransforms(model, q) {
  const poses = new Map([['ground', { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], p: [0, 0, 0] }]]);
  for (const joint of model.joints) {
    // X_G_child = X_G_parentBody · X_parentBody_F · X_FM(q) · (X_childBody_M)^-1
    const X_GF = compose(poses.get(joint.parent.body), joint.parent.X);
    const X_GM = compose(X_GF, joint.transform(q));
    poses.set(joint.child.body, compose(X_GM, invert(joint.child.X)));
  }
  return poses;
}

export function computeCenterOfMass(model, poses) {
  const com = [0, 0, 0];
  for (const body of model.bodies.values()) {
    const p = transformPoint(poses.get(body.name), body.massCenter);
    com[0] += body.mass * p[0];
    com[1] += body.mass * p[1];
    com[2] += body.mass * p[2];
  }
  return com.map((v) => v / model.totalMass);
}

export function computeMarkerPositions(model, poses) {
  const out = {};
  for (const m of model.markers) {
    out[m.name] = transformPoint(poses.get(m.body), m.location);
  }
  return out;
}

// 中心差分（両端は片側差分）で時系列の微分を求める
function differentiate(time, values) {
  const n = values.length;
  return values.map((_, i) => {
    if (n < 2) return 0;
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    return (values[b] - values[a]) / (time[b] - time[a]);
  });
}

// MOT全体の身体重心時系列（地面座標系、OpenSimでは y が鉛直上向き）を計算する
export function computeCenterOfMassTrajectory(model, motData) {
  const time = getColumn(motData, 'time');
  const { frames, missing } = coordinateFramesFromMot(model, motData);
  const x = [];
  const y = [];
  const z = [];
  for (const q of frames) {
    const [cx, cy, cz] = computeCenterOfMass(model, computeBodyTransforms(model, q));
    x.push(cx);
    y.push(cy);
    z.push(cz);
  }
  return {
    time,
    x,
    y,
    z,
    vx: differentiate(time, x),
    vy: differentiate(time, y),
    vz: differentiate(time, z),
    missingCoordinates: missing,
  };
}
