/** Cohort allocation and identity seats, ported from production's tests. */
import { describe, expect, it } from 'vitest';
import { allocate, NominationConflictError, type AllocationInputs } from '../allocation.js';
import { group } from '../identity.js';
import { cloneDelegation, DEFAULT_DELEGATION } from '../params.js';
import type { Delegation, Nomination } from '../types.js';
import { ALICE, BOB, CAROL, CAROL_HOT, DAVE } from './fixtures.js';

const POOL = 200_000;

function delegation(patch: (d: Delegation) => void = () => {}): Delegation {
  const d = cloneDelegation(DEFAULT_DELEGATION);
  d.cap = 750_000;
  patch(d);
  return d;
}

function run(scores: Record<string, number | null>, rest: Partial<AllocationInputs> = {}) {
  return allocate({
    scores: new Map(Object.entries(scores)),
    pool: POOL,
    delegation: delegation(),
    ...rest,
  });
}

const cohort = (r: ReturnType<typeof run>, key: string) => r.cohorts.find((c) => c.cohort === key)!;
const nominate = (address: string, c: Nomination['cohort']): Nomination => ({ address, cohort: c });
const carol = new Map([
  [CAROL, 'carol'],
  [CAROL_HOT, 'carol'],
]);

describe('budgets', () => {
  it('the threshold is strict and SSV Community is split equally', () => {
    const r = run({ [ALICE]: 20.0001, [BOB]: 20, [CAROL]: 79.78 });
    expect(Object.fromEntries(r.members)).toEqual({ [ALICE]: 'ssvCommunity', [CAROL]: 'ssvCommunity' });
    expect(Object.fromEntries(r.power)).toEqual({ [ALICE]: 45_000, [BOB]: 0, [CAROL]: 45_000 });
  });

  it('a binding cap voids the excess, scales every budget and warns', () => {
    const r = run({ [ALICE]: 50 }, { pool: 1_000_000 });
    expect([r.delegated, r.cap, r.effective, r.voided]).toEqual([1_000_000, 750_000, 750_000, 250_000]);
    expect(r.power.get(ALICE)).toBeCloseTo(337_500, 6);
    expect(r.warnings).toContain('cap binds: 250000 of the 1e+06 pool is voided');
  });

  it('a cap above the pool voids nothing and does not warn', () => {
    const r = run({ [ALICE]: 50 });
    expect([r.effective, r.voided]).toEqual([200_000, 0]);
    expect(r.warnings.some((w) => w.includes('cap'))).toBe(false);
  });

  it('a null cap is uncapped', () => {
    const r = run({ [ALICE]: 50 }, { pool: 5_000_000, delegation: delegation((d) => (d.cap = null)) });
    expect([r.cap, r.effective, r.voided]).toEqual([null, 5_000_000, 0]);
  });

  it('shares below 100 leave an unallocated reserve', () => {
    const r = run({ [ALICE]: 50 }, { delegation: delegation((d) => (d.cohorts.ssvCommunity.pct = 30)) });
    expect(r.unallocated).toBeCloseTo(30_000, 6);
    expect(r.power.get(ALICE)).toBeCloseTo(60_000, 6);
  });

  it('shares above 100 warn and leave no reserve', () => {
    const r = run({ [ALICE]: 50 }, { delegation: delegation((d) => (d.cohorts.ssvCommunity.pct = 60)) });
    expect(r.unallocated).toBe(0);
    expect(r.warnings).toContain('cohort shares sum to 115%, above 100%');
  });

  it('an under-filled nominated cohort still budgets and warns', () => {
    const operators = cohort(run({ [ALICE]: 50 }), 'verifiedOperators');
    expect([operators.budget, operators.memberCount, operators.perMember]).toEqual([50_000, 0, 0]);
    expect(operators.warning).toBe('verifiedOperators has 0 of at least 5 members');
  });

  it('an empty automatic cohort has zero per member and no warning', () => {
    const r = run({ [ALICE]: 10 });
    expect([cohort(r, 'ssvCommunity').perMember, cohort(r, 'ssvCommunity').warning]).toEqual([0, null]);
    expect(r.members.size).toBe(0);
  });
});

