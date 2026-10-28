import {
  audienceProblem,
  backendMatchProblems,
  buildABTest,
  buildBlueGreen,
  buildCanary,
  buildMirror,
  detectEndpointStrategy,
  finishStrategy,
  MOBILE_USER_AGENT,
} from './endpointStrategies';

const backend = (name: string, weight: number) => ({
  name,
  componentName: name,
  endpoint: 'http',
  weight,
});

const green = { componentName: 'green', endpoint: 'http' };

describe('backendMatchProblems', () => {
  it('accepts a path, headers and one cookie', () => {
    expect(
      backendMatchProblems({
        path: { value: '/next' },
        headers: [MOBILE_USER_AGENT],
        cookies: [{ name: 'exp', value: 'b' }],
      }),
    ).toEqual([]);
  });

  it('reports what the CRD and the webhook would refuse', () => {
    expect(backendMatchProblems({})).toEqual([
      'a match needs a path, a header or a cookie',
    ]);
    expect(backendMatchProblems({ path: { value: 'next' } })).toEqual([
      'path next must start with / and have no ? or #',
    ]);
    expect(backendMatchProblems({ path: { value: '/a/../b' } })).toEqual([
      'path /a/../b must not contain //, . or ..',
    ]);
    expect(
      backendMatchProblems({
        headers: [
          { name: 'X-Client', value: 'ios' },
          { name: 'x-client', value: 'android' },
        ],
      }),
    ).toEqual(['header x-client is matched twice']);
    expect(
      backendMatchProblems({
        headers: [{ name: 'Cookie', value: 'a' }],
        cookies: [{ name: 'exp', value: 'b' }],
      }),
    ).toEqual([
      'match the cookie with cookies, or the Cookie header with headers, not both',
    ]);
    expect(
      backendMatchProblems({ cookies: [{ name: 'exp', value: 'b c' }] }),
    ).toEqual(["cookie exp=b c uses characters a cookie match can't"]);
  });
});

describe('strategy builders', () => {
  const blue = [backend('blue', 100)];

  it('adds a canary at weight 0, reachable by the testers header', () => {
    expect(
      buildCanary(blue, green, { name: 'x-canary', value: 'true' }).backends,
    ).toEqual([
      backend('blue', 100),
      {
        ...backend('green', 0),
        match: {
          headers: [{ name: 'x-canary', value: 'true', type: 'Exact' }],
        },
      },
    ]);
    expect(buildCanary(blue, green).backends[1]).toEqual(backend('green', 0));
  });

  it('previews blue/green by a header or a path', () => {
    expect(
      buildBlueGreen(blue, green, {
        header: { name: 'x-preview', value: 'green' },
      }).backends[1].match,
    ).toEqual({
      headers: [{ name: 'x-preview', value: 'green', type: 'Exact' }],
    });
    expect(
      buildBlueGreen(blue, green, { path: '/preview' }).backends[1].match,
    ).toEqual({ path: { type: 'PathPrefix', value: '/preview' } });
  });

  it('matches the A/B group on its cookie and the audience', () => {
    expect(
      buildABTest(
        blue,
        green,
        { name: 'exp', value: 'b' },
        { name: 'X-Client', value: 'ios' },
      ).backends[1].match,
    ).toEqual({
      cookies: [{ name: 'exp', value: 'b' }],
      headers: [{ name: 'X-Client', value: 'ios', type: 'Exact' }],
    });
  });

  it('adds a mirror at weight 0', () => {
    expect(buildMirror(blue, green, 10).backends[1]).toEqual({
      ...backend('green', 0),
      mirror: { percent: 10 },
    });
  });

  it("reuses a backend the Endpoint has, replacing an earlier rollout's match", () => {
    const left = [
      backend('blue', 100),
      { ...backend('green', 0), mirror: { percent: 100 } },
    ];
    expect(buildCanary(left, green).backends).toEqual([
      backend('blue', 100),
      backend('green', 0),
    ]);
  });
});

describe('detectEndpointStrategy', () => {
  it('reads the strategy from the weight-0 backend', () => {
    const blue = backend('blue', 100);
    expect(
      detectEndpointStrategy([
        blue,
        { ...backend('green', 0), mirror: { percent: 5 } },
      ]),
    ).toEqual({ kind: 'mirror', stable: 'blue', shadow: 'green' });
    expect(
      detectEndpointStrategy([
        blue,
        {
          ...backend('green', 0),
          match: { cookies: [{ name: 'exp', value: 'b' }] },
        },
      ]),
    ).toEqual({
      kind: 'abTest',
      control: 'blue',
      variant: 'green',
      cookie: 'exp=b',
    });
    expect(
      detectEndpointStrategy([
        blue,
        { ...backend('green', 0), match: { path: { value: '/next' } } },
      ]),
    ).toEqual({ kind: 'canary', stable: 'blue', canary: 'green' });
  });

  it('reads a split set by hand as no rollout', () => {
    expect(
      detectEndpointStrategy([backend('blue', 70), backend('green', 30)]),
    ).toEqual({ kind: 'none' });
    expect(detectEndpointStrategy([backend('blue', 100)])).toEqual({
      kind: 'none',
    });
  });
});

describe('finishStrategy', () => {
  it('keeps the named backends as plain weighted backends', () => {
    const backends = [
      backend('blue', 100),
      {
        ...backend('green', 0),
        match: { headers: [{ name: 'x-preview', value: 'green' }] },
      },
    ];
    expect(finishStrategy(backends, 'green').backends).toEqual([
      backend('green', 100),
    ]);
    expect(
      finishStrategy(backends, [{ name: 'blue', weight: 100 }]).backends,
    ).toEqual([backend('blue', 100)]);
  });
});

describe('audienceProblem', () => {
  it('accepts the phone User-Agent and refuses a bad header', () => {
    expect(audienceProblem(MOBILE_USER_AGENT)).toBeUndefined();
    expect(audienceProblem({ name: 'bad header', value: 'x' })).toMatch(
      /valid HTTP header name/,
    );
    expect(
      audienceProblem({ name: 'ua', type: 'RegularExpression', value: '(' }),
    ).toMatch(/not a valid regular expression/);
  });
});
