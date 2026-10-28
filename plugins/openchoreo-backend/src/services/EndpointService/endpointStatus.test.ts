import {
  applyBackends,
  applyWeights,
  deriveEndpointStatus,
  toBackendWeights,
  toOverrides,
  validateMatches,
} from './endpointStatus';

const binding = (
  ready?: { status: string; reason: string; message?: string },
  extra: Record<string, unknown> = {},
) =>
  ({
    metadata: { name: 'payments-api-development' },
    spec: {
      owner: { projectName: 'shop', endpointName: 'payments-api' },
      environment: 'development',
      endpointRelease: 'payments-api-abc',
    },
    status: {
      conditions: ready
        ? [
            {
              type: 'Ready',
              lastTransitionTime: '2026-10-12T00:00:00Z',
              ...ready,
            },
          ]
        : [],
    },
    ...extra,
  } as any);

describe('deriveEndpointStatus', () => {
  it('is NotRouted without a binding or a pinned release', () => {
    expect(deriveEndpointStatus(undefined).status).toBe('NotRouted');
    const unpinned = binding();
    delete unpinned.spec.endpointRelease;
    expect(deriveEndpointStatus(unpinned).status).toBe('NotRouted');
  });

  it('is Routing when Ready is True', () => {
    expect(
      deriveEndpointStatus(binding({ status: 'True', reason: 'RoutesReady' }))
        .status,
    ).toBe('Routing');
  });

  it('is Applying until the routes are accepted', () => {
    expect(deriveEndpointStatus(binding()).status).toBe('Applying');
    expect(
      deriveEndpointStatus(
        binding({ status: 'False', reason: 'RoutesProgressing' }),
      ).status,
    ).toBe('Applying');
  });

  it('keeps the controller message for unresolved backends', () => {
    const derived = deriveEndpointStatus(
      binding({
        status: 'False',
        reason: 'BackendsUnresolved',
        message: 'payments-v3 is not deployed in development',
      }),
    );
    expect(derived).toEqual({
      status: 'BackendsUnresolved',
      reason: 'BackendsUnresolved',
      message: 'payments-v3 is not deployed in development',
    });
  });

  it('treats any other not-ready reason as Failed', () => {
    expect(
      deriveEndpointStatus(
        binding({ status: 'False', reason: 'RenderingFailed', message: 'bad' }),
      ).status,
    ).toBe('Failed');
  });

  it('is Releasing while the binding is being deleted', () => {
    expect(
      deriveEndpointStatus(
        binding(
          { status: 'True', reason: 'RoutesReady' },
          {
            metadata: {
              name: 'payments-api-development',
              deletionTimestamp: '2026-10-12T00:00:00Z',
            },
          },
        ),
      ).status,
    ).toBe('Releasing');
  });
});

describe('toBackendWeights', () => {
  it('defaults a missing weight to 1, as the CRD does', () => {
    expect(
      toBackendWeights([
        {
          name: 'payments-v1',
          component: { name: 'payments-v1', endpoint: 'http' },
        },
      ] as any),
    ).toEqual([
      {
        componentName: 'payments-v1',
        endpoint: 'http',
        weight: 1,
        name: 'payments-v1',
      },
    ]);
  });
});

/** An API backendRef for a component's http endpoint. */
const ref = (component: string, weight: number) => ({
  name: component,
  kind: 'Component' as const,
  component: { name: component, endpoint: 'http' },
  weight,
});

describe('applyWeights', () => {
  const refs = [ref('payments-v1', 90), ref('payments-v2', 10)];

  it('changes only the named backends', () => {
    expect(
      applyWeights(refs, [
        { componentName: 'payments-v2', endpoint: 'http', weight: 50 },
      ]),
    ).toEqual([ref('payments-v1', 90), ref('payments-v2', 50)]);
  });

  it('rejects a backend the Endpoint does not have', () => {
    expect(() =>
      applyWeights(refs, [
        { componentName: 'payments-v3', endpoint: 'http', weight: 10 },
      ]),
    ).toThrow(/Unknown backends: payments-v3\/http/);
  });

  it('rejects weights outside the CRD range', () => {
    expect(() =>
      applyWeights(refs, [
        { componentName: 'payments-v1', endpoint: 'http', weight: -1 },
      ]),
    ).toThrow(/whole numbers/);
    expect(() =>
      applyWeights(refs, [
        { componentName: 'payments-v1', endpoint: 'http', weight: 1.5 },
      ]),
    ).toThrow(/whole numbers/);
  });

  it('rejects a split that sends no traffic anywhere', () => {
    expect(() =>
      applyWeights(refs, [
        { componentName: 'payments-v1', endpoint: 'http', weight: 0 },
        { componentName: 'payments-v2', endpoint: 'http', weight: 0 },
      ]),
    ).toThrow(/above 0/);
  });
});