describe('membership', () => {
  it('nominees fill their cohort whatever their score', () => {
    const r = run(
      { [ALICE]: 90, [BOB]: null, [CAROL]: 50 },
      { nominations: [nominate(ALICE, 'professional'), nominate(BOB, 'professional')] },
    );
    expect(Object.fromEntries(r.members)).toEqual({
      [ALICE]: 'professional',
      [BOB]: 'professional',
      [CAROL]: 'ssvCommunity',
    });
    expect(Object.fromEntries(r.power)).toEqual({ [ALICE]: 10_000, [BOB]: 10_000, [CAROL]: 90_000 });
  });

  it('nomination beats SSV Community beats Ethereum Communities', () => {
    const r = run(
      { [ALICE]: 90, [BOB]: 90, [CAROL]: 5, [DAVE]: 5 },
      { nominations: [nominate(ALICE, 'grantRecipients')], ethCommunity: new Set([ALICE, BOB, CAROL]) },
    );
    expect(Object.fromEntries(r.members)).toEqual({
      [ALICE]: 'grantRecipients',
      [BOB]: 'ssvCommunity',
      [CAROL]: 'ethCommunities',
    });
  });

  it('an opted-out address qualifies for no cohort, and its nomination is reported', () => {
    const r = run(
      { [ALICE]: 90 },
      { nominations: [nominate(ALICE, 'professional')], optedOut: new Set([ALICE]) },
    );
    expect(r.members.size).toBe(0);
    expect(r.overridden).toEqual([nominate(ALICE, 'professional')]);
  });

  it('an auto-delegator qualifies for no cohort and voids its nomination with a warning', () => {
    const r = run(
      { [ALICE]: 90 },
      { nominations: [nominate(ALICE, 'professional')], safeDelegators: new Set([ALICE]) },
    );
    expect(r.members.size).toBe(0);
    expect(r.warnings).toContain(
      `${ALICE} delegates to the auto-delegation pool, so its professional nomination is void.`,
    );
  });
});

describe('identity seats', () => {
  it("an identity's seat is held by its highest-scoring qualifying address", () => {
    const r = run({ [CAROL]: 40, [CAROL_HOT]: 60 }, { identities: carol });
    expect(Object.fromEntries(r.members)).toEqual({ [CAROL_HOT]: 'ssvCommunity' });
    expect(cohort(r, 'ssvCommunity').memberCount).toBe(1);
    expect(r.power.get(CAROL)).toBe(0);
  });

  it('equally scoring addresses give the seat to the lower address', () => {
    const r = run({ [CAROL_HOT]: 60, [CAROL]: 60 }, { identities: carol });
    expect([...r.members.keys()]).toEqual([CAROL]);
  });

  it('nominating any one address places the identity', () => {
    const r = run(
      { [CAROL]: 90, [CAROL_HOT]: 10 },
      { identities: carol, nominations: [nominate(CAROL_HOT, 'verifiedOperators')] },
    );
    expect(Object.fromEntries(r.members)).toEqual({ [CAROL_HOT]: 'verifiedOperators' });
  });

  it('an opted-out address passes the seat to a remaining qualifying address', () => {
    const r = run({ [CAROL]: 40, [CAROL_HOT]: 60 }, { identities: carol, optedOut: new Set([CAROL_HOT]) });
    expect(Object.fromEntries(r.members)).toEqual({ [CAROL]: 'ssvCommunity' });
  });

  it('one identity nominated to two cohorts throws, naming both addresses', () => {
    expect(() =>
      run(
        { [CAROL]: 50, [CAROL_HOT]: 50 },
        {
          identities: carol,
          nominations: [nominate(CAROL, 'professional'), nominate(CAROL_HOT, 'grantRecipients')],
        },
      ),
    ).toThrow(new NominationConflictError(
      `${CAROL} and ${CAROL_HOT} are one identity nominated to professional and grantRecipients`,
    ));
  });

  it('without a multi-address identity, seats are per address and it warns', () => {
    expect(run({ [ALICE]: 50 }).warnings).toContain(
      'no identity has several addresses: cohort seats are allocated per address',
    );
  });
});

describe('group', () => {
  it('links addresses of one HighSignal user under the username', () => {
    const ids = group([ALICE, CAROL, CAROL_HOT], [
      { address: CAROL, hsUsername: 'carol' },
      { address: CAROL_HOT, hsUsername: 'carol' },
    ]);
    expect(ids.get(CAROL)).toEqual({ id: 'carol', hsUsername: 'carol' });
    expect(ids.get(CAROL_HOT)!.id).toBe('carol');
    expect(ids.get(ALICE)).toEqual({ id: ALICE, hsUsername: null });
  });

  it('users sharing an address outside the roster are one identity, under the first username', () => {
    const outside = '0x00000000000000000000000000000000000000ee';
    const ids = group([ALICE, BOB], [
      { address: ALICE, hsUsername: 'zed' },
      { address: outside, hsUsername: 'zed' },
      { address: outside, hsUsername: 'amy' },
      { address: BOB, hsUsername: 'amy' },
    ]);
    expect([ids.get(ALICE)!.id, ids.get(BOB)!.id]).toEqual(['amy', 'amy']);
  });
});
