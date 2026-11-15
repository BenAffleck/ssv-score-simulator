/**
 * Exact token arithmetic for balances. Production stores SSV and cSSV as
 * decimal strings and scores `float(Decimal(ssv) + Decimal(cssv))`: summed
 * exactly, rounded once. Adding two already-rounded floats can differ in the
 * last bit, so the sum is done on scaled integers instead.
 */
const SCALE = 36;

export function decimalSumToNumber(...amounts: string[]): number {
  let total = 0n;
  for (const a of amounts) total += toScaled(a);
  return Number(fromScaled(total));
}

function toScaled(amount: string): bigint {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  if (!match || (match[2] === '' && !match[3])) throw new Error(`not a decimal amount: "${amount}"`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > SCALE) throw new Error(`more than ${SCALE} decimals: "${amount}"`);
  const scaled = BigInt((whole || '0') + fraction.padEnd(SCALE, '0'));
  return sign ? -scaled : scaled;
}

function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(SCALE + 1, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`;
}
