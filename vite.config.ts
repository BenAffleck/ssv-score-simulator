import { existsSync, readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const DATASET = new URL('./data/dataset.json', import.meta.url).pathname;

/**
 * Exposes exactly one file from `data/` — `dataset.json` — at `/dataset.json`.
 *
 * Replaces `publicDir: '../data'`, which copied the *whole* directory into the
 * build: a deploy shipped `sim.sqlite` (the multi-megabyte collector cache,
 * every raw balance and block lookup) and the roster CSVs to a public host.
 * Only the file the app actually fetches should leave the machine.
 *
 * Bundling stays optional. If `data/dataset.json` is absent the build succeeds
 * without it and the app falls back to its import screen, so a deploy no longer
 * depends on a git-ignored file existing at build time.
 */
function datasetAsset(): Plugin {
  return {
    name: 'dataset-asset',

    // Dev: read per-request, so re-running the collector shows up on refresh
    // instead of at server start.
    configureServer(server) {
      server.middlewares.use('/dataset.json', (_req, res, next) => {
        if (!existsSync(DATASET)) return next(); // 404 → the app shows its import screen
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(DATASET));
      });
    },

    buildStart() {
      if (!existsSync(DATASET)) {
        this.warn(
          'data/dataset.json not found — building without a bundled dataset. ' +
            'The deployed app will ask for one to be imported.',
        );
        return;
      }
      this.emitFile({ type: 'asset', fileName: 'dataset.json', source: readFileSync(DATASET) });
    },
  };
}

export default defineConfig({
  root: 'ui',
  publicDir: false,
  plugins: [react(), datasetAsset()],
  server: {
    port: 5173,
    open: true,
    // scoring-core lives above the Vite root and is imported by the app.
    fs: { allow: ['..'] },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
