// OpenSimモデル(.osim)内の関数要素（CustomJointの TransformAxis や CoordinateCouplerConstraint で使用）を
// 評価可能な JavaScript 関数へ変換する。

const childElements = (el) => Array.from(el.children);
const numbers = (text) => text.trim().split(/\s+/).filter(Boolean).map(Number);

function textOf(el, tag) {
  const child = childElements(el).find((c) => c.tagName === tag);
  return child ? child.textContent : null;
}

// SIMM由来の3次スプライン（Forsythe, Malcolm & Moler の spline ルーチン）。
// OpenSim の SimmSpline と同じ端点条件（両端4点の3次多項式の3階微分に一致）を用い、
// 範囲外は端点の傾きで線形外挿する。
export function buildSimmSpline(x, y) {
  const n = x.length;
  if (n !== y.length || n < 2) throw new Error('SimmSpline の x/y の点数が不正です。');
  const b = new Array(n).fill(0);
  const c = new Array(n).fill(0);
  const d = new Array(n).fill(0);
  const nm1 = n - 1;

  if (n < 3) {
    const slope = (y[1] - y[0]) / (x[1] - x[0]);
    b[0] = slope;
    b[1] = slope;
  } else {
    d[0] = x[1] - x[0];
    c[1] = (y[1] - y[0]) / d[0];
    for (let i = 1; i < nm1; i += 1) {
      d[i] = x[i + 1] - x[i];
      b[i] = 2 * (d[i - 1] + d[i]);
      c[i + 1] = (y[i + 1] - y[i]) / d[i];
      c[i] = c[i + 1] - c[i];
    }

    b[0] = -d[0];
    b[nm1] = -d[n - 2];
    c[0] = 0;
    c[nm1] = 0;
    if (n > 3) {
      c[0] = c[2] / (x[3] - x[1]) - c[1] / (x[2] - x[0]);
      c[nm1] = c[n - 2] / (x[nm1] - x[n - 3]) - c[n - 3] / (x[n - 2] - x[n - 4]);
      c[0] = (c[0] * d[0] * d[0]) / (x[3] - x[0]);
      c[nm1] = (-c[nm1] * d[n - 2] * d[n - 2]) / (x[nm1] - x[n - 4]);
    }

    for (let i = 1; i <= nm1; i += 1) {
      const t = d[i - 1] / b[i - 1];
      b[i] -= t * d[i - 1];
      c[i] -= t * c[i - 1];
    }

    c[nm1] /= b[nm1];
    for (let j = 0; j < nm1; j += 1) {
      const i = n - 2 - j;
      c[i] = (c[i] - d[i] * c[i + 1]) / b[i];
    }

    b[nm1] = (y[nm1] - y[n - 2]) / d[n - 2] + d[n - 2] * (c[n - 2] + 2 * c[nm1]);
    for (let i = 0; i < nm1; i += 1) {
      b[i] = (y[i + 1] - y[i]) / d[i] - d[i] * (c[i + 1] + 2 * c[i]);
      d[i] = (c[i + 1] - c[i]) / d[i];
      c[i] *= 3;
    }
    c[nm1] *= 3;
    d[nm1] = d[n - 2];
  }

  return (v) => {
    if (v < x[0]) return y[0] + b[0] * (v - x[0]);
    if (v > x[nm1]) return y[nm1] + b[nm1] * (v - x[nm1]);
    let lo = 0;
    let hi = nm1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= v) lo = mid;
      else hi = mid;
    }
    const dx = v - x[lo];
    return y[lo] + dx * (b[lo] + dx * (c[lo] + dx * d[lo]));
  };
}

const FUNCTION_TAGS = new Set([
  'Constant',
  'LinearFunction',
  'PolynomialFunction',
  'MultiplierFunction',
  'SimmSpline',
  'NaturalCubicSpline',
  'PiecewiseLinearFunction',
]);

export function isFunctionElement(el) {
  return FUNCTION_TAGS.has(el.tagName);
}

// 関数要素 → (x: number) => number
export function parseFunction(el) {
  switch (el.tagName) {
    case 'Constant': {
      const value = Number(textOf(el, 'value'));
      return () => value;
    }
    case 'LinearFunction': {
      const [slope, intercept] = numbers(textOf(el, 'coefficients'));
      return (x) => slope * x + intercept;
    }
    case 'PolynomialFunction': {
      // 係数は高次 → 低次の順
      const coeffs = numbers(textOf(el, 'coefficients'));
      return (x) => coeffs.reduce((acc, a) => acc * x + a, 0);
    }
    case 'MultiplierFunction': {
      const wrapper = childElements(el).find((c) => c.tagName === 'function');
      const inner = wrapper && childElements(wrapper).find(isFunctionElement);
      if (!inner) throw new Error('MultiplierFunction に内側の関数がありません。');
      const f = parseFunction(inner);
      const scaleText = textOf(el, 'scale');
      const scale = scaleText === null ? 1 : Number(scaleText);
      return (x) => scale * f(x);
    }
    case 'SimmSpline':
    case 'NaturalCubicSpline':
      // NaturalCubicSpline は端点条件が異なるが、OpenCapモデルでは使われないため同じ実装で近似する
      return buildSimmSpline(numbers(textOf(el, 'x')), numbers(textOf(el, 'y')));
    case 'PiecewiseLinearFunction': {
      const xs = numbers(textOf(el, 'x'));
      const ys = numbers(textOf(el, 'y'));
      return (x) => {
        if (x <= xs[0]) return ys[0];
        if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
        let i = 0;
        while (xs[i + 1] < x) i += 1;
        return ys[i] + ((x - xs[i]) * (ys[i + 1] - ys[i])) / (xs[i + 1] - xs[i]);
      };
    }
    default:
      throw new Error(`未対応のOpenSim関数です: ${el.tagName}`);
  }
}
