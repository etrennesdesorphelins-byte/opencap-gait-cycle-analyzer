// OpenSimモデル(.osim, OpenSim 4.x 形式)を読み込み、身体重心の計算に必要な情報
// （体節の質量・重心位置、関節の親子関係と運動学、座標、拘束）を取り出す。
// OpenSim API は使えないため、ブラウザ上で順運動学を計算できる形に変換する。

import { parseFunction, isFunctionElement } from './osimFunctions.js';
import { identityTransform, bodyFixedXYZ, axisAngleR, mulR, normalize, compose } from '../utils/spatial.js';

const GROUND = 'ground';

const childElements = (el) => Array.from(el.children);
const child = (el, tag) => childElements(el).find((c) => c.tagName === tag) || null;
const textOf = (el, tag) => {
  const c = child(el, tag);
  return c ? c.textContent.trim() : null;
};
const vec3 = (text) => {
  const v = text.trim().split(/\s+/).map(Number);
  if (v.length !== 3 || v.some(Number.isNaN)) throw new Error(`3次元ベクトルとして読み取れません: ${text}`);
  return v;
};
const objectsOf = (setEl) => {
  if (!setEl) return [];
  const objects = child(setEl, 'objects');
  return objects ? childElements(objects) : [];
};

// "/bodyset/femur_r" や "/ground" などのパスを、フレーム（所属ボディとボディ基準の変換）に解決する
function resolveFramePath(path, localFrames) {
  const trimmed = path.trim();
  if (localFrames.has(trimmed)) return localFrames.get(trimmed);
  const parts = trimmed.split('/').filter((p) => p && p !== '.');
  if (parts.length === 1 && parts[0] === GROUND) return { body: GROUND, X: identityTransform() };
  if (parts.length === 2 && parts[0] === 'bodyset') return { body: parts[1], X: identityTransform() };
  const last = parts[parts.length - 1];
  if (localFrames.has(last)) return localFrames.get(last);
  throw new Error(`フレームを解決できません: ${path}`);
}

// Joint要素内の PhysicalOffsetFrame を { 名前 → {body, X_body_frame} } として解決する
function parseJointFrames(jointEl) {
  const frames = new Map();
  const framesEl = child(jointEl, 'frames');
  const pending = framesEl ? childElements(framesEl).filter((f) => f.tagName === 'PhysicalOffsetFrame') : [];

  // オフセットフレームが同じJoint内の別フレームを親に持つ場合に備えて、解決できるまで繰り返す
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const f = pending[i];
      let parent;
      try {
        parent = resolveFramePath(textOf(f, 'socket_parent'), frames);
      } catch {
        continue;
      }
      const X_offset = {
        R: bodyFixedXYZ(vec3(textOf(f, 'orientation') || '0 0 0')),
        p: vec3(textOf(f, 'translation') || '0 0 0'),
      };
      frames.set(f.getAttribute('name'), { body: parent.body, X: compose(parent.X, X_offset) });
      pending.splice(i, 1);
      progress = true;
    }
  }
  if (pending.length > 0) {
    throw new Error(`Joint ${jointEl.getAttribute('name')} のフレームを解決できません。`);
  }
  return frames;
}

