import {
  audienceProblem,
  backendMatchProblems,
  buildABTest,
  buildBlueGreen,
  buildCanary,
  buildMirror,
  finishStrategy,
  MOBILE_USER_AGENT,
  reachUnsupported,
  strategyUnsupported,
  uniqueBackendName,
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

  it('adds a release line of a component as its own backend', () => {
    const line = { componentName: 'blue', endpoint: 'http', releaseLine: 'v2' };
    expect(buildCanary([backend('blue', 100)], line).backends).toEqual([
      backend('blue', 100),
      {
        name: 'blue-v2',
        componentName: 'blue',
        endpoint: 'http',
        releaseLine: 'v2',
        weight: 0,
      },
    ]);
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

describe('uniqueBackendName', () => {
  const stable = { name: 'test', componentName: 'test' };

  it('names a backend after its component and release line', () => {
    expect(
      uniqueBackendName([stable], {
        componentName: 'test',
        releaseLine: 'canary',
        endpoint: 'http',
      }),
    ).toBe('test-canary');
  });

  it('adds the endpoint, then a number, when the name is taken', () => {
    const line = {
      componentName: 'test',
      releaseLine: 'canary',
      endpoint: 'endpoint_1',
    };
    expect(uniqueBackendName([stable], line, ['test-canary'])).toBe(
      'test-canary-endpoint-1',
    );
    expect(
      uniqueBackendName([stable], line, [
        'test-canary',
        'test-canary-endpoint-1',
      ]),
    ).toBe('test-canary-endpoint-1-2');
    expect(
      uniqueBackendName([stable], { componentName: 'test', endpoint: 'grpc' }),
    ).toBe('test-grpc');
  });

  it('uses the name a candidate is given', () => {
    const change = buildCanary(
      [{ name: 'test', componentName: 'test', endpoint: 'http', weight: 100 }],
      {
        componentName: 'test',
        releaseLine: 'canary',
        endpoint: 'http',
        name: 'next',
      },
    );
    expect(change.backends.map(b => b.name)).toEqual(['test', 'next']);
  });
});

describe('strategyUnsupported', () => {
  it('offers every strategy when the type declares no capabilities', () => {
    for (const s of ['canary', 'blueGreen', 'abTest', 'mirror'] as const) {
      expect(strategyUnsupported(s, undefined)).toBeUndefined();
      expect(strategyUnsupported(s, [])).toBeUndefined();
    }
  });

  it('names what a Match-only type cannot do', () => {
    const caps = ['Match' as const];
    expect(strategyUnsupported('canary', caps)).toBeUndefined();
    expect(strategyUnsupported('blueGreen', caps)).toBeUndefined();
    expect(strategyUnsupported('abTest', caps)).toBeUndefined();
    expect(strategyUnsupported('mirror', caps, 'gamma-httproute')).toBe(
      "gamma-httproute can't mirror requests",
    );
  });

  it('needs a match for blue/green and A/B', () => {
    expect(strategyUnsupported('blueGreen', ['Mirror'])).toMatch(/testers/);
    expect(strategyUnsupported('abTest', ['Mirror'])).toMatch(/cookie/);
    expect(strategyUnsupported('canary', ['Mirror'])).toBeUndefined();
  });

  it('mirrors with Mirror alone, and a share of requests needs MirrorPercent', () => {
    expect(strategyUnsupported('mirror', ['Mirror'])).toBeUndefined();
    expect(reachUnsupported({ mirrorShares: [10, 100] }, ['Mirror'])).toMatch(
      /only copy every request/,
    );
    expect(
      reachUnsupported({ mirrorShares: [100] }, ['Mirror']),
    ).toBeUndefined();
    expect(
      reachUnsupported({ mirrorShares: [10, 100] }, [
        'Mirror',
        'MirrorPercent',
      ]),
    ).toBeUndefined();
  });
});

describe('reachUnsupported', () => {
  it('refuses a testers header without Match', () => {
    expect(reachUnsupported({ testersHeader: true }, ['Mirror'])).toMatch(
      /turn the header off/,
    );
    expect(
      reachUnsupported({ testersHeader: true }, ['Match']),
    ).toBeUndefined();
    expect(
      reachUnsupported({ testersHeader: true }, undefined),
    ).toBeUndefined();
  });

  it('refuses a regular expression audience without RegularExpression', () => {
    const audience = {
      name: 'user-agent',
      type: 'RegularExpression' as const,
      value: '.*Mobi.*',
    };
    expect(reachUnsupported({ audience }, ['Match'])).toMatch(/is exactly/);
    expect(
      reachUnsupported({ audience }, ['Match', 'RegularExpression']),
    ).toBeUndefined();
    expect(
      reachUnsupported({ audience: { ...audience, type: 'Exact' } }, ['Match']),
    ).toBeUndefined();
  });
});
