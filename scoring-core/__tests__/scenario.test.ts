/** Scenarios, presets and dataset parsing. */
import { describe, expect, it } from 'vitest';
import { parseDataset } from '../dataset-io.js';
import {
  DEFAULT_DELEGATION,
  DEFAULT_PARAMS,
  nominationsCsv,
  parseDelegation,
  parseNominations,
  parseParams,
  PresetError,
} from '../params.js';
import { prepare } from '../prepared.js';
import { poolAt, productionScenario, runScenario } from '../simulate.js';
import { ALICE, AS_OF, BOB, CAROL, dataset, proposals, voted } from './fixtures.js';

const five = proposals(5);

function scenarioDataset() {
  const d = dataset({
    roster: [ALICE, BOB, CAROL],
    proposals: five,
    votes: [...voted(ALICE, five), ...voted(BOB, five)],
  });
  d.roster[2]!.sources = ['highsignal_eth:lido'];
  d.roster[0]!.sources = ['grandfathered', 'snapshot_voter'];
  d.roster[1]!.sources = ['snapshot_follower'];
  d.ethCommunity = [CAROL];
  d.pools = [
    { asOf: '2026-06-01', pool: 100_000 },
    { asOf: AS_OF, pool: 300_000 },
  ];
  return d;
}

describe('runScenario', () => {
  it("uses the pool production read for the as-of, unless it's overridden", () => {
    const d = scenarioDataset();
    const p = prepare(d);
    expect(runScenario(p, productionScenario(d), AS_OF).allocation!.delegated).toBe(300_000);
    expect(runScenario(p, productionScenario(d), '2026-06-15').allocation!.delegated).toBe(100_000);
    expect(runScenario(p, { ...productionScenario(d), pool: 1_000_000 }, AS_OF).allocation!.voided).toBe(500_000);
  });

  it('filters the roster by source kind', () => {
    const d = scenarioDataset();
    const outcome = runScenario(prepare(d), { ...productionScenario(d), sources: ['snapshot_voter', 'highsignal_eth'] }, AS_OF);
    expect(outcome.rows.map((r) => r.address).sort()).toEqual([ALICE, CAROL]);
    expect(outcome.allocation!.members.get(CAROL)).toBe('ethCommunities');
  });

  it('reports a nomination conflict instead of throwing', () => {
    const d = scenarioDataset();
    d.identities = [
      { address: ALICE, hsUsername: 'al' },
      { address: BOB, hsUsername: 'al' },
    ];
    const scenario = {
      ...productionScenario(d),
      nominations: [
        { address: ALICE, cohort: 'professional' as const },
        { address: BOB, cohort: 'grantRecipients' as const },
      ],
    };
    const outcome = runScenario(prepare(d), scenario, AS_OF);
    expect(outcome.allocation).toBeNull();
    expect(outcome.error).toMatch(/one identity nominated/);
  });

  it('falls back to the earliest pool before the first run', () => {
    expect(poolAt(scenarioDataset(), '2026-01-01')).toBe(100_000);
  });
});

describe('presets', () => {
  it('reads production config files as they are', () => {
    const delegation = { cap: 500000.0, scoreThreshold: 20.0, cohorts: DEFAULT_DELEGATION.cohorts };
    expect(parseParams(JSON.parse(JSON.stringify(DEFAULT_PARAMS)))).toEqual(DEFAULT_PARAMS);
    expect(parseDelegation(delegation)).toEqual(DEFAULT_DELEGATION);
  });

  it('rejects unknown keys and out-of-range values, as production does', () => {
    expect(() => parseParams({ ...DEFAULT_PARAMS, missingPolicy: 'zero' })).toThrow(PresetError);
    expect(() =>
      parseParams({ ...DEFAULT_PARAMS, holdings: { ...DEFAULT_PARAMS.holdings, windowDays: 0.5 } }),
    ).toThrow(/integer/);
  });

  it('round-trips nominations through production CSV', () => {
    const list = [{ address: ALICE, cohort: 'professional' as const }];
    expect(parseNominations(nominationsCsv(list))).toEqual(list);
    expect(() => parseNominations([{ address: ALICE, cohort: 'ssvCommunity' }])).toThrow(/cohort/);
  });
});

describe('parseDataset', () => {
  it('round-trips a dataset', () => {
    const d = scenarioDataset();
    expect(parseDataset(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('names a dataset from the old collector', () => {
    expect(() => parseDataset({ delegates: [] })).toThrow(/old simulator collector/);
  });

  it('converts a production run export, scoring only its as-of', () => {
    const exported = {
      runId: 7,
      asOf: AS_OF,
      codeVersion: 'abc',
      params: DEFAULT_PARAMS,
      delegation: DEFAULT_DELEGATION,
      nominations: [],
      optOutHighWaterMark: 0,
      dataset: {
        asOf: AS_OF,
        pool: '299087.03312036255',
        roster: [{ address: ALICE, displayName: 'Alice' }],
        proposals: five.map((p) => ({ id: p.id, title: p.title, end: p.end })),
        votes: voted(ALICE, five).map((v) => ({ proposalId: v.proposalId, voter: v.voter, created: v.created })),
        community: [],
        balances: [{ address: ALICE, date: AS_OF, ssv: '1500.5', cssv: '999.5' }],
        identities: [],
        nominations: [],
        ethCommunity: [],
        optedOut: [],
        safeDelegators: [],
      },
    };
    const d = parseDataset(exported);
    expect(d.dateRange).toEqual({ start: AS_OF, end: AS_OF });
    expect(d.pools).toEqual([{ asOf: AS_OF, pool: 299087.03312036255 }]);
    const [alice] = runScenario(prepare(d), productionScenario(d), AS_OF).rows;
    expect([alice!.twab, alice!.votes]).toEqual([2500, 100]);
  });
});