// CustomJoint の SpatialTransform（回転3軸→並進3軸）を、座標値から X_FM を返す関数に変換する。
// 回転は rotation1→2→3 の順に、直前の回転後のフレームで定義された軸まわりに適用する（物体固定）。
// 並進は親側フレーム(F)で表した軸方向に適用する。
function parseSpatialTransform(jointEl) {
  const st = child(jointEl, 'SpatialTransform');
  const names = ['rotation1', 'rotation2', 'rotation3', 'translation1', 'translation2', 'translation3'];
  const axes = names.map((name) => {
    const ta = childElements(st).find((c) => c.tagName === 'TransformAxis' && c.getAttribute('name') === name);
    if (!ta) return null;
    const coords = (textOf(ta, 'coordinates') || '').split(/\s+/).filter(Boolean);
    const fnEl = childElements(ta).find(isFunctionElement);
    const fn = fnEl ? parseFunction(fnEl) : null;
    if (coords.length > 1) {
      throw new Error(`複数座標に依存する TransformAxis には未対応です（${jointEl.getAttribute('name')}/${name}）。`);
    }
    return { coord: coords[0] || null, axis: normalize(vec3(textOf(ta, 'axis'))), fn };
  });

  const valueOf = (ax, q) => {
    if (!ax || !ax.fn) return 0;
    return ax.fn(ax.coord ? q[ax.coord] : 0);
  };

  const rotationalCoords = new Set(axes.slice(0, 3).filter((a) => a && a.coord).map((a) => a.coord));
  const allCoords = new Set(axes.filter((a) => a && a.coord).map((a) => a.coord));

  return {
    rotationalCoords,
    allCoords,
    transform(q) {
      let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      for (let i = 0; i < 3; i += 1) {
        const ax = axes[i];
        if (!ax) continue;
        const angle = valueOf(ax, q);
        if (angle !== 0) R = mulR(R, axisAngleR(ax.axis, angle));
      }
      const p = [0, 0, 0];
      for (let i = 3; i < 6; i += 1) {
        const ax = axes[i];
        if (!ax) continue;
        const d = valueOf(ax, q);
        p[0] += ax.axis[0] * d;
        p[1] += ax.axis[1] * d;
        p[2] += ax.axis[2] * d;
      }
      return { R, p };
    },
  };
}

const X_AXIS = [1, 0, 0];
const Y_AXIS = [0, 1, 0];
const Z_AXIS = [0, 0, 1];

// 標準ジョイントの運動学（座標名の配列 c に対し X_FM を返す）
function standardJointKinematics(type, c) {
  switch (type) {
    case 'WeldJoint':
      return { rotational: [], transform: () => identityTransform() };
    case 'PinJoint':
      return { rotational: c, transform: (q) => ({ R: axisAngleR(Z_AXIS, q[c[0]]), p: [0, 0, 0] }) };
    case 'SliderJoint':
      return { rotational: [], transform: (q) => ({ R: identityTransform().R, p: [q[c[0]], 0, 0] }) };
    case 'UniversalJoint':
      return {
        rotational: c,
        transform: (q) => ({ R: mulR(axisAngleR(X_AXIS, q[c[0]]), axisAngleR(Y_AXIS, q[c[1]])), p: [0, 0, 0] }),
      };
    case 'GimbalJoint':
    case 'BallJoint':
      return { rotational: c, transform: (q) => ({ R: bodyFixedXYZ([q[c[0]], q[c[1]], q[c[2]]]), p: [0, 0, 0] }) };
    case 'FreeJoint':
      return {
        rotational: c.slice(0, 3),
        transform: (q) => ({ R: bodyFixedXYZ([q[c[0]], q[c[1]], q[c[2]]]), p: [q[c[3]], q[c[4]], q[c[5]]] }),
      };
    default:
      throw new Error(`未対応のジョイントです: ${type}`);
  }
}

