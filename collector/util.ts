/** Small shared helpers for the collector: retry/backoff, CSV, logging. */

export function log(scope: string, msg: string): void {
  process.stdout.write(`[${scope}] ${msg}\n`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Retry with exponential backoff — external APIs are flaky (SPEC §9). */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 5,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i === attempts - 1) break;
      const delay = baseDelayMs * 2 ** i;
      log('retry', `${label} failed (attempt ${i + 1}/${attempts}): ${errMessage(err)} — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${errMessage(lastError)}`);
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${redact(url)}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  return (await res.json()) as T;
}

/** Never let an API key reach a log line. */
export function redact(url: string): string {
  return url.replace(/(apiKey=)[^&]+/i, '$1***');
}

/**
 * Minimal CSV parser: handles quoted fields, embedded commas and CRLF.
 * Returns objects keyed by the header row.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const header = nonEmpty.shift();
  if (!header) return [];

  const keys = header.map((h) => h.trim());
  return nonEmpty.map((r) => {
    const obj: Record<string, string> = {};
    keys.forEach((k, i) => (obj[k] = (r[i] ?? '').trim()));
    return obj;
  });
}

/** Chunk an array — used to keep multicall batches a sane size. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
