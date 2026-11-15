/** The three pillars and the composite, ported from production's tests. */
import { describe, expect, it } from 'vitest';
import { addDays, endOfDay } from '../dates.js';
import {
  ALICE,
  AS_OF,
  BOB,
  dataset,
  held,
  observed,
  params,
  proposals,
  row,
  score,
  voted,
  WHALE,
} from './fixtures.js';

const alice = (...args: Parameters<typeof score>) => row(score(...args), ALICE);

describe('holdings', () => {
  it.each([
    [100, 10],
    [1000, 31.62],
    [2500, 50],
    [10_000, 100],
    [100_000, 100],
  ])('TWAB %d scores %d, as in the ratified table', (twab, expected) => {
    const result = alice(dataset({ roster: [ALICE], balances: held(ALICE, twab, 90) }));
    expect(result.holdings).toBeCloseTo(expected, 2);
    expect([result.twab, result.twabDays]).toEqual([twab, 90]);
  });

  it('concavity 1 is linear', () => {
    const d = dataset({ roster: [ALICE], balances: held(ALICE, 2500, 90) });
    expect(alice(d, params((p) => (p.holdings.concavity = 1))).holdings).toBe(25);
  });

  it('five collected days of a steady holding score as held, not diluted', () => {
    const result = alice(dataset({ roster: [ALICE], balances: held(ALICE, 12_000, 5) }));
    expect([result.twab, result.twabDays, result.holdings]).toEqual([12_000, 5, 100]);
  });

  it('coverage is dataset-wide, so a shorter history gains nothing', () => {
    const rows = score(
      dataset({ roster: [ALICE, BOB], balances: [...held(ALICE, 2500, 10), ...held(BOB, 2500, 5)] }),
    );
    expect([row(rows, ALICE).twabDays, row(rows, ALICE).twab]).toEqual([10, 2500]);
    expect([row(rows, BOB).twabDays, row(rows, BOB).twab]).toEqual([10, 1250]);
  });

  it('is not live before coverage starts', () => {
    const result = alice(
      dataset({ roster: [ALICE], balances: held(ALICE, 2500, 5, addDays(AS_OF, 5)) }),
    );
    expect([result.twab, result.twabDays, result.holdings, result.missing.holdings]).toEqual([
      null,
      null,
      null,
      false,
    ]);
  });

  it('an address without rows has a null TWAB and is flagged missing', () => {
    const bob = row(score(dataset({ roster: [ALICE, BOB], balances: held(ALICE, 2500, 90) })), BOB);
    expect([bob.twab, bob.twabDays, bob.holdings, bob.missing.holdings]).toEqual([null, null, 0, true]);
  });

  it('past the last collected day, the window ends at that day', () => {
    const last = addDays(AS_OF, -10);
    const balances = [...held(ALICE, 0, 10, last), ...held(ALICE, 10_000, 5, addDays(last, -10))];
    const result = alice(dataset({ roster: [ALICE], balances }), params((p) => (p.holdings.windowDays = 10)));
    expect([result.twab, result.twabDays]).toEqual([0, 10]);
  });

  it('recorded zeros dilute a late purchase', () => {
    const balances = [...held(ALICE, 900, 1), ...held(ALICE, 0, 89, addDays(AS_OF, -1))];
    const result = alice(dataset({ roster: [ALICE], balances }));
    expect(result.twab).toBeCloseTo(10, 9);
    expect(result.holdings).toBeCloseTo(3.162, 3);
  });

  it('carries a balance forward over uncollected days', () => {
    const balances = [
      ...held(ALICE, 0, 1, addDays(AS_OF, -4)),
      ...held(ALICE, 5000, 1, addDays(AS_OF, -3)),
      ...held(BOB, 0, 5),
    ];
    const result = alice(dataset({ roster: [ALICE, BOB], balances }));
    expect([result.twab, result.twabDays]).toEqual([4000, 5]);
  });

  it('ignores balances dated after the as-of', () => {
    const balances = [...held(ALICE, 0, 30), ...held(ALICE, 1_000_000, 30, addDays(AS_OF, 30))];
    expect(alice(dataset({ roster: [ALICE], balances })).twab).toBe(0);
  });
});

