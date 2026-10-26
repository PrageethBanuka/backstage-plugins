import {
  buildABTest,
  buildBlueGreen,
  buildCanary,
  detectEndpointStrategy,
  endpointRuleProblems,
  finishStrategy,
} from './endpointRules';

const backend = (name: string, weight: number) => ({
  name,
  componentName: name,
  endpoint: 'http',
  weight,
});

describe('endpointRuleProblems', () => {
  const names = ['blue', 'green'];

  it('accepts a header rule followed by a catch-all', () => {
    expect(
      endpointRuleProblems(
        [
          {
            name: 'preview',
            matches: [{ headers: [{ name: 'x-preview', value: 'green' }] }],
            backends: [{ name: 'green' }],
          },
          { name: 'default', backends: [{ name: 'blue', weight: 100 }] },
        ],
        names,
      ),
    ).toEqual([]);
  });

  it('reports what the CRD would refuse', () => {
    expect(
      endpointRuleProblems(
        [
          { name: 'Everyone', backends: [{ name: 'blue' }] },
          {
            name: 'b',
            matches: [
              {
                cookies: [
                  { name: 'a', value: '1' },
                  { name: 'b', value: 'x y' },
                ],
              },
            ],
            backends: [{ name: 'purple', weight: 0 }],
            mirrors: [{ backend: 'green', percent: 0 }],
          },
        ],
        names,
      ),
    ).toEqual([
      'rule Everyone: name must be lowercase letters, digits and hyphens',
      'rule Everyone: only the last rule may have no matches',
      'rule b: unknown backend purple',
      'rule b: needs a backend with a weight above 0',
      'rule b: mirror percent must be 1 to 100',
      'rule b: at most one cookie per match',
      "rule b: cookie b=x y uses characters a cookie match can't",
    ]);
  });
});

describe('strategies', () => {
  const current = [backend('trips-python', 100)];
  const go = { componentName: 'trips-go', endpoint: 'http' };

  it('starts a canary at weight 0 with an optional testers rule', () => {
    const change = buildCanary(current, [], go, {
      name: 'x-canary',
      value: 'true',
    });
    expect(change.backends).toEqual([
      backend('trips-python', 100),
      backend('trips-go', 0),
    ]);
    expect(change.rules).toEqual([
      {
        name: 'canary-testers',
        matches: [
          { headers: [{ name: 'x-canary', value: 'true', type: 'Exact' }] },
        ],
        backends: [{ name: 'trips-go' }],
      },
    ]);
    expect(detectEndpointStrategy(change.backends, change.rules)).toEqual({
      kind: 'canary',
      stable: 'trips-python',
      canary: 'trips-go',
      testerRule: 'canary-testers',
    });
  });

  it('previews green behind a header and detects blue/green', () => {
    const change = buildBlueGreen(
      [backend('checkout-blue', 100)],
      [],
      { componentName: 'checkout-green', endpoint: 'http' },
      { name: 'x-preview', value: 'green' },
    );
    expect(detectEndpointStrategy(change.backends, change.rules)).toEqual({
      kind: 'blueGreen',
      blue: 'checkout-blue',
      green: 'checkout-green',
      previewRule: 'preview',
    });
  });

  it('routes a cookie group, optionally on phones only, and detects A/B', () => {
    const change = buildABTest(
      [backend('storefront', 100)],
      [],
      { componentName: 'storefront-recs', endpoint: 'http' },
      { name: 'exp_cartrecs', value: 'b' },
      true,
    );
    expect(change.rules[0].matches).toEqual([
      {
        cookies: [{ name: 'exp_cartrecs', value: 'b' }],
        headers: [
          { name: 'user-agent', type: 'RegularExpression', value: '.*Mobi.*' },
        ],
      },
    ]);
    expect(detectEndpointStrategy(change.backends, change.rules)).toEqual({
      kind: 'abTest',
      control: 'storefront',
      variant: 'storefront-recs',
      cookie: 'exp_cartrecs=b',
    });
  });

  it('keeps the Endpoint’s own rules, with its catch-all last', () => {
    const own = [
      {
        name: 'debug',
        matches: [{ queryParams: [{ name: 'debug', value: '1' }] }],
        backends: [{ name: 'trips-python' }],
      },
      { name: 'default', backends: [{ name: 'trips-python', weight: 1 }] },
    ];
    const change = buildCanary(current, own, go, {
      name: 'x-canary',
      value: 'true',
    });
    expect(change.rules.map(r => r.name)).toEqual([
      'canary-testers',
      'debug',
      'default',
    ]);
  });

  it('finishes with only the winner and without the strategy rules', () => {
    const started = buildBlueGreen(
      [backend('checkout-blue', 100)],
      [],
      { componentName: 'checkout-green', endpoint: 'http' },
      { name: 'x-preview', value: 'green' },
    );
    expect(
      finishStrategy(started.backends, started.rules, 'checkout-green'),
    ).toEqual({ backends: [backend('checkout-green', 100)], rules: [] });
  });

  it('sees no strategy with one backend', () => {
    expect(detectEndpointStrategy(current, [])).toEqual({ kind: 'none' });
  });
});
