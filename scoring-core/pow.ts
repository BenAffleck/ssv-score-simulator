/**
 * `x ** y`, correctly rounded, as the production pipeline computes it.
 *
 * Production is Python, whose float `**` calls the C library's `pow`; glibc's
 * is correctly rounded. V8's `**` is not, and is off by one ulp often enough
 * (vote decay `0.5 ** (age / H)`, holdings `(TWAB / ref) ** p`) to change
 * scores in the last bit. So this evaluates `exp(y · ln x)` in double-double
 * (~106-bit) arithmetic and rounds once.
 */

type DD = [number, number];

const SPLITTER = 134217729; // 2^27 + 1

function twoSum(a: number, b: number): DD {
  const s = a + b;
  const bb = s - a;
  return [s, a - (s - bb) + (b - bb)];
}

function quickTwoSum(a: number, b: number): DD {
  const s = a + b;
  return [s, b - (s - a)];
}

function split(a: number): DD {
  const t = SPLITTER * a;
  const hi = t - (t - a);
  return [hi, a - hi];
}

function twoProd(a: number, b: number): DD {
  const p = a * b;
  const [ah, al] = split(a);
  const [bh, bl] = split(b);
  return [p, ah * bh - p + ah * bl + al * bh + al * bl];
}

function add(a: DD, b: DD): DD {
  const [s, e] = twoSum(a[0], b[0]);
  const [t, f] = twoSum(a[1], b[1]);
  const [s1, e1] = quickTwoSum(s, e + t);
  return quickTwoSum(s1, e1 + f);
}

function div(a: DD, b: number): DD {
  const q1 = a[0] / b;
  const [p, e] = twoProd(q1, b);
  const [s, f] = twoSum(a[0], -p);
  const q2 = (s + (f - e + a[1])) / b;
  return quickTwoSum(q1, q2);
}

function mul(a: DD, b: DD): DD {
  const [p, e] = twoProd(a[0], b[0]);
  return quickTwoSum(p, e + (a[0] * b[1] + a[1] * b[0]));
}

const LN2: DD = [0.6931471805599453, 2.3190468138462996e-17];

/** e^a for |a| well inside the double range. */
function expDD(a: DD): DD {
  const k = Math.round(a[0] / LN2[0]);
  // r = a − k·ln2, then e^r = (e^(r/2^10))^(2^10) to keep the series short.
  let r = add(a, mul(LN2, [-k, 0]));
  r = [r[0] / 1024, r[1] / 1024];
  let term: DD = [1, 0];
  let sum: DD = [1, 0];
  for (let n = 1; n <= 14; n++) {
    term = div(mul(term, r), n);
    sum = add(sum, term);
  }
  for (let i = 0; i < 10; i++) sum = mul(sum, sum);
  const scale = 2 ** k;
  return [sum[0] * scale, sum[1] * scale];
}

/** ln x for finite x > 0: one Newton step from the double estimate doubles its precision. */
function logDD(x: number): DD {
  const y0 = Math.log(x);
  const e = expDD([-y0, 0]);
  // y1 = y0 + x·e^(−y0) − 1
  const t = add(mul([x, 0], e), [-1, 0]);
  return add([y0, 0], t);
}

export function pow(x: number, y: number): number {
  if (y === 0 || x === 1) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (!(x > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return x ** y;
  if (y === 1) return x;
  const l = x === 2 ? LN2 : x === 0.5 ? ([-LN2[0], -LN2[1]] as DD) : logDD(x);
  const exponent = mul(l, [y, 0]);
  if (exponent[0] > 709 || exponent[0] < -745) return x ** y;
  const [hi, lo] = expDD(exponent);
  return hi + lo;
}
