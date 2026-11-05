import { mockServices } from '@backstage/backend-test-utils';
import { createOkResponse } from '@openchoreo/test-utils';
import { EndpointRolloutService } from './EndpointRolloutService';

const mockGET = jest.fn();
const mockPOST = jest.fn();
const mockPUT = jest.fn();

jest.mock('@openchoreo/openchoreo-client-node', () => ({
  ...jest.requireActual('@openchoreo/openchoreo-client-node'),
  createOpenChoreoApiClient: jest.fn(() => ({
    GET: mockGET,
    POST: mockPOST,
    PUT: mockPUT,
  })),
  fetchAllPages: jest.fn((fetchPage: (cursor?: string) => Promise<any>) =>
    fetchPage(undefined).then((page: any) => page.items),
  ),
}));

const NS = '/api/v1/namespaces/{namespaceName}';

const list = (items: unknown[]) => createOkResponse({ items, pagination: {} });

const backendRef = (name: string, weight: number, extra = {}) => ({
  name,
  kind: 'Component',
  component: { name, endpoint: 'http' },
  weight,
  ...extra,
});

const endpoint = (
  refs: unknown[],
  latest = 'payments-api-aaa',
  rollout?: unknown,
) => ({
  metadata: { name: 'payments-api', namespace: 'default' },
  spec: {
    owner: { projectName: 'shop' },
    type: { kind: 'ClusterEndpointType', name: 'http' },
    backendRefs: refs,
    ...(rollout ? { rollout } : {}),
  },
  status: { latestRelease: { name: latest } },
});

const binding = (
  environment: string,
  backends: Array<{ name: string; weight: number }> = [
    { name: 'payments-v1', weight: 100 },
    { name: 'payments-v2', weight: 0 },
  ],
  conditions: Array<{ type: string; status: string }> = [],
) => ({
  metadata: { name: `payments-api-${environment}` },
  spec: {
    owner: { projectName: 'shop', endpointName: 'payments-api' },
    environment,
    endpointRelease: 'payments-api-aaa',
  },
  status: {
    conditions,
    backends: backends.map(b => ({ ...b, kind: 'Component', resolved: true })),
  },
});

