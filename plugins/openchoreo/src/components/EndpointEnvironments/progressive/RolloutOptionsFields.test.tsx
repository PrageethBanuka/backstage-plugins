import {
  defaultRolloutOptions,
  rolloutOptionsPlan,
  rolloutOptionsProblem,
  withStrategyDefaults,
} from './RolloutOptionsFields';

describe('rollout options', () => {
  it('starts each strategy from its usual way in', () => {
    const canary = defaultRolloutOptions('canary', 'orders-api');
    expect(rolloutOptionsPlan('canary', canary)).toEqual({
      steps: [5, 25, 50, 100],
      preview: { kind: 'header', name: 'x-canary', value: 'true' },
    });
    expect(
      rolloutOptionsPlan(
        'blueGreen',
        withStrategyDefaults(canary, 'blueGreen'),
      ),
    ).toEqual({
      preview: { kind: 'header', name: 'x-preview', value: 'green' },
    });
    expect(rolloutOptionsPlan('abTest', canary)).toEqual({
      preview: { kind: 'cookie', name: 'exp_orders_api', value: 'b' },
    });
    expect(rolloutOptionsPlan('mirror', canary)).toEqual({
      steps: [5, 25, 50, 100],
    });
  });

  it('leaves the header out of a canary that turns it off', () => {
    const o = { ...defaultRolloutOptions('canary', 'x'), useHeader: false };
    expect(rolloutOptionsPlan('canary', o)).toEqual({
      steps: [5, 25, 50, 100],
    });
  });

  it('previews blue/green by a path', () => {
    const o = {
      ...defaultRolloutOptions('blueGreen', 'x'),
      previewBy: 'path' as const,
      previewPath: '/next',
    };
    expect(rolloutOptionsPlan('blueGreen', o)).toEqual({
      preview: { kind: 'path', name: 'path', value: '/next' },
    });
  });

  it('says what is missing', () => {
    const o = { ...defaultRolloutOptions('abTest', 'x'), cookieValue: '' };
    expect(rolloutOptionsPlan('abTest', o)).toBeNull();
    expect(rolloutOptionsProblem('abTest', o)).toBe(
      'Fill in how to reach the new backend',
    );
    expect(
      rolloutOptionsProblem('canary', defaultRolloutOptions('canary', 'x')),
    ).toBe('');
  });
});

describe("rollout options on a type that can't do everything", () => {
  const matchOnly = {
    typeName: 'gamma-httproute',
    capabilities: ['Match' as const],
  };

  it("starts a canary without a testers' header when the type can't match one", () => {
    const canary = defaultRolloutOptions('canary', 'orders-api', {
      capabilities: ['Mirror', 'MirrorPercent'],
    });
    expect(canary.useHeader).toBe(false);
    expect(rolloutOptionsPlan('canary', canary)).toEqual({
      steps: [5, 25, 50, 100],
    });
  });

  it('refuses an audience matched by regular expression', () => {
    const ab = {
      ...defaultRolloutOptions('abTest', 'orders-api', matchOnly),
      audienceOn: true,
    };
    expect(rolloutOptionsProblem('abTest', ab, matchOnly)).toBe(
      'gamma-httproute can\'t match a header by regular expression; use "is exactly"',
    );
    expect(
      rolloutOptionsProblem(
        'abTest',
        { ...ab, audience: { ...ab.audience, type: 'Exact' } },
        matchOnly,
      ),
    ).toBe('');
  });
});
