/**
 * Python's built-in `sum()` over floats, as the production pipeline computes it.
 *
 * Since CPython 3.12, `sum()` adds floats with Neumaier's compensated summation,
 * which can differ from a naive left fold in the last bits. Scores are ranked
 * unrounded with ties broken by address, so reproducing production exactly
 * means summing exactly as it does.
 */
export function pySum(values: Iterable<number>): number {
  let result = 0;
  let compensation = 0;
  let first = true;
  for (const x of values) {
    if (first) {
      // `0 + x` (the int start value plus the first float) is exact.
      result = x;
      first = false;
      continue;
    }
    const t = result + x;
    if (Math.abs(result) >= Math.abs(x)) compensation += result - t + x;
    else compensation += x - t + result;
    result = t;
  }
  if (compensation !== 0 && Number.isFinite(compensation)) result += compensation;
  return result;
}
