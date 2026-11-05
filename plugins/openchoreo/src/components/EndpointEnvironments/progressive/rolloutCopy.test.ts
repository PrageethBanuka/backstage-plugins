import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from './pdTypes';
import { finishLabel, finishProblem, shareMeaning } from './rolloutCopy';

const rollout = (strategy: EndpointRollout['strategy']): EndpointRollout => ({
  strategy,
  stable: 'trips-python',
  candidate: 'trips-go',
  steps: [20, 100],
});

const env = (displayName: string, goWeight: number): EndpointEnvironment => ({
  name: displayName.toLowerCase(),
  displayName,
  bindingName: `trips-${displayName.toLowerCase()}`,
  backends: [
    {
      name: 'trips-python',
      componentName: 'trips-python',
      endpoint: 'http',
      weight: 100 - goWeight,
      resolved: true,
    },
    {
      name: 'trips-go',
      componentName: 'trips-go',
      endpoint: 'http',
      weight: goWeight,
      resolved: true,
    },
  ],
  overrides: [],
  promotionTargets: [],
});

describe('shareMeaning', () => {
  it('says a canary step is a share of the replaced backend', () => {
    expect(shareMeaning(rollout('canary'), 20)).toBe(
      'trips-go gets 20% of trips-python’s traffic.',
    );
  });

  it('says what blue/green and an A/B test serve at their two stages', () => {
    expect(shareMeaning(rollout('blueGreen'), 0)).toBe(
      'Only preview requests reach trips-go.',
    );
    expect(shareMeaning(rollout('blueGreen'), 100)).toBe(
      'trips-go has all of trips-python’s traffic.',
    );
    expect(shareMeaning(rollout('abTest'), 0)).toBe(
      'Only the test group reaches trips-go.',
    );
    expect(shareMeaning(rollout('abTest'), 100)).toBe(
      'Everyone on trips-python now reaches trips-go.',
    );
  });

  it('gives a share set by hand between two stages as a percentage', () => {
    expect(shareMeaning(rollout('blueGreen'), 30)).toBe(
      'trips-go gets 30% of trips-python’s traffic.',
    );
  });
});

describe('finishProblem', () => {
  it('keeps the new version once every environment gives it everything', () => {
    const envs = [env('Development', 100), env('Staging', 100)];
    expect(finishProblem(rollout('canary'), envs, 'complete')).toBe('');
    expect(finishProblem(rollout('canary'), envs, 'abandon')).toBe(
      'trips-go still gets traffic in Development, Staging. Move them to 0% first.',
    );
  });

  it('names the environments still to move, in the strategy’s words', () => {
    const envs = [env('Development', 100), env('Staging', 0)];
    expect(finishProblem(rollout('canary'), envs, 'complete')).toBe(
      'trips-python still gets traffic in Staging. Step them to 100% first.',
    );
    expect(finishProblem(rollout('blueGreen'), envs, 'complete')).toMatch(
      /Switch them to New first\.$/,
    );
    expect(finishProblem(rollout('abTest'), envs, 'abandon')).toMatch(
      /Move them back to the test group first\.$/,
    );
  });

  it('never keeps a mirror, which only gets copies', () => {
    expect(finishProblem(rollout('mirror'), [], 'complete')).toBe(
      'trips-go only gets copies. Convert it to a canary first.',
    );
    expect(finishProblem(rollout('mirror'), [], 'abandon')).toBe('');
  });
});

describe('finishLabel', () => {
  it('names the button by the strategy', () => {
    expect(finishLabel(rollout('canary'))).toBe('Finish canary');
    expect(finishLabel(rollout('blueGreen'))).toBe('Finish blue/green');
    expect(finishLabel(rollout('abTest'))).toBe('Finish A/B test');
    expect(finishLabel(rollout('mirror'))).toBe('Finish mirror');
  });
});