describe('votes', () => {
  const five = proposals(5);

  it('is not live with no closed proposal', () => {
    expect(alice(dataset({ roster: [ALICE] })).votes).toBeNull();
  });

  it('skipping the oldest of five monthly proposals scores 88.05', () => {
    const result = alice(dataset({ roster: [ALICE], proposals: five, votes: voted(ALICE, five.slice(0, 4)) }));
    expect(result.votes).toBeCloseTo(88.05, 2);
    expect([result.votedCount, result.proposalCount]).toEqual([4, 5]);
  });

  it('skipping the most recent instead scores 69.88', () => {
    const result = alice(dataset({ roster: [ALICE], proposals: five, votes: voted(ALICE, five.slice(1)) }));
    expect(result.votes).toBeCloseTo(69.88, 2);
  });

  it('ignores proposals closing after the as-of ends', () => {
    const later = { id: 'later', title: 'Later', end: endOfDay(AS_OF) };
    const result = alice(
      dataset({ roster: [ALICE], proposals: [...five, later], votes: voted(ALICE, five) }),
    );
    expect([result.votes, result.proposalCount]).toEqual([100, 5]);
  });

  it('ignores a vote cast after the as-of ended', () => {
    const late = [{ proposalId: 'p0', voter: ALICE, created: endOfDay(AS_OF) }];
    const result = alice(dataset({ roster: [ALICE], proposals: five, votes: [...voted(ALICE, five.slice(1)), ...late] }));
    expect(result.votedCount).toBe(4);
    expect(result.votes).toBeCloseTo(69.88, 2);
  });

  it('counts only the latest N proposals', () => {
    const twelve = proposals(12, 7);
    const result = alice(dataset({ roster: [ALICE], proposals: twelve, votes: voted(ALICE, twelve.slice(10)) }));
    expect([result.votes, result.votedCount, result.proposalCount]).toEqual([0, 0, 10]);
  });

  it('a longer half-life flattens recency toward plain counting', () => {
    const d = dataset({ roster: [ALICE], proposals: five, votes: voted(ALICE, five.slice(1)) });
    const long = alice(d, params((p) => (p.votes.halfLifeDays = 10_000))).votes!;
    expect(long).toBeGreaterThan(alice(d).votes!);
    expect(long).toBeCloseTo(80, 0);
  });

  it('voting on every proposal scores exactly 100', () => {
    expect(alice(dataset({ roster: [ALICE], proposals: five, votes: voted(ALICE, five) })).votes).toBe(100);
  });
});

describe('community', () => {
  it.each([
    [82, 100, 82],
    [130, 100, 100],
    [-5, 100, 0],
    [40, 50, 80],
  ])('HighSignal %d over ref %d scores %d', (hs, ref, expected) => {
    const d = dataset({ roster: [ALICE], community: [observed(ALICE, hs)] });
    expect(alice(d, params((p) => (p.community.ref = ref))).community).toBe(expected);
  });

  it('uses the latest observation on or before the as-of', () => {
    const d = dataset({
      roster: [ALICE],
      community: [observed(ALICE, 10, addDays(AS_OF, -3)), observed(ALICE, 60, AS_OF), observed(ALICE, 99, addDays(AS_OF, 1))],
    });
    expect([alice(d).community, alice(d).communityRaw]).toEqual([60, 60]);
  });

  it('an address without an observation scores 0 and is flagged missing', () => {
    const bob = row(score(dataset({ roster: [ALICE, BOB], community: [observed(ALICE, 50)] })), BOB);
    expect([bob.community, bob.missing.community]).toEqual([0, true]);
  });
});

describe('composite', () => {
  const five = proposals(5);
  const workedExample = dataset({
    roster: [ALICE, WHALE],
    proposals: five,
    votes: [...voted(ALICE, five.slice(0, 4)), ...voted(WHALE, five.slice(0, 4))],
    community: [observed(ALICE, 82), observed(WHALE, 82)],
    balances: [...held(ALICE, 2500, 90), ...held(WHALE, 1_000_000, 90)],
  });

  it('reproduces the worked example: 79.78, and a 400× whale gains 9.375', () => {
    const rows = score(workedExample);
    expect(row(rows, ALICE).score).toBeCloseTo(79.78, 2);
    expect(row(rows, WHALE).score! - row(rows, ALICE).score!).toBeCloseTo(9.375, 9);
  });

  it('excludes a pillar nobody has data for, for everyone', () => {
    const d = dataset({ roster: [ALICE], proposals: five, votes: voted(ALICE, five) });
    const result = alice(d);
    expect([result.community, result.holdings, result.score]).toEqual([null, null, 100]);
  });

  it('missing data never beats a measured low score', () => {
    const d = dataset({
      roster: [ALICE, BOB],
      proposals: five,
      votes: [...voted(ALICE, five), ...voted(BOB, five)],
      community: [observed(ALICE, 8)],
    });
    const rows = score(d);
    expect(row(rows, ALICE).score).toBeGreaterThan(row(rows, BOB).score!);
  });

  it('a live pillar at weight 0 is shown but not counted', () => {
    const d = dataset({ roster: [ALICE], proposals: five, votes: voted(ALICE, five), community: [observed(ALICE, 10)] });
    const result = alice(d, params((p) => (p.weights.community = 0)));
    expect([result.community, result.score]).toEqual([10, 100]);
  });

  it('with no live weighted pillar, nobody is scored or ranked', () => {
    const d = dataset({ roster: [ALICE], community: [observed(ALICE, 10)] });
    const result = alice(d, params((p) => (p.weights.community = 0)));
    expect([result.score, result.rank]).toEqual([null, null]);
  });

  it('ranks by score, then by address', () => {
    const d = dataset({ roster: [BOB, ALICE, WHALE], proposals: five, votes: [...voted(BOB, five), ...voted(ALICE, five)] });
    expect(score(d).map((r) => [r.address, r.rank])).toEqual([
      [ALICE, 1],
      [BOB, 2],
      [WHALE, 3],
    ]);
  });
});
