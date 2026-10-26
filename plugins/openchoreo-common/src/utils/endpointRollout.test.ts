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
} from './endpointRollout';

const canary: EndpointRollout = {
  strategy: 'canary',
  stable: 'trips-python',
  candidate: 'trips-go',
  steps: [5, 25, 50, 100],
};

describe('rolloutStages', () => {
  it('starts every strategy at 0% and ends at 100%', () => {
    for (const strategy of ['canary', 'blueGreen', 'abTest'] as const) {
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
});

describe('the rollout annotation', () => {
  it('round-trips', () => {
    expect(
      parseRollout({ [ROLLOUT_ANNOTATION]: serializeRollout(canary) }),
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
        [],
      ).source,
    ).toBe('none');
  });
});

describe('planRollout', () => {
  it('adds the new version at 0% and records the rollout', () => {
    const plan = planRollout(
      [{ componentName: 'trips-python', endpoint: 'http', weight: 100 }],
      [],
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
