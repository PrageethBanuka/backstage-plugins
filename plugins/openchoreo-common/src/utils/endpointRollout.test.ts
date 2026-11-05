import type { EndpointRollout } from '../types/endpoint-rollout-types';
import {
  fromSpecRollout,
  nextRolloutStage,
  planRollout,
  reconfigureRollout,
  rolloutPosition,
  rolloutStages,
  rolloutWeights,
  toSpecRollout,
  abAudience,
  completeSplit,
  convertToCanary,
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
      'Back to Current',
      'Next step (5%)',
      'Next step (25%)',
      'Next step (50%)',
      'Send all traffic to New version',
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
    });
  });
});

describe('spec.rollout', () => {
  it('is written with the candidate share at each step', () => {
    expect(toSpecRollout(canary)).toEqual({
      strategy: 'canary',
      stable: 'trips-python',
      candidates: [{ name: 'trips-go' }],
      canary: {
        steps: [5, 25, 50, 100].map(percent => ({
          backends: [{ name: 'trips-go', percent }],
        })),
      },
    });
    expect(
      toSpecRollout({ ...canary, strategy: 'blueGreen', steps: [100] }),
    ).toEqual({
      strategy: 'blueGreen',
      stable: 'trips-python',
      candidates: [{ name: 'trips-go' }],
    });
  });

  it('reads back the steps, the other weights and the preview', () => {
    const backends = [
      {
        name: 'trips-python',
        componentName: 'trips-python',
        endpoint: 'http',
        weight: 70,
      },
      {
        name: 'trips-legacy',
        componentName: 'trips-legacy',
        endpoint: 'http',
        weight: 30,
      },
      {
        name: 'trips-go',
        componentName: 'trips-go',
        endpoint: 'http',
        weight: 0,
        match: { headers: [{ name: 'x-canary', value: 'true' }] },
      },
    ];
    expect(fromSpecRollout(toSpecRollout(canary), backends)).toEqual({
      ...canary,
      baseline: [
        { name: 'trips-python', weight: 70 },
        { name: 'trips-legacy', weight: 30 },
      ],
      preview: { kind: 'header', name: 'x-canary', value: 'true' },
    });
  });

  it('reads an A/B cookie and its audience', () => {
    const backends = [
      { name: 'a', componentName: 'a', endpoint: 'http', weight: 100 },
      {
        name: 'b',
        componentName: 'b',
        endpoint: 'http',
        weight: 0,
        match: {
          cookies: [{ name: 'exp', value: 'b' }],
          headers: [{ name: 'x-client', value: 'ios' }],
        },
      },
    ];
    expect(
      fromSpecRollout(
        { strategy: 'abTest', stable: 'a', candidates: [{ name: 'b' }] },
        backends,
      ),
    ).toMatchObject({
      steps: [100],
      preview: {
        kind: 'cookie',
        name: 'exp',
        value: 'b',
        audience: { name: 'x-client', value: 'ios' },
      },
    });
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

describe('reconfigureRollout', () => {
  const backends = [
    { name: 'trips', componentName: 'trips', endpoint: 'http', weight: 100 },
    {
      name: 'trips-v2',
      componentName: 'trips',
      releaseLine: 'v2',
      endpoint: 'http',
      weight: 0,
      match: {
        headers: [{ name: 'x-canary', type: 'Exact' as const, value: 'true' }],
      },
    },
  ];
  const running: EndpointRollout = {
    strategy: 'canary',
    stable: 'trips',
    candidate: 'trips-v2',
    steps: [5, 25, 50, 100],
    preview: { kind: 'header', name: 'x-canary', value: 'true' },
  };

  it('changes the steps without cutting a release', () => {
    const next = reconfigureRollout(backends, running, {
      steps: [10, 30],
      preview: running.preview,
    });
    expect(next.releaseChanged).toBe(false);
    expect(next.rollout).toEqual({ ...running, steps: [10, 30, 100] });
  });

  it("moves the new version's header and keeps the versions", () => {
    const next = reconfigureRollout(backends, running, {
      steps: running.steps,
      preview: { kind: 'header', name: 'x-beta', value: 'yes' },
    });
    expect(next.releaseChanged).toBe(true);
    expect(next.rollout).toMatchObject({
      stable: 'trips',
      candidate: 'trips-v2',
      preview: { name: 'x-beta', value: 'yes' },
    });
    expect(next.backends.find(b => b.name === 'trips-v2')?.match).toEqual({
      headers: [{ name: 'x-beta', type: 'Exact', value: 'yes' }],
    });
  });

  it('drops the testers header when none is given', () => {
    const next = reconfigureRollout(backends, running, { steps: [50] });
    expect(next.releaseChanged).toBe(true);
    expect(next.rollout.preview).toBeUndefined();
    expect(
      next.backends.find(b => b.name === 'trips-v2')?.match,
    ).toBeUndefined();
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

describe('mirror steps', () => {
  const backends = [
    { componentName: 'trips-python', endpoint: 'http', weight: 100 },
  ];
  const candidate = { componentName: 'trips-go', endpoint: 'http' };

  it('uses the chosen steps and starts copying at the first', () => {
    const plan = planRollout(backends, {
      strategy: 'mirror',
      candidate,
      steps: [10, 50, 100],
    });
    expect(plan.rollout.steps).toEqual([10, 50, 100]);
    expect(plan.backends[1].mirror).toEqual({ percent: 10 });
  });

  it('keeps the share a running mirror copies when only its steps change', () => {
    const plan = planRollout(backends, {
      strategy: 'mirror',
      candidate,
      steps: [10, 100],
    });
    const changed = reconfigureRollout(plan.backends, plan.rollout, {
      steps: [5, 25, 100],
    });
    expect(changed.rollout.steps).toEqual([5, 25, 100]);
    expect(changed.releaseChanged).toBe(false);
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
