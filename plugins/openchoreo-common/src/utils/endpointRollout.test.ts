import type { EndpointRollout } from '../types/endpoint-types';
import {
  completionBlockers,
  currentRollout,
  nextRolloutStage,
  parseRollout,
  planRollout,
  ROLLOUT_ANNOTATION,
  rolloutPosition,
  rolloutStages,
  rolloutWeights,
  serializeRollout,
  abAudience,
  completeSplit,
  convertToCanary,
  stableLabel,
  untouchedSplit,
} from './endpointRollout';
import { finishStrategy } from './endpointStrategies';

const canary: EndpointRollout = {
  strategy: 'canary',
  stable: 'trips-python',
  candidate: 'trips-go',
  steps: [5, 25, 50, 100],
};

describe('rolloutStages', () => {
  it('starts every strategy at 0% and ends at 100%', () => {
    for (const strategy of [
      'canary',
      'blueGreen',
      'abTest',
      'mirror',
    ] as const) {
      const stages = rolloutStages({ ...canary, strategy });
      expect(stages[0].percent).toBe(0);
      expect(stages[stages.length - 1].percent).toBe(100);
    }
  });

  it('names the canary steps', () => {
    expect(rolloutStages(canary).map(s => s.action)).toEqual([
      'Roll back to trips-python',
      'Advance to 5%',
      'Advance to 25%',
      'Advance to 50%',
      'Send all traffic to trips-go',
    ]);
  });
});

describe('rolloutPosition and nextRolloutStage', () => {
  it('finds the stage from the served weights', () => {
    const at25 = rolloutPosition(canary, {
      'trips-python': 75,
      'trips-go': 25,
    });
    expect(at25).toEqual({ index: 2, percent: 25, manual: false });
    expect(nextRolloutStage(canary, at25)?.percent).toBe(50);
  });

  it('flags weights set by hand and moves on from the next step up', () => {
    const at30 = rolloutPosition(canary, {
      'trips-python': 70,
      'trips-go': 30,
    });
    expect(at30.manual).toBe(true);
    expect(nextRolloutStage(canary, at30)?.percent).toBe(50);
  });

  it('has no stage after the last', () => {
    const done = rolloutPosition(canary, { 'trips-go': 1 });
    expect(nextRolloutStage(canary, done)).toBeUndefined();
  });
});

describe('rolloutWeights', () => {
  it('gives the candidate the percent, the stable version the rest', () => {
    expect(
      rolloutWeights(canary, ['trips-python', 'trips-go', 'other'], 25),
    ).toEqual([
      { name: 'trips-python', weight: 75 },
      { name: 'trips-go', weight: 25 },
      { name: 'other', weight: 0 },
    ]);
  });

  describe('next to a backend the rollout leaves alone', () => {
    const split: EndpointRollout = {
      ...canary,
      baseline: [
        { name: 'trips-python', weight: 70 },
        { name: 'trips-legacy', weight: 30 },
      ],
    };
    const names = ['trips-python', 'trips-legacy', 'trips-go'];

    it.each([
      [0, [7000, 3000, 0]],
      [25, [5250, 3000, 1750]],
      [50, [3500, 3000, 3500]],
      [100, [0, 3000, 7000]],
    ])('moves %i%% of the replaced traffic only', (percent, weights) => {
      const out = rolloutWeights(split, names, percent);
      expect(out.map(w => w.weight)).toEqual(weights);
      expect(
        rolloutPosition(
          split,
          Object.fromEntries(out.map(w => [w.name, w.weight ?? 0])),
        ).percent,
      ).toBe(percent);
    });

    it('leaves the untouched backend in place when it completes', () => {
      expect(untouchedSplit(split)).toEqual([
        { name: 'trips-legacy', weight: 30 },
      ]);
      expect(completeSplit(split)).toEqual([
        { name: 'trips-legacy', weight: 30 },
        { name: 'trips-go', weight: 70 },
      ]);
      expect(completeSplit(canary)).toEqual([
        { name: 'trips-go', weight: 100 },
      ]);
      expect(stableLabel(split)).toBe('trips-python');
    });
  });
});

describe('the rollout annotation', () => {
  it('round-trips', () => {
    expect(
      parseRollout({ [ROLLOUT_ANNOTATION]: serializeRollout(canary) }),
    ).toEqual(canary);
  });

  it('reads a rollout recorded without a baseline, and drops a bad one', () => {
    expect(
      parseRollout({ [ROLLOUT_ANNOTATION]: serializeRollout(canary) })
        ?.baseline,
    ).toBeUndefined();
    expect(
      parseRollout({
        [ROLLOUT_ANNOTATION]: JSON.stringify({
          ...canary,
          baseline: [{ name: 'x' }],
        }),
      }),
    ).toEqual(canary);
  });

  it('ignores an unreadable value', () => {
    expect(parseRollout({ [ROLLOUT_ANNOTATION]: '{nope' })).toBeUndefined();
    expect(
      parseRollout({ [ROLLOUT_ANNOTATION]: '{"strategy":"other"}' }),
    ).toBeUndefined();
  });

  it('is used only while both versions are still on the Endpoint', () => {
    const backends = [
      { componentName: 'trips-python', endpoint: 'http', weight: 100 },
    ];
    expect(
      currentRollout(
        { [ROLLOUT_ANNOTATION]: serializeRollout(canary) },
        backends,
      ).source,
    ).toBe('none');
  });
});