export function parseOsimModel(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('OpenSimモデル(.osim)のXMLを読み込めませんでした。');
  }
  const modelEl = doc.getElementsByTagName('Model')[0];
  if (!modelEl) throw new Error('OpenSimモデル(.osim)に Model 要素がありません。');
  const version = Number(doc.documentElement.getAttribute('Version') || 0);
  if (version && version < 40000) {
    throw new Error(`OpenSim 4.0 より前の形式(.osim Version ${version})には未対応です。`);
  }

  const bodies = new Map();
  for (const b of objectsOf(child(modelEl, 'BodySet'))) {
    if (b.tagName !== 'Body') continue;
    bodies.set(b.getAttribute('name'), {
      name: b.getAttribute('name'),
      mass: Number(textOf(b, 'mass')),
      massCenter: vec3(textOf(b, 'mass_center') || '0 0 0'),
    });
  }

  const coordinates = new Map();
  const joints = [];
  for (const j of objectsOf(child(modelEl, 'JointSet'))) {
    const name = j.getAttribute('name');
    const frames = parseJointFrames(j);
    const parent = resolveFramePath(textOf(j, 'socket_parent_frame'), frames);
    const childFrame = resolveFramePath(textOf(j, 'socket_child_frame'), frames);

    const coordsEl = child(j, 'coordinates');
    const coordNames = coordsEl
      ? childElements(coordsEl).filter((c) => c.tagName === 'Coordinate').map((c) => c.getAttribute('name'))
      : [];

    let kin;
    if (j.tagName === 'CustomJoint') {
      const st = parseSpatialTransform(j);
      kin = { rotational: [...st.rotationalCoords], transform: st.transform };
    } else {
      kin = standardJointKinematics(j.tagName, coordNames);
    }

    if (coordsEl) {
      for (const c of childElements(coordsEl).filter((el) => el.tagName === 'Coordinate')) {
        const cname = c.getAttribute('name');
        coordinates.set(cname, {
          name: cname,
          joint: name,
          motionType: kin.rotational.includes(cname) ? 'rotational' : 'translational',
          defaultValue: Number(textOf(c, 'default_value') || 0),
        });
      }
    }

    joints.push({ name, type: j.tagName, parent, child: childFrame, transform: kin.transform });
  }

  const couplers = [];
  for (const c of objectsOf(child(modelEl, 'ConstraintSet'))) {
    if (c.tagName !== 'CoordinateCouplerConstraint') continue;
    const enforced = textOf(c, 'isEnforced');
    if (enforced !== null && enforced.toLowerCase() === 'false') continue;
    const independent = (textOf(c, 'independent_coordinate_names') || '').split(/\s+/).filter(Boolean);
    if (independent.length !== 1) {
      throw new Error(`複数の独立座標を持つ CoordinateCouplerConstraint には未対応です（${c.getAttribute('name')}）。`);
    }
    const fnWrapper = child(c, 'coupled_coordinates_function');
    const fnEl = fnWrapper && childElements(fnWrapper).find(isFunctionElement);
    couplers.push({
      dependent: textOf(c, 'dependent_coordinate_name'),
      independent: independent[0],
      fn: parseFunction(fnEl),
      scale: Number(textOf(c, 'scale_factor') || 1),
    });
  }

  const markers = [];
  for (const m of objectsOf(child(modelEl, 'MarkerSet'))) {
    if (m.tagName !== 'Marker') continue;
    const frame = resolveFramePath(textOf(m, 'socket_parent_frame'), new Map());
    markers.push({ name: m.getAttribute('name'), body: frame.body, location: vec3(textOf(m, 'location')) });
  }

  // 親ボディの姿勢が決まってから子ボディを計算できるよう、ジョイントを木構造の順に並べる
  const ordered = [];
  const known = new Set([GROUND]);
  const remaining = joints.slice();
  while (remaining.length > 0) {
    const idx = remaining.findIndex((jt) => known.has(jt.parent.body));
    if (idx < 0) {
      throw new Error(`ジョイントの親子関係を解決できません: ${remaining.map((jt) => jt.name).join(', ')}`);
    }
    const [jt] = remaining.splice(idx, 1);
    ordered.push(jt);
    known.add(jt.child.body);
  }
  const unattached = [...bodies.keys()].filter((b) => !known.has(b));
  if (unattached.length > 0) {
    throw new Error(`ジョイントで接続されていないボディがあります: ${unattached.join(', ')}`);
  }

  const totalMass = [...bodies.values()].reduce((sum, b) => sum + b.mass, 0);

  return {
    name: modelEl.getAttribute('name'),
    bodies,
    joints: ordered,
    coordinates,
    couplers,
    markers,
    totalMass,
  };
}
