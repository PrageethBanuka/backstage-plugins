import {
  planRollout,
  rolloutPosition,
  rolloutWeights,
  type EndpointBackendWeight,
  type EndpointEnvironment,
  type EndpointRollout,
  type EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import {
  audienceText,
  inRollout,
  previewCommand,
  rolloutAction,
  rolloutPromotion,
  rolloutReachText,
  servedSplit,
  restoredSummary,
  stableKeeps,
  stageText,
  untouchedSummary,
} from './endpointRolloutUi';

const canary: EndpointRollout = {
  strategy: 'canary',
  stable: 'trips-python',
  candidate: 'trips-go',
  steps: [5, 25, 50, 100],
  preview: { kind: 'header', name: 'x-canary', value: 'true' },
};

const summary = (rollout?: EndpointRollout): EndpointSummary => ({
  name: 'trips-api',
  namespaceName: 'default',
  projectName: 'trips',
  type: { kind: 'ClusterEndpointType', name: 'http' },
  visibility: ['external'],
  autoDeploy: true,
  backends: [
    { componentName: 'trips-python', endpoint: 'http', weight: 100 },
    { componentName: 'trips-go', endpoint: 'http', weight: 0 },
  ],
  rollout,
  rolloutSource: rollout ? 'annotation' : 'none',
  environments: [],
});

const env = (
  name: string,
  percent: number | undefined,
  opts: Partial<EndpointEnvironment> = {},
): EndpointEnvironment => ({
  name,
  displayName: name,
  isProduction: false,
  bindingName: `trips-api-${name}`,
  status: 'Routing',
  backends:
    percent === undefined
      ? [
          {
            componentName: 'trips-python',
            endpoint: 'http',
            weight: 100,
            resolved: true,
          },
        ]
      : [
          {
            componentName: 'trips-python',
            endpoint: 'http',
            weight: 100 - percent,
            resolved: true,
          },
          {
            componentName: 'trips-go',
            endpoint: 'http',
            weight: percent,
            resolved: true,
          },
        ],
  overrides: [],
  rollout:
    percent === undefined
      ? undefined
      : {
          index: [0, 5, 25, 50, 100].indexOf(percent),
          percent,
          manual: ![0, 5, 25, 50, 100].includes(percent),
        },
  deployedBackends: ['trips-python/http', 'trips-go/http'],
  promotionTargets: [],
  ...opts,
});

describe('rolloutAction', () => {
  it('advances to the next canary step', () => {
    const dev = env('development', 25);
    expect(rolloutAction(dev, summary(canary), [dev])).toEqual({
      kind: 'stage',
      label: 'Advance to 50%',
      percent: 50,
    });
  });

  it('has no step in an environment the rollout has not reached', () => {
    const dev = env('development', 25);
    const staging = env('staging', undefined);
    expect(
      rolloutAction(staging, summary(canary), [dev, staging]),
    ).toBeUndefined();
  });

  it('offers Complete on the last environment only, once every environment is at 100%', () => {
    const dev = env('development', 100);
    const staging = env('staging', 100);
    expect(rolloutAction(staging, summary(canary), [dev, staging])).toEqual({
      kind: 'complete',
      label: 'Keep only trips-go',
    });
    expect(rolloutAction(dev, summary(canary), [dev, staging])).toBeUndefined();
  });

  it.each(['blueGreen', 'abTest'] as const)(
    "%s: the last environment's switch only moves traffic; Complete follows",
    strategy => {
      const rollout: EndpointRollout = { ...canary, strategy, steps: [100] };
      const before = env('development', 0);
      expect(rolloutAction(before, summary(rollout), [before])).toMatchObject({
        kind: 'stage',
        percent: 100,
      });
      const after = env('development', 100);
      expect(rolloutAction(after, summary(rollout), [after])).toEqual({
        kind: 'complete',
        label: 'Keep only trips-go',
      });
    },
  );

  it('does not offer Complete while a bound environment has not got the rollout', () => {
    const dev = env('development', 100);
    const staging = env('staging', undefined);
    expect(rolloutAction(dev, summary(canary), [dev, staging])).toBeUndefined();
  });

  it('offers Complete when the only environments left do not run the Endpoint', () => {
    const dev = env('development', 100);
    const prod = env('production', undefined, { bindingName: undefined });
    expect(rolloutAction(dev, summary(canary), [dev, prod])).toEqual({
      kind: 'complete',
      label: 'Keep only trips-go',
    });
  });

  it('does not let the last switch complete while a bound environment lacks the rollout', () => {
    const blueGreen: EndpointRollout = {
      ...canary,
      strategy: 'blueGreen',
      steps: [100],
    };
    const dev = env('development', 0);
    const staging = env('staging', undefined);
    expect(
      rolloutAction(dev, summary(blueGreen), [dev, staging]),
    ).toMatchObject({ kind: 'stage', percent: 100 });
  });

  it('has no step without a rollout', () => {
    const dev = env('development', undefined);
    expect(rolloutAction(dev, summary(), [dev])).toBeUndefined();
  });
});

describe('rolloutPromotion', () => {
  it('promotes from where the rollout runs to the next environment', () => {
    const dev = env('development', 25, {
      promotionTargets: [{ name: 'staging' }],
    });
    const staging = env('staging', undefined);
    expect(rolloutPromotion(dev, summary(canary), [dev, staging])).toEqual({
      to: staging,
      action: {
        kind: 'promote',
        label: 'Promote to staging',
        from: 'development',
      },
    });
  });

  it('offers nothing once the next environment has the rollout, or without one', () => {
    const dev = env('development', 25, {
      promotionTargets: [{ name: 'staging' }],
    });
    const staging = env('staging', 0);
    expect(
      rolloutPromotion(dev, summary(canary), [dev, staging]),
    ).toBeUndefined();
    expect(
      rolloutPromotion(staging, summary(canary), [dev, staging]),
    ).toBeUndefined();
    expect(rolloutPromotion(dev, summary(), [dev, staging])).toBeUndefined();
  });
});

describe('rolloutReachText', () => {
  const withCandidate = (
    rollout: EndpointRollout,
    extra: Partial<EndpointBackendWeight>,
  ): EndpointSummary => ({
    ...summary(rollout),
    backends: [
      { componentName: 'trips-python', endpoint: 'http', weight: 100 },
      { componentName: 'trips-go', endpoint: 'http', weight: 0, ...extra },
    ],
  });
  const header = { headers: [{ name: 'x-canary', value: 'true' }] };

  it('says who reaches the new version for each strategy', () => {
    const dev = env('development', 25);
    expect(
      rolloutReachText(canary, withCandidate(canary, { match: header }), dev),
    ).toBe('x-canary: true always reaches trips-go');
    const bg: EndpointRollout = {
      ...canary,
      strategy: 'blueGreen',
      steps: [100],
    };
    expect(
      rolloutReachText(
        bg,
        withCandidate(bg, {
          match: { path: { value: '/next', type: 'PathPrefix' } },
        }),
        dev,
      ),
    ).toBe('preview with path /next/…');
    const ab: EndpointRollout = { ...canary, strategy: 'abTest', steps: [100] };
    expect(
      rolloutReachText(
        ab,
        withCandidate(ab, {
          match: { cookies: [{ name: 'exp', value: 'b' }] },
        }),
        dev,
      ),
    ).toBe('cookie exp=b gets trips-go');
    expect(rolloutReachText(canary, summary(canary), dev)).toBe('');
  });

  it("reads a mirror's share in the environment", () => {
    const mirror: EndpointRollout = { ...canary, strategy: 'mirror' };
    const dev = {
      ...env('development', undefined),
      backends: [
        {
          componentName: 'trips-python',
          endpoint: 'http',
          weight: 100,
          resolved: true,
        },
        {
          componentName: 'trips-go',
          endpoint: 'http',
          weight: 0,
          resolved: true,
          mirror: { percent: 25 },
        },
      ],
    };
    expect(
      rolloutReachText(
        mirror,
        withCandidate(mirror, { mirror: { percent: 10 } }),
        dev,
      ),
    ).toBe('copies 25% of requests; trips-go answers nobody');
  });
});

describe('stageText', () => {
  it('names the stage, or says the weights were set by hand', () => {
    expect(stageText(env('development', 25), canary)).toBe('Canary 25%');
    expect(stageText(env('development', 30), canary)).toBe('30% · set by hand');
    expect(stageText(env('development', undefined), canary)).toBe(
      'Not started',
    );
  });
});

describe('inRollout and servedSplit', () => {
  it('reads the served weights in the Endpoint order', () => {
    const dev = env('development', 25);
    expect(inRollout(dev, canary)).toBe(true);
    expect(servedSplit(dev, summary(canary)).map(b => b.weight)).toEqual([
      75, 25,
    ]);
  });
});

describe('previewCommand', () => {
  it('builds a header or cookie curl', () => {
    expect(previewCommand(canary, 'http://dev/trips')).toBe(
      "curl -H 'x-canary: true' http://dev/trips",
    );
    expect(
      previewCommand(
        {
          ...canary,
          preview: {
            kind: 'cookie',
            name: 'exp',
            value: 'b',
            mobileOnly: true,
          },
        },
        undefined,
      ),
    ).toBe("curl -H 'Cookie: exp=b' -A 'Mobile' <endpoint URL>");
  });
});

describe('the replaced and untouched versions on screen', () => {
  it('names what is replaced, what stays and what abandoning restores', () => {
    expect(stableKeeps(canary, 25)).toBe('trips-python keeps 75%');
    expect(untouchedSummary(canary)).toBe('');
    expect(restoredSummary(canary)).toBe('trips-python');
    const split: EndpointRollout = {
      ...canary,
      baseline: [
        { name: 'trips-python', weight: 70 },
        { name: 'trips-legacy', weight: 30 },
      ],
    };
    expect(stableKeeps(split, 25)).toBe(
      'trips-python keeps 75% of its traffic',
    );
    expect(untouchedSummary(split)).toBe('trips-legacy 30%');
    expect(restoredSummary(split)).toBe('trips-python 70% · trips-legacy 30%');
  });
});

describe('advancing a rollout step by step', () => {
  // Plans a canary, then presses each environment's primary button and
  // applies the weights it sets, as the backend does.
  const walk = (backends: EndpointBackendWeight[]) => {
    const plan = planRollout(backends, {
      strategy: 'canary',
      candidate: { componentName: 'trips-go', endpoint: 'http' },
    });
    const endpoint: EndpointSummary = {
      ...summary(plan.rollout),
      backends: plan.backends,
    };
    const names = plan.backends.map(b => b.name ?? b.componentName);
    const at = (percent: number): EndpointEnvironment => {
      const weights = rolloutWeights(plan.rollout, names, percent);
      return {
        ...env('development', percent),
        backends: weights.map(w => ({
          componentName: w.name,
          endpoint: 'http',
          name: w.name,
          weight: w.weight ?? 0,
          resolved: true,
        })),
        rollout: rolloutPosition(
          plan.rollout,
          Object.fromEntries(weights.map(w => [w.name, w.weight ?? 0])),
        ),
      };
    };
    const labels: string[] = [];
    let percent = 0;
    for (let i = 0; i < 10; i++) {
      const dev = at(percent);
      const action = rolloutAction(dev, endpoint, [dev]);
      if (!action) break;
      labels.push(action.label);
      if (action.kind !== 'stage') break;
      percent = action.percent;
    }
    return labels;
  };

  const steps = [
    'Advance to 5%',
    'Advance to 25%',
    'Advance to 50%',
    'Send all traffic to trips-go',
    'Keep only trips-go',
  ];

  it('walks every step on a single-version Endpoint', () => {
    expect(
      walk([{ componentName: 'trips-python', endpoint: 'http', weight: 100 }]),
    ).toEqual(steps);
  });

  it('walks every step next to a version the rollout leaves alone', () => {
    expect(
      walk([
        { componentName: 'trips-python', endpoint: 'http', weight: 70 },
        { componentName: 'trips-legacy', endpoint: 'http', weight: 30 },
      ]),
    ).toEqual(steps);
  });

  it('walks every step to a version already on the Endpoint at 0%', () => {
    expect(
      walk([
        { componentName: 'trips-python', endpoint: 'http', weight: 100 },
        { componentName: 'trips-go', endpoint: 'http', weight: 0 },
      ]),
    ).toEqual(steps);
  });
});

describe('A/B audience on screen', () => {
  const ab = (audience?: object, mobileOnly?: boolean): EndpointRollout => ({
    strategy: 'abTest',
    stable: 'storefront',
    candidate: 'storefront-recs',
    steps: [100],
    preview: {
      kind: 'cookie',
      name: 'exp',
      value: 'b',
      ...(audience && { audience }),
      ...(mobileOnly && { mobileOnly }),
    } as EndpointRollout['preview'],
  });

  it('names who takes part and how to reach the variant', () => {
    expect(audienceText(ab().preview)).toBe('Everyone in the cookie group');
    expect(previewCommand(ab(), 'http://x')).toBe(
      "curl -H 'Cookie: exp=b' http://x",
    );
    const app = ab({ name: 'X-Client', value: 'ios', type: 'Exact' });
    expect(audienceText(app.preview)).toBe(
      'The cookie group, when X-Client is ios',
    );
    expect(previewCommand(app, 'http://x')).toBe(
      "curl -H 'Cookie: exp=b' -H 'X-Client: ios' http://x",
    );
    expect(previewCommand(ab(undefined, true), 'http://x')).toBe(
      "curl -H 'Cookie: exp=b' -A 'Mobile' http://x",
    );
  });
});
