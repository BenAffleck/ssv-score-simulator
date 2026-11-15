/**
 * `npm run import` — write `data/dataset.json` from production.
 *
 *   --db=<path>     production pipeline.sqlite (default ../ssv-scoring/data/pipeline.sqlite, or $PIPELINE_DB)
 *   --run=<id>      take allocation inputs and the baseline from this run (default: latest published)
 *   --export=<file> convert a `ssv-score export-dataset` file instead of reading a database
 *   --out=<file>    default data/dataset.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describeDataset, parseDataset, type Dataset } from '../scoring-core/index.js';
import { dbPath, flag, main, runFlag } from './args.js';
import { openPipeline, readPipeline } from './pipeline.js';

main(() => {
  const out = resolve(flag('out') ?? 'data/dataset.json');
  const exported = flag('export');
  let dataset: Dataset;
  if (exported) {
    dataset = parseDataset(JSON.parse(readFileSync(exported, 'utf8')));
  } else {
    const db = openPipeline(dbPath());
    try {
      dataset = readPipeline(db, runFlag());
    } finally {
      db.close();
    }
  }
  // Round-trip through the validator, so a dataset the UI would reject is never written.
  parseDataset(JSON.parse(JSON.stringify(dataset)));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dataset));
  console.log(`✔ ${dataset.origin}: ${describeDataset(dataset)}`);
  console.log(`  wrote ${out}`);
});
