import { HIGHSIGNAL_CSV, HIGHSIGNAL_SOURCE } from '../../config.js';
import { CsvHighSignalProvider } from './csv.js';
import { HttpHighSignalProvider } from './http.js';
import type { HighSignalProvider } from './types.js';

export * from './types.js';
export { CsvHighSignalProvider, HttpHighSignalProvider };

/** HTTP is the default; `HIGHSIGNAL_SOURCE=csv` selects the offline adapter. */
export function makeHighSignalProvider(): HighSignalProvider {
  return HIGHSIGNAL_SOURCE === 'csv'
    ? new CsvHighSignalProvider(HIGHSIGNAL_CSV)
    : new HttpHighSignalProvider();
}
