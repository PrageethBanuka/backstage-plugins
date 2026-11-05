import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment, EndpointSummary } from './pdTypes';
import {
  audienceText,
  inRollout,
  previewCommand,
  servedSplit,
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
  backends: [
    { componentName: 'trips-python', endpoint: 'http', weight: 100 },
    { componentName: 'trips-go', endpoint: 'http', weight: 0 },
  ],
  rollout,
  rolloutSource: rollout ? 'plan' : 'none',
  environments: [],
});

const env = (
  name: string,
  percent: number | undefined,
  opts: Partial<EndpointEnvironment> = {},
): EndpointEnvironment => ({
  name,
  displayName: name,
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
  it('names the versions the rollout leaves alone', () => {
    expect(untouchedSummary(canary)).toBe('');
    const split: EndpointRollout = {
      ...canary,
      baseline: [
        { name: 'trips-python', weight: 70 },
        { name: 'trips-legacy', weight: 30 },
      ],
    };
    expect(untouchedSummary(split)).toBe('trips-legacy 30%');
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
