import { HttpHighSignalProvider } from './http.js';
import type { HighSignalProvider } from './types.js';

export * from './types.js';
export { HttpHighSignalProvider };

/** Community scores always come from the live HighSignal API. */
export function makeHighSignalProvider(): HighSignalProvider {
  return new HttpHighSignalProvider();
}
