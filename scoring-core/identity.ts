/**
 * Address → identity, a port of production's `scoring/identity.py`.
 *
 * Identity never affects scoring: every roster address is scored and ranked on
 * its own. It only decides allocation — each identity draws at most one seat.
 */
import { cmp } from './prepared.js';
import type { IdentityLink } from './types.js';

export interface Identity {
  /** The HighSignal username, or the address itself when unlinked. */
  id: string;
  hsUsername: string | null;
}

/**
 * Each roster address mapped to its identity.
 *
 * Addresses HighSignal publishes for one user form one identity whose id is the
 * username. Users sharing an address, also one outside the roster, form one
 * identity under the first of their usernames in sort order. Any other address
 * is an identity of one, keyed by itself.
 */
export function group(roster: readonly string[], links: readonly IdentityLink[]): Map<string, Identity> {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    while (node !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const user = (username: string) => `user:${username}`;

  for (const link of links) parent.set(find(link.address), find(user(link.hsUsername)));
  const usernames = new Map<string, string>();
  for (const link of [...links].sort((a, b) => cmp(a.hsUsername, b.hsUsername))) {
    const root = find(link.address);
    if (!usernames.has(root)) usernames.set(root, link.hsUsername);
  }
  const identities = new Map<string, Identity>();
  for (const address of roster) {
    const username = usernames.get(find(address)) ?? null;
    identities.set(address, { id: username ?? address, hsUsername: username });
  }
  return identities;
}