describe('applyBackends', () => {
  const refs = [ref('payments-v1', 100), ref('payments-v2', 0)];

  it('adds a new backend after the existing ones', () => {
    expect(
      applyBackends(refs, [
        { componentName: 'payments-v1', endpoint: 'http', weight: 100 },
        { componentName: 'payments-v2', endpoint: 'http', weight: 0 },
        { componentName: 'payments-v3', endpoint: 'http', weight: 0 },
      ]),
    ).toEqual([...refs, ref('payments-v3', 0)]);
  });

  it('removes a backend at weight 0', () => {
    expect(
      applyBackends(refs, [
        { componentName: 'payments-v1', endpoint: 'http', weight: 100 },
      ]),
    ).toEqual([refs[0]]);
  });

  it('removes a backend that still has weight, as a version swap does', () => {
    expect(
      applyBackends(refs, [
        { componentName: 'payments-v2', endpoint: 'http', weight: 100 },
      ]),
    ).toEqual([{ ...refs[1], weight: 100 }]);
  });

  it('refuses duplicates and an all-zero split', () => {
    expect(() =>
      applyBackends(refs, [
        { componentName: 'payments-v1', endpoint: 'http', weight: 50 },
        { componentName: 'payments-v1', endpoint: 'http', weight: 50 },
      ]),
    ).toThrow(/listed twice/);
    expect(() =>
      applyBackends(refs, [
        { componentName: 'payments-v1', endpoint: 'http', weight: 0 },
        { componentName: 'payments-v2', endpoint: 'http', weight: 0 },
      ]),
    ).toThrow(/above 0/);
  });
});

describe('backend matches and mirrors', () => {
  const refs = [
    {
      name: 'blue',
      kind: 'Component' as const,
      component: { name: 'blue', endpoint: 'http' },
      weight: 100,
    },
    {
      name: 'green',
      kind: 'Component' as const,
      component: { name: 'green', endpoint: 'http' },
      weight: 0,
      match: {
        headers: [
          { name: 'x-preview', type: 'Exact' as const, value: 'green' },
        ],
      },
    },
  ];

  it('reads a match and a mirror into the wire shape', () => {
    expect(
      toBackendWeights([
        refs[1],
        { ...refs[0], name: 'shadow', mirror: { percent: 10 } },
      ]),
    ).toEqual([
      {
        name: 'green',
        componentName: 'green',
        endpoint: 'http',
        weight: 0,
        match: {
          headers: [{ name: 'x-preview', type: 'Exact', value: 'green' }],
        },
      },
      {
        name: 'shadow',
        componentName: 'blue',
        endpoint: 'http',
        weight: 100,
        mirror: { percent: 10 },
      },
    ]);
  });

  it('keeps a match on a Configure save, and replaces it when a strategy changes', () => {
    const backends = [
      { componentName: 'blue', endpoint: 'http', weight: 100 },
      { componentName: 'green', endpoint: 'http', weight: 0 },
    ];
    expect(applyBackends(refs, backends)[1].match).toEqual(refs[1].match);
    expect(
      applyBackends(refs, backends, { reach: true })[1],
    ).not.toHaveProperty('match');
    expect(
      applyBackends(
        refs,
        [backends[0], { ...backends[1], mirror: { percent: 5 } }],
        { reach: true },
      )[1],
    ).toMatchObject({ mirror: { percent: 5 } });
  });

  it('reads mirror overrides and refuses a bad match or mirror', () => {
    expect(
      toOverrides({
        metadata: { name: 'b' },
        spec: {
          owner: { projectName: 'shop', endpointName: 'payments-api' },
          environment: 'dev',
          backendOverrides: [
            { name: 'blue', weight: 0 },
            { name: 'shadow', mirror: { percent: 10 } },
          ],
        },
      } as any),
    ).toEqual([
      { name: 'blue', weight: 0 },
      { name: 'shadow', mirror: { percent: 10 } },
    ]);
    expect(() =>
      validateMatches([
        {
          componentName: 'green',
          endpoint: 'http',
          weight: 0,
          match: { path: { value: '/a/../b' } },
        },
      ]),
    ).toThrow(/green: path \/a\/..\/b must not contain/);
    expect(() =>
      validateMatches([
        {
          componentName: 'g',
          endpoint: 'http',
          weight: 5,
          mirror: { percent: 5 },
        },
      ]),
    ).toThrow(/a mirror backend needs weight 0 and no match/);
  });
});