describe('planRollout', () => {
  it('adds the new version at 0% and records the rollout', () => {
    const plan = planRollout(
      [{ componentName: 'trips-python', endpoint: 'http', weight: 100 }],
      {
        strategy: 'canary',
        candidate: { componentName: 'trips-go', endpoint: 'http' },
        steps: [50, 10],
      },
    );
    expect(
      plan.backends.find(b => b.componentName === 'trips-go')?.weight,
    ).toBe(0);
    expect(plan.rollout).toMatchObject({
      strategy: 'canary',
      stable: 'trips-python',
      candidate: 'trips-go',
      steps: [10, 50, 100],
    });
  });

  it('records the whole current split', () => {
    const plan = planRollout(
      [
        { componentName: 'trips-legacy', endpoint: 'http', weight: 30 },
        { componentName: 'trips-python', endpoint: 'http', weight: 70 },
      ],
      {
        strategy: 'canary',
        candidate: { componentName: 'trips-go', endpoint: 'http' },
      },
    );
    expect(plan.rollout.stable).toBe('trips-python');
    expect(plan.rollout.baseline).toEqual([
      { name: 'trips-legacy', weight: 30 },
      { name: 'trips-python', weight: 70 },
    ]);
  });

  it('replaces the version picked, or else the busiest one', () => {
    const backends = [
      { componentName: 'trips-legacy', endpoint: 'http', weight: 30 },
      { componentName: 'trips-python', endpoint: 'http', weight: 70 },
    ];
    const plan = (replaces?: string) =>
      planRollout(backends, {
        strategy: 'canary',
        candidate: { componentName: 'trips-go', endpoint: 'http' },
        replaces,
      }).rollout.stable;
    expect(plan('trips-legacy')).toBe('trips-legacy');
    expect(plan('nope')).toBe('trips-python');
  });
});

describe('finishStrategy with several backends kept', () => {
  it('restores their weights', () => {
    const change = finishStrategy(
      [
        { componentName: 'a', endpoint: 'http', weight: 50 },
        { componentName: 'b', endpoint: 'http', weight: 50 },
        { componentName: 'c', endpoint: 'http', weight: 0 },
      ],
      [
        { name: 'a', weight: 70 },
        { name: 'b', weight: 30 },
      ],
    );
    expect(change.backends.map(b => [b.componentName, b.weight])).toEqual([
      ['a', 70],
      ['b', 30],
    ]);
  });
});

describe('mirror rollouts', () => {
  const mirror: EndpointRollout = {
    strategy: 'mirror',
    stable: 'trips-python',
    candidate: 'trips-go',
    steps: [5, 10, 25, 50, 100],
  };

  it('steps the copy share, read from the candidate mirror', () => {
    expect(rolloutStages(mirror).map(s => s.percent)).toEqual([
      0, 5, 10, 25, 50, 100,
    ]);
    expect(rolloutWeights(mirror, ['trips-python', 'trips-go'], 10)).toEqual([
      { name: 'trips-go', mirror: { percent: 10 } },
    ]);
    expect(rolloutPosition(mirror, { 'trips-python': 1 }, 10)).toMatchObject({
      percent: 10,
      manual: false,
    });
  });

  it('plans the candidate as a mirror and turns it into a canary', () => {
    const backends = [
      { componentName: 'trips-python', endpoint: 'http', weight: 100 },
    ];
    const plan = planRollout(backends, {
      strategy: 'mirror',
      candidate: { componentName: 'trips-go', endpoint: 'http' },
      mirrorPercent: 30,
    });
    expect(plan.backends[1]).toMatchObject({
      componentName: 'trips-go',
      weight: 0,
      mirror: { percent: 30 },
    });
    expect(plan.rollout.steps).toEqual([5, 10, 25, 30, 50, 100]);

    const canaryNow = convertToCanary(plan.backends, plan.rollout, {
      name: 'x-canary',
      value: 'true',
    });
    expect(canaryNow.backends[1].mirror).toBeUndefined();
    expect(canaryNow.backends[1].match).toEqual({
      headers: [{ name: 'x-canary', value: 'true', type: 'Exact' }],
    });
    expect(canaryNow.rollout).toMatchObject({
      strategy: 'canary',
      steps: [5, 25, 50, 100],
    });
  });
});

describe('completionBlockers', () => {
  it('lists the bound environments not yet at 100%', () => {
    const envs = [
      { name: 'dev', displayName: 'dev', bindingName: 'b1' },
      { name: 'stg', displayName: 'stg', bindingName: 'b2' },
      { name: 'prod', displayName: 'prod' },
    ];
    expect(
      completionBlockers(envs, {
        dev: { index: 4, percent: 100, manual: false },
        stg: { index: 2, percent: 25, manual: false },
      }).map(e => e.name),
    ).toEqual(['stg']);
  });
});

describe('abAudience', () => {
  it('uses the recorded header, or the phone User-Agent for older rollouts', () => {
    expect(
      abAudience({
        kind: 'cookie',
        name: 'exp',
        value: 'b',
        audience: { name: 'X-Client', value: 'ios' },
      }),
    ).toEqual({ name: 'X-Client', value: 'ios' });
    expect(
      abAudience({ kind: 'cookie', name: 'exp', value: 'b', mobileOnly: true }),
    ).toEqual({
      name: 'user-agent',
      type: 'RegularExpression',
      value: '.*Mobi.*',
    });
    expect(
      abAudience({ kind: 'cookie', name: 'exp', value: 'b' }),
    ).toBeUndefined();
  });
});