function routeGET(routes: Record<string, (opts: any) => unknown>) {
  mockGET.mockImplementation((path: string, opts: any) => {
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected GET ${path}`);
    return Promise.resolve(handler(opts));
  });
}

const steps = (name: string, percents: number[]) => ({
  steps: percents.map(percent => ({ backends: [{ name, percent }] })),
});

const canary = {
  strategy: 'canary',
  stable: 'payments-v1',
  candidates: [{ name: 'payments-v2' }],
  canary: steps('payments-v2', [5, 25, 50, 100]),
};

const stages = [0, 5, 25, 50, 100].map((percent, index) => ({
  index,
  backends: [{ name: 'payments-v2', percent }],
}));

const rolloutStatus = (
  step?: number,
  percent = 0,
  overrides: Array<{ name: string; weight: number }> = [],
) =>
  createOkResponse({
    endpoint: 'payments-api',
    rollout: canary,
    stages,
    environments: [
      {
        environment: 'development',
        bindingName: 'payments-api-development',
        overrides,
        backends: [],
        ready: true,
        ...(step !== undefined && {
          step,
          percents: { 'payments-v2': percent },
        }),
      },
    ],
  });

const ROLLOUT = `${NS}/endpoints/{endpointName}/rollout`;
const BINDING = `${NS}/endpointreleasebindings/{endpointReleaseBindingName}`;

describe('EndpointRolloutService', () => {
  let service: EndpointRolloutService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EndpointRolloutService(
      mockServices.logger.mock(),
      'http://api',
    );
  });

  describe('updateEndpointOverrides', () => {
    it("sets the environment binding's weights and waits until they apply", async () => {
      const applied = binding(
        'development',
        [
          { name: 'payments-v1', weight: 50 },
          { name: 'payments-v2', weight: 50 },
        ],
        [{ type: 'ResourcesReady', status: 'True' }],
      );
      let reads = 0;
      routeGET({
        [`${NS}/endpointreleasebindings`]: () =>
          list([binding('production'), binding('development')]),
        [BINDING]: () =>
          createOkResponse(reads++ === 0 ? binding('development') : applied),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await service.updateEndpointOverrides(
        {
          namespaceName: 'default',
          endpointName: 'payments-api',
          environment: 'development',
          overrides: [
            { name: 'payments-v1', weight: 50 },
            { name: 'payments-v2', weight: 50 },
          ],
        },
        'token',
      );

      expect(result).toEqual({
        bindingName: 'payments-api-development',
        applied: true,
      });
      const [path, opts] = mockPUT.mock.calls[0];
      expect(path).toBe(
        `${NS}/endpointreleasebindings/{endpointReleaseBindingName}`,
      );
      expect(opts.params.path.endpointReleaseBindingName).toBe(
        'payments-api-development',
      );
      expect(opts.body.spec.backendOverrides).toEqual([
        { name: 'payments-v1', weight: 50 },
        { name: 'payments-v2', weight: 50 },
      ]);
      expect(opts.body.spec.endpointRelease).toBe('payments-api-aaa');
      const lists = mockGET.mock.calls.filter(
        ([p]) => p === `${NS}/endpointreleasebindings`,
      );
      expect(lists).toHaveLength(1);
      expect(
        mockGET.mock.calls
          .filter(([p]) => p === BINDING)
          .every(
            ([, o]) =>
              o.params.path.endpointReleaseBindingName ===
              'payments-api-development',
          ),
      ).toBe(true);
    });

    it('fails clearly when the Endpoint is not deployed in the environment', async () => {
      routeGET({ [`${NS}/endpointreleasebindings`]: () => list([]) });
      await expect(
        service.updateEndpointOverrides(
          {
            namespaceName: 'default',
            endpointName: 'payments-api',
            environment: 'production',
            overrides: [],
          },
          'token',
        ),
      ).rejects.toThrow(/not deployed in production/);
    });
  });

  describe('fetchEndpointRollout', () => {
    it('returns the backends, the plan and where each environment stands', async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint(
              [
                backendRef('payments-v1', 100),
                backendRef('payments-v2', 0, {
                  match: { headers: [{ name: 'x-canary', value: 'true' }] },
                }),
              ],
              'payments-api-aaa',
              canary,
            ),
          ),
        [ROLLOUT]: () => rolloutStatus(2, 25),
        [`${NS}/endpointreleasebindings`]: () =>
          list([
            {
              ...binding('development'),
              spec: {
                ...binding('development').spec,
                backendOverrides: [
                  { name: 'payments-v1', weight: 75 },
                  { name: 'payments-v2', weight: 25 },
                ],
              },
            },
          ]),
      });

      const info = await service.fetchEndpointRollout(
        'default',
        'payments-api',
        'token',
      );

      expect(info.rolloutSource).toBe('plan');
      expect(info.rollout).toMatchObject({
        stable: 'payments-v1',
        candidate: 'payments-v2',
        steps: [5, 25, 50, 100],
        preview: { kind: 'header', name: 'x-canary', value: 'true' },
      });
      expect(info.environments).toEqual([
        expect.objectContaining({
          environment: 'development',
          overrides: [
            { name: 'payments-v1', weight: 75 },
            { name: 'payments-v2', weight: 25 },
          ],
          rollout: { index: 2, percent: 25, manual: false },
        }),
      ]);
    });

    it("gives the type's capabilities, and none when it can't be read", async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint([backendRef('payments-v1', 100)])),
        [ROLLOUT]: () => rolloutStatus(),
        [`${NS}/endpointreleasebindings`]: () => list([binding('development')]),
        '/api/v1/clusterendpointtypes/{cetName}': () =>
          createOkResponse({ spec: { capabilities: ['Match'] } }),
      });
      const info = await service.fetchEndpointRollout(
        'default',
        'payments-api',
      );
      expect(info.typeName).toBe('http');
      expect(info.capabilities).toEqual(['Match']);

      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint([backendRef('payments-v1', 100)])),
        [ROLLOUT]: () => rolloutStatus(),
        [`${NS}/endpointreleasebindings`]: () => list([binding('development')]),
        '/api/v1/clusterendpointtypes/{cetName}': () => ({
          data: undefined,
          error: { message: 'forbidden' },
          response: { ok: false, status: 403 },
        }),
      });
      const denied = await service.fetchEndpointRollout(
        'default',
        'payments-api',
      );
      expect(denied.capabilities).toBeUndefined();
    });

    it('reads an A/B test shipped to everyone as its last stage, not weights set by hand', async () => {
      const ab = {
        strategy: 'abTest',
        stable: 'payments-v1',
        candidates: [{ name: 'payments-v2' }],
      };
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint(
              [
                backendRef('payments-v1', 0),
                backendRef('payments-v2', 100, {
                  match: { cookies: [{ name: 'exp', value: 'b' }] },
                }),
              ],
              'payments-api-aaa',
              ab,
            ),
          ),
        [ROLLOUT]: () =>
          createOkResponse({
            endpoint: 'payments-api',
            rollout: ab,
            stages: [
              { index: 0, backends: [{ name: 'payments-v2', percent: 0 }] },
            ],
            environments: [
              {
                environment: 'development',
                bindingName: 'payments-api-development',
                overrides: [],
                backends: [],
                ready: true,
                step: -1,
                percents: { 'payments-v2': 100 },
              },
            ],
          }),
        [`${NS}/endpointreleasebindings`]: () => list([binding('development')]),
      });

      const info = await service.fetchEndpointRollout(
        'default',
        'payments-api',
      );
      expect(info.environments[0].rollout).toEqual({
        index: 1,
        percent: 100,
        manual: false,
      });
    });

    it('has no plan when spec.rollout is unset', async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint([backendRef('payments-v1', 100)])),
        [ROLLOUT]: () => rolloutStatus(),
        [`${NS}/endpointreleasebindings`]: () => list([binding('development')]),
      });

      const info = await service.fetchEndpointRollout(
        'default',
        'payments-api',
      );

      expect(info.rolloutSource).toBe('none');
      expect(info.rollout).toBeUndefined();
      expect(info.environments[0].rollout).toBeUndefined();
    });
  });

  describe('unused overrides', () => {
    const withOverrides = (environment: string, names: string[]) => {
      const b = binding(environment);
      (b.spec as any).backendOverrides = names.map(name => ({
        name,
        weight: 100,
      }));
      return b;
    };
    const routeRelease = (
      bindings: unknown[],
      refs = [backendRef('payments-v1', 1)],
      rollout: unknown = canary,
    ) =>
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint(refs, 'payments-api-aaa', rollout)),
        [`${NS}/endpointreleasebindings`]: () => list(bindings),
        [`${NS}/endpointreleases/{endpointReleaseName}`]: () =>
          createOkResponse({
            metadata: { name: 'payments-api-aaa' },
            spec: { backendRefs: refs },
          }),
      });
    const scaled = (environment: string, weights: Record<string, number>) => {
      const b = binding(environment);
      (b.spec as any).backendOverrides = Object.entries(weights).map(
        ([name, weight]) => ({ name, weight }),
      );
      return b;
    };
    const shares = [
      backendRef('payments-v1', 40),
      backendRef('payments-v2', 20),
    ];

    it("drops a finished rollout's scaled weights that keep the release's shares", async () => {
      routeRelease(
        [scaled('development', { 'payments-v1': 4000, 'payments-v2': 2000 })],
        shares,
        null,
      );
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.dropUnusedOverrides('default', 'payments-api', 'token');

      expect(mockPUT.mock.calls[0][1].body.spec.backendOverrides).toEqual([]);
    });

    it('keeps weights that change the shares, or that a running rollout set', async () => {
      routeRelease(
        [scaled('development', { 'payments-v1': 80, 'payments-v2': 20 })],
        shares,
        null,
      );
      await service.dropUnusedOverrides('default', 'payments-api', 'token');

      routeRelease(
        [scaled('development', { 'payments-v1': 4000, 'payments-v2': 2000 })],
        shares,
      );
      await service.dropUnusedOverrides('default', 'payments-api', 'token');

      expect(mockPUT).not.toHaveBeenCalled();
    });

    it("drops overrides naming a backend the binding's release doesn't have", async () => {
      routeRelease([
        withOverrides('development', ['payments-v1', 'payments-gone']),
        withOverrides('staging', ['payments-v1']),
      ]);
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.dropUnusedOverrides('default', 'payments-api', 'token');

      expect(mockPUT).toHaveBeenCalledTimes(1);
      expect(mockPUT.mock.calls[0][1].params.path).toEqual({
        namespaceName: 'default',
        endpointReleaseBindingName: 'payments-api-development',
      });
      expect(mockPUT.mock.calls[0][1].body.spec.backendOverrides).toEqual([
        { name: 'payments-v1', weight: 100 },
      ]);
    });

    it('goes on to the next binding when one cannot be saved', async () => {
      routeRelease([
        withOverrides('development', ['payments-gone']),
        withOverrides('staging', ['payments-gone']),
      ]);
      mockPUT
        .mockRejectedValueOnce(new Error('conflict'))
        .mockResolvedValue(createOkResponse({}));

      await service.dropUnusedOverrides('default', 'payments-api', 'token');

      expect(mockPUT).toHaveBeenCalledTimes(2);
      expect(mockPUT.mock.calls[1][1].body.spec.backendOverrides).toEqual([]);
    });

    it('cleans up again once autoDeploy has pinned the new release', async () => {
      jest.useFakeTimers();
      try {
        const drop = jest
          .spyOn(service, 'dropUnusedOverrides')
          .mockResolvedValue();

        service.dropUnusedOverridesLater('default', 'payments-api', 'token');
        expect(drop).not.toHaveBeenCalled();
        await jest.runAllTimersAsync();

        expect(drop).toHaveBeenCalledTimes(2);
        expect(drop).toHaveBeenCalledWith('default', 'payments-api', 'token');
      } finally {
        jest.useRealTimers();
      }
    });

    it("hides them from an environment's traffic", async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint([backendRef('payments-v1', 1)])),
        [ROLLOUT]: () => rolloutStatus(),
        [`${NS}/endpointreleasebindings`]: () =>
          list([
            withOverrides('development', ['payments-v1', 'payments-gone']),
          ]),
      });

      const info = await service.fetchEndpointRollout(
        'default',
        'payments-api',
        'token',
      );

      expect(info.environments[0].overrides).toEqual([
        { name: 'payments-v1', weight: 100 },
      ]);
    });
  });

  describe('rollouts', () => {
    const routeRollout = (step = 0, percent = 0) =>
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint(
              [backendRef('payments-v1', 100), backendRef('payments-v2', 0)],
              'payments-api-aaa',
              canary,
            ),
          ),
        [ROLLOUT]: () => rolloutStatus(step, percent),
        [`${NS}/endpointreleasebindings`]: () =>
          list([
            binding('development', undefined, [
              { type: 'ResourcesReady', status: 'True' },
            ]),
          ]),
        [BINDING]: () =>
          createOkResponse(
            binding('development', undefined, [
              { type: 'ResourcesReady', status: 'True' },
            ]),
          ),
      });

    it('starts a canary through openchoreo-api with the candidate at 0%', async () => {
      let reads = 0;
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint(
              [backendRef('payments', 1)],
              reads++ === 0 ? 'payments-api-aaa' : 'payments-api-bbb',
            ),
          ),
      });
      mockPOST.mockResolvedValue(createOkResponse({}));

      const result = await service.startRollout(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          plan: {
            strategy: 'canary',
            candidate: {
              componentName: 'payments',
              endpoint: 'http',
              releaseLine: 'v2',
            },
            steps: [10, 50],
            preview: { kind: 'header', name: 'x-canary', value: 'true' },
          },
        },
        'token',
      );

      expect(result).toEqual({
        latestRelease: 'payments-api-bbb',
        environments: [],
      });
      expect(mockPUT).not.toHaveBeenCalled();
      expect(mockPOST).toHaveBeenCalledWith(`${ROLLOUT}/start`, {
        params: {
          path: { namespaceName: 'default', endpointName: 'payments-api' },
        },
        body: {
          rollout: {
            strategy: 'canary',
            stable: 'payments',
            candidates: [{ name: 'payments-v2' }],
            canary: steps('payments-v2', [10, 50, 100]),
          },
          backends: [
            backendRef('payments', 1),
            {
              name: 'payments-v2',
              kind: 'Component',
              component: {
                name: 'payments',
                endpoint: 'http',
                releaseLine: 'v2',
              },
              weight: 0,
              match: {
                headers: [{ name: 'x-canary', type: 'Exact', value: 'true' }],
              },
            },
          ],
        },
      });
    });

    const startOn = async (candidate: {
      componentName: string;
      releaseLine?: string;
    }) => {
      const owned = endpoint([backendRef('payments', 1)], 'payments-api-aaa');
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse({
            ...owned,
            metadata: {
              ...owned.metadata,
              labels: {
                'openchoreo.dev/source-component': 'payments',
                'openchoreo.dev/source-endpoint': 'http',
                team: 'shop',
              },
            },
          }),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));
      mockPOST.mockResolvedValue(createOkResponse({}));
      jest.useFakeTimers();
      const done = service.startRollout(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          plan: {
            strategy: 'canary',
            candidate: { endpoint: 'http', ...candidate },
          },
        },
        'token',
      );
      await jest.runAllTimersAsync();
      await done;
      jest.useRealTimers();
      return mockPUT.mock.calls[0]?.[1].body.metadata.labels;
    };

    it("keeps a component's Endpoint with the component for a canary on its release line", async () => {
      expect(
        await startOn({ componentName: 'payments', releaseLine: 'v2' }),
      ).toBeUndefined();
    });

    it("moves a component's Endpoint to its project for a canary on another component", async () => {
      expect(await startOn({ componentName: 'payments-go' })).toEqual({
        team: 'shop',
      });
    });

    const addBackend = (backend: {
      componentName: string;
      endpoint: string;
      name?: string;
      weight: number;
    }) =>
      service.addBackend(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          backend,
        },
        'token',
      );

    it('adds a backend that gets its weight right away', async () => {
      let reads = 0;
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint(
              [backendRef('payments', 1)],
              reads++ === 0 ? 'payments-api-aaa' : 'payments-api-bbb',
            ),
          ),
        [`${NS}/endpointreleasebindings`]: () => list([]),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await addBackend({
        componentName: 'payments-go',
        endpoint: 'http',
        name: 'payments-go',
        weight: 3,
      });

      expect(result.latestRelease).toBe('payments-api-bbb');
      expect(mockPOST).not.toHaveBeenCalled();
      expect(mockPUT.mock.calls[0][1].body.spec.backendRefs).toEqual([
        backendRef('payments', 1),
        expect.objectContaining({
          name: 'payments-go',
          component: { name: 'payments-go', endpoint: 'http' },
          weight: 3,
        }),
      ]);
    });

    const routePlain = (refs: unknown[]) => {
      let reads = 0;
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint(
              refs,
              reads++ === 0 ? 'payments-api-aaa' : 'payments-api-bbb',
            ),
          ),
        [`${NS}/endpointreleasebindings`]: () => list([]),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));
    };
    const savedWeights = () =>
      mockPUT.mock.calls[0][1].body.spec.backendRefs.map(
        (r: { name: string; weight: number }) => [r.name, r.weight],
      );

    it('adds a backend with a share, the others keeping their ratio', async () => {
      routePlain([backendRef('payments', 1), backendRef('payments-eu', 3)]);

      await service.addBackend(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          backend: {
            componentName: 'payments-go',
            endpoint: 'http',
            weight: 20,
          },
          share: 20,
        },
        'token',
      );

      expect(savedWeights()).toEqual([
        ['payments', 20],
        ['payments-eu', 60],
        ['payments-go', 20],
      ]);
    });

    describe('setBackendShare', () => {
      const setShare = (backendName: string, percent: number) =>
        service.setBackendShare(
          {
            namespaceName: 'default',
            projectName: 'shop',
            endpointName: 'payments-api',
            backendName,
            percent,
          },
          'token',
        );

      it('gives the backend its share and keeps the others in their ratio', async () => {
        routePlain([
          backendRef('payments', 1),
          backendRef('payments-eu', 1),
          backendRef('payments-beta', 0, {
            match: { headers: [{ name: 'x-beta', value: 'true' }] },
          }),
        ]);

        await setShare('payments-eu', 30);

        expect(savedWeights()).toEqual([
          ['payments', 70],
          ['payments-eu', 30],
          ['payments-beta', 0],
        ]);
      });

      it('refuses a backend reached by its match', async () => {
        routePlain([
          backendRef('payments', 1),
          backendRef('payments-beta', 0, {
            match: { headers: [{ name: 'x-beta', value: 'true' }] },
          }),
        ]);

        await expect(setShare('payments-beta', 30)).rejects.toThrow(
          'payments-beta gets the requests its match selects, not a share',
        );
        expect(mockPUT).not.toHaveBeenCalled();
      });

      it('refuses to leave no backend with a share', async () => {
        routePlain([backendRef('payments', 1)]);

        await expect(setShare('payments', 0)).rejects.toThrow(
          'At least one backend needs a share',
        );
      });

      it('refuses a backend the Endpoint does not have', async () => {
        routePlain([backendRef('payments', 1)]);

        await expect(setShare('payments-gone', 50)).rejects.toThrow(
          'payments-api has no backend payments-gone',
        );
      });

      it('refuses while a rollout runs', async () => {
        routeRollout();

        await expect(setShare('payments-v1', 50)).rejects.toThrow(
          'has a rollout running',
        );
      });
    });

    it('refuses a backend while a rollout runs', async () => {
      routeRollout();

      await expect(
        addBackend({
          componentName: 'payments-go',
          endpoint: 'http',
          weight: 1,
        }),
      ).rejects.toThrow('has a rollout running');
      expect(mockPUT).not.toHaveBeenCalled();
    });

    it('steps an environment through openchoreo-api to the stage of the share', async () => {
      routeRollout(1, 5);
      mockPOST.mockResolvedValue(
        createOkResponse({
          endpoint: 'payments-api',
          environments: [
            {
              environment: 'development',
              bindingName: 'payments-api-development',
            },
          ],
          change: { after: [] },
        }),
      );

      const result = await service.setRolloutStage(
        {
          namespaceName: 'default',
          endpointName: 'payments-api',
          environment: 'development',
          percent: 25,
        },
        'token',
      );

      expect(result).toEqual({
        bindingName: 'payments-api-development',
        applied: true,
      });
      expect(mockPOST).toHaveBeenCalledWith(`${ROLLOUT}/step`, {
        params: {
          path: { namespaceName: 'default', endpointName: 'payments-api' },
        },
        body: { environment: 'development', to: 2 },
      });
    });

    it('sets a share that is no step of the plan as weights on the binding', async () => {
      routeRollout();
      mockPUT.mockResolvedValue(createOkResponse({}));

      jest.useFakeTimers();
      const done = service.setRolloutStage(
        {
          namespaceName: 'default',
          endpointName: 'payments-api',
          environment: 'development',
          percent: 10,
        },
        'token',
      );
      await jest.runAllTimersAsync();
      expect((await done).applied).toBe(false);
      jest.useRealTimers();

      expect(mockPOST).not.toHaveBeenCalled();
      expect(mockPUT.mock.calls[0][1].body.spec.backendOverrides).toEqual([
        { name: 'payments-v1', weight: 90 },
        { name: 'payments-v2', weight: 10 },
      ]);
    });

    it('refuses a share when the environment gives the rollout no traffic', async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint(
              [
                backendRef('payments-v1', 100),
                backendRef('payments-legacy', 0),
                backendRef('payments-v2', 0),
              ],
              'payments-api-aaa',
              canary,
            ),
          ),
        [ROLLOUT]: () =>
          rolloutStatus(0, 0, [
            { name: 'payments-v1', weight: 0 },
            { name: 'payments-legacy', weight: 100 },
          ]),
      });

      await expect(
        service.setRolloutStage(
          {
            namespaceName: 'default',
            endpointName: 'payments-api',
            environment: 'development',
            percent: 10,
          },
          'token',
        ),
      ).rejects.toThrow(
        /in development, stable and the candidates get no traffic/,
      );
      expect(mockPUT).not.toHaveBeenCalled();
      expect(mockPOST).not.toHaveBeenCalled();
    });

    it.each([
      ['complete', 'payments-v2'],
      ['abandon', 'payments-v1'],
    ] as const)(
      'finishes (%s) through openchoreo-api keeping %s',
      async (outcome, keep) => {
        routeRollout();
        mockPOST.mockResolvedValue(createOkResponse({}));
        jest.useFakeTimers();
        const done = service.finishRollout(
          {
            namespaceName: 'default',
            projectName: 'shop',
            endpointName: 'payments-api',
            outcome,
          },
          'token',
        );
        await jest.runAllTimersAsync();
        await done;
        jest.useRealTimers();

        expect(mockPOST).toHaveBeenCalledWith(`${ROLLOUT}/finish`, {
          params: {
            path: { namespaceName: 'default', endpointName: 'payments-api' },
          },
          body: { keep },
        });
      },
    );

    it("passes on openchoreo-api's refusal", async () => {
      routeRollout();
      mockPOST.mockResolvedValue({
        error: {
          error:
            'payments-v1 in development still gets traffic; move it to 0% there first',
        },
        response: new Response(null, { status: 409 }),
      });

      await expect(
        service.finishRollout(
          {
            namespaceName: 'default',
            projectName: 'shop',
            endpointName: 'payments-api',
            outcome: 'complete',
          },
          'token',
        ),
      ).rejects.toThrow(/still gets traffic/);
    });

    it('edits only spec.rollout when only the steps change', async () => {
      routeRollout();
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await service.updateRolloutSettings(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          settings: { steps: [10, 50] },
        },
        'token',
      );

      expect(result).toEqual({ environments: [] });
      const body = mockPUT.mock.calls[0][1].body;
      expect(body.spec.backendRefs.map((r: any) => r.match)).toEqual([
        undefined,
        undefined,
      ]);
      expect(body.spec.rollout.canary).toEqual(
        steps('payments-v2', [10, 50, 100]),
      );
    });

    it('cuts a release for a new testers header', async () => {
      let reads = 0;
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint(
              [backendRef('payments-v1', 100), backendRef('payments-v2', 0)],
              reads++ === 0 ? 'payments-api-aaa' : 'payments-api-bbb',
              canary,
            ),
          ),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await service.updateRolloutSettings(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          settings: {
            steps: [5, 25, 50, 100],
            preview: { kind: 'header', name: 'x-beta', value: 'yes' },
          },
        },
        'token',
      );

      expect(result).toEqual({
        latestRelease: 'payments-api-bbb',
        environments: [],
      });
      expect(mockPUT.mock.calls[0][1].body.spec.backendRefs[1].match).toEqual({
        headers: [{ name: 'x-beta', type: 'Exact', value: 'yes' }],
      });
    });

    const rolling = () =>
      createOkResponse(
        endpoint(
          [backendRef('payments-v1', 1), backendRef('payments-v2', 0)],
          'payments-api-aaa',
          canary,
        ),
      );

    it('drops every override when no rollout runs', async () => {
      const live = binding('development');
      (live.spec as any).backendOverrides = [
        { name: 'payments-v1', weight: 80 },
        { name: 'payments-v2', weight: 20 },
      ];
      routeGET({
        [`${NS}/endpointreleases/{endpointReleaseName}`]: () =>
          createOkResponse({
            metadata: { name: 'payments-api-aaa' },
            spec: {
              backendRefs: [
                backendRef('payments-v1', 1),
                backendRef('payments-v2', 1),
              ],
            },
          }),
        [`${NS}/endpointreleasebindings`]: () => list([live]),
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            endpoint([
              backendRef('payments-v1', 1),
              backendRef('payments-v2', 1),
            ]),
          ),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.deployRelease(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          environment: 'development',
          releaseName: 'payments-api-aaa',
        },
        'token',
      );

      expect(mockPUT.mock.calls[0][1].body.spec.backendOverrides).toEqual([]);
    });

    it('keeps a running rollout when the release drops another backend', async () => {
      const live = binding('development');
      (live.spec as any).backendOverrides = [
        { name: 'payments-v1', weight: 75 },
        { name: 'payments-v2', weight: 25 },
        { name: 'payments-eu', weight: 100 },
      ];
      const releases: Record<string, unknown[]> = {
        'payments-api-aaa': [
          backendRef('payments-v1', 1),
          backendRef('payments-v2', 0),
          backendRef('payments-eu', 1),
        ],
        'payments-api-ccc': [
          backendRef('payments-v1', 1),
          backendRef('payments-v2', 0),
        ],
      };
      routeGET({
        [`${NS}/endpointreleases/{endpointReleaseName}`]: opts => {
          const name = opts.params.path.endpointReleaseName;
          return createOkResponse({
            metadata: { name },
            spec: { backendRefs: releases[name] },
          });
        },
        [`${NS}/endpointreleasebindings`]: () => list([live]),
        [`${NS}/endpoints/{endpointName}`]: rolling,
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.deployRelease(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          environment: 'development',
          releaseName: 'payments-api-ccc',
        },
        'token',
      );

      expect(mockPUT.mock.calls[0][1].body.spec.backendOverrides).toEqual([
        { name: 'payments-v1', weight: 75 },
        { name: 'payments-v2', weight: 25 },
      ]);
    });

    it("lets the release's weights apply when the overrides left would route nothing", async () => {
      const live = binding('production');
      (live.spec as any).backendOverrides = [
        { name: 'payments-v1', weight: 100 },
        { name: 'payments-v2', weight: 0 },
      ];
      routeGET({
        [`${NS}/endpointreleases/{endpointReleaseName}`]: () =>
          createOkResponse({
            metadata: { name: 'payments-api-ccc' },
            spec: { backendRefs: [backendRef('payments-v2', 1)] },
          }),
        [`${NS}/endpointreleasebindings`]: () => list([live]),
        [`${NS}/endpoints/{endpointName}`]: rolling,
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await service.deployRelease(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          environment: 'production',
          releaseName: 'payments-api-ccc',
        },
        'token',
      );

      expect(result.environments).toEqual([{ name: 'production', ok: true }]);
      expect(mockPUT.mock.calls[0][1].body.spec).toMatchObject({
        endpointRelease: 'payments-api-ccc',
        backendOverrides: [],
      });
    });

    it("drops a removed backend's override before the backend is added again", async () => {
      const live = binding('development');
      (live.spec as any).backendOverrides = [
        { name: 'payments-v1', weight: 3 },
        { name: 'payments-v2', weight: 0 },
      ];
      const releases: Record<string, unknown[]> = {
        'payments-api-aaa': [backendRef('payments-v1', 1)],
        'payments-api-ccc': [
          backendRef('payments-v1', 1),
          backendRef('payments-v2', 1),
        ],
      };
      routeGET({
        [`${NS}/endpointreleases/{endpointReleaseName}`]: opts => {
          const name = opts.params.path.endpointReleaseName;
          return createOkResponse({
            metadata: { name },
            spec: { backendRefs: releases[name] },
          });
        },
        [`${NS}/endpointreleasebindings`]: () => list([live]),
        [`${NS}/endpoints/{endpointName}`]: rolling,
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.deployRelease(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          environment: 'development',
          releaseName: 'payments-api-ccc',
        },
        'token',
      );

      expect(mockPUT.mock.calls[0][1].body.spec.backendOverrides).toEqual([
        { name: 'payments-v1', weight: 3 },
      ]);
    });

    it('resets weights that would leave every backend at 0', async () => {
      const live = binding('development');
      (live.spec as any).backendOverrides = [
        { name: 'payments-v1', weight: 0 },
      ];
      routeGET({
        [`${NS}/endpointreleases/{endpointReleaseName}`]: () =>
          createOkResponse({
            metadata: { name: 'payments-api-aaa' },
            spec: { backendRefs: [backendRef('payments-v1', 100)] },
          }),
        [`${NS}/endpointreleasebindings`]: () => list([live]),
        [`${NS}/endpoints/{endpointName}`]: rolling,
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.deployRelease(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          environment: 'development',
          releaseName: 'payments-api-aaa',
        },
        'token',
      );

      expect(mockPUT.mock.calls[0][1].body.spec.backendOverrides).toEqual([]);
    });

    it('refuses an A/B audience header the gateway cannot match', async () => {
      await expect(
        service.startRollout(
          {
            namespaceName: 'default',
            projectName: 'shop',
            endpointName: 'payments-api',
            plan: {
              strategy: 'abTest',
              candidate: { componentName: 'payments-v3', endpoint: 'http' },
              preview: {
                kind: 'cookie',
                name: 'exp',
                value: 'b',
                audience: { name: 'x client', value: 'ios' },
              },
            },
          },
          'token',
        ),
      ).rejects.toThrow(/valid HTTP header name/);
      expect(mockGET).not.toHaveBeenCalled();
    });
  });
});
