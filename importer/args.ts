/** Shared CLI plumbing for the importer scripts. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Production's database, by default next to this repo as the two are checked out side by side. */
export const DEFAULT_DB = '../ssv-scoring/data/pipeline.sqlite';

export function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(prefix));
  if (hit === undefined) return undefined;
  return hit.startsWith(prefix) ? hit.slice(prefix.length) : 'true';
}

export function dbPath(): string {
  const path = resolve(flag('db') ?? process.env.PIPELINE_DB ?? DEFAULT_DB);
  if (!existsSync(path)) {
    throw new Error(`No production database at ${path}. Pass --db=<path to ssv-scoring's pipeline.sqlite>.`);
  }
  return path;
}

export function runFlag(): number | undefined {
  const run = flag('run');
  if (run === undefined) return undefined;
  const id = Number(run);
  if (!Number.isInteger(id)) throw new Error(`--run must be a run id, got "${run}"`);
  return id;
}

export function main(fn: () => void | Promise<void>): void {
  Promise.resolve()
    .then(fn)
    .catch((err: unknown) => {
      console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
