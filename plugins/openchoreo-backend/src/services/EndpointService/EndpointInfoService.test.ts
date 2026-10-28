import { mockServices } from '@backstage/backend-test-utils';
import { createOkResponse } from '@openchoreo/test-utils';
import { EndpointInfoService } from './EndpointInfoService';

const mockGET = jest.fn();
const mockPOST = jest.fn();
const mockPUT = jest.fn();
const mockDELETE = jest.fn();

jest.mock('@openchoreo/openchoreo-client-node', () => ({
  ...jest.requireActual('@openchoreo/openchoreo-client-node'),
  createOpenChoreoApiClient: jest.fn(() => ({
    GET: mockGET,
    POST: mockPOST,
    PUT: mockPUT,
    DELETE: mockDELETE,
  })),
  fetchAllPages: jest.fn((fetchPage: (cursor?: string) => Promise<any>) =>
    fetchPage(undefined).then((page: any) => page.items),
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const list = (items: unknown[]) => createOkResponse({ items, pagination: {} });

const endpoint = (weights: [number, number], latest = 'payments-api-aaa') => ({
  metadata: { name: 'payments-api', namespace: 'default' },
  spec: {
    owner: { projectName: 'shop' },
    type: { kind: 'ClusterEndpointType', name: 'http' },
    visibility: ['external'],
    autoDeploy: true,
    backendRefs: [
      {
        name: 'payments-v1',
        kind: 'Component',
        component: { name: 'payments-v1', endpoint: 'http' },
        weight: weights[0],
      },
      {
        name: 'payments-v2',
        kind: 'Component',
        component: { name: 'payments-v2', endpoint: 'http' },
        weight: weights[1],
        match: {
          headers: [{ name: 'x-canary', type: 'Exact', value: 'true' }],
        },
      },
    ],
  },
  status: { latestRelease: { name: latest, hash: latest.slice(-3) } },
});

const binding = (environment: string, project = 'shop') => ({
  metadata: { name: `payments-api-${environment}` },
  spec: {
    owner: { projectName: project, endpointName: 'payments-api' },
    environment,
    endpointRelease: 'payments-api-aaa',
  },
  status: {
    conditions: [
      {
        type: 'Ready',
        status: 'True',
        reason: 'RoutesReady',
        lastTransitionTime: '2026-10-12T00:00:00Z',
      },
    ],
    invokeURL: `http://${environment}.example.com/payments-v1-http`,
    backends: [
      {
        componentName: 'payments-v1',
        endpoint: 'http',
        weight: 90,
        resolved: true,
      },
      {
        componentName: 'payments-v2',
        endpoint: 'http',
        weight: 10,
        resolved: true,
      },
    ],
    serving: {
      endpointRelease: 'payments-api-aaa',
      since: '2026-10-12T00:00:00Z',
    },
  },
});

const componentBinding = (component: string, environment: string) => ({
  metadata: { name: `${component}-${environment}` },
  spec: {
    owner: { projectName: 'shop', componentName: component },
    environment,
    state: 'Active',
  },
  status: { endpoints: [{ name: 'http' }] },
});

const environment = (name: string, isProduction = false) => ({
  metadata: {
    name,
    namespace: 'default',
    uid: `uid-${name}`,
    creationTimestamp: '2026-10-01T00:00:00Z',
    annotations: { 'openchoreo.dev/display-name': name.toUpperCase() },
  },
  spec: { isProduction },
});

/** Routes mockGET by path so tests can describe the API they stand in for. */
function routeGET(routes: Record<string, (opts: any) => unknown>) {
  mockGET.mockImplementation((path: string, opts: any) => {
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected GET ${path}`);
    return Promise.resolve(handler(opts));
  });
}

const NS = '/api/v1/namespaces/{namespaceName}';

describe('EndpointInfoService', () => {
  let service: EndpointInfoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EndpointInfoService(mockServices.logger.mock(), 'http://api');
  });

  describe('listProjectEndpoints', () => {
    it('pairs each endpoint with the bound environments of its project', async () => {
      routeGET({
        [`${NS}/endpoints`]: () => list([endpoint([90, 10])]),
        [`${NS}/endpointreleasebindings`]: () =>
          list([
            binding('staging'),
            binding('development'),
            binding('development', 'other'),
          ]),
      });

      const result = await service.listProjectEndpoints(
        { namespaceName: 'default', projectName: 'shop' },
        'token',
      );

      expect(result).toHaveLength(1);
      expect(result[0].backends).toEqual([
        {
          componentName: 'payments-v1',
          endpoint: 'http',
          weight: 90,
          name: 'payments-v1',
        },
        {
          componentName: 'payments-v2',
          endpoint: 'http',
          weight: 10,
          name: 'payments-v2',
          match: {
            headers: [{ name: 'x-canary', type: 'Exact', value: 'true' }],
          },
        },
      ]);
      expect(result[0].environments.map(e => e.environment)).toEqual([
        'development',
        'staging',
      ]);
      expect(result[0].environments[0].status).toBe('Routing');
      expect(result[0].visibility).toEqual(['external']);
      expect(result[0].autoDeploy).toBe(true);
      expect(result[0].backends[1].match).toEqual({
        headers: [{ name: 'x-canary', type: 'Exact', value: 'true' }],
      });
    });
  });

  describe('listEndpointCandidates', () => {
    it("lists each component's deployed endpoints and the Endpoints routing them", async () => {
      const deployed = (
        component: string,
        env: string,
        endpoints: unknown[],
        state = 'Active',
        project = 'shop',
      ) => ({
        spec: {
          owner: { projectName: project, componentName: component },
          environment: env,
          state,
        },
        status: { endpoints },
      });
      routeGET({
        [`${NS}/components`]: opts => {
          expect(opts.params.query.project).toBe('shop');
          return list([
            { metadata: { name: 'payments-v2' } },
            { metadata: { name: 'payments-v1' } },
          ]);
        },
        [`${NS}/endpoints`]: () =>
          list([
            {
              metadata: { name: 'payments-api' },
              spec: {
                visibility: ['external'],
                backendRefs: [
                  {
                    name: 'payments-v1',
                    component: { name: 'payments-v1', endpoint: 'http' },
                  },
                ],
              },
            },
          ]),
        [`${NS}/releasebindings`]: opts =>
          opts.params.query.component === 'payments-v1'
            ? list([
                deployed('payments-v1', 'staging', [
                  { name: 'http', type: 'HTTP', invokeURL: 'http://stg/v1' },
                ]),
                deployed('payments-v1', 'development', [
                  { name: 'http', type: 'HTTP', invokeURL: 'http://dev/v1' },
                ]),
                deployed(
                  'payments-v1',
                  'production',
                  [{ name: 'http' }],
                  'Undeploy',
                ),
              ])
            : list([
                deployed('payments-v2', 'development', [], 'Active', 'billing'),
              ]),
      });

      const result = await service.listEndpointCandidates(
        { namespaceName: 'default', projectName: 'shop' },
        'token',
      );

      expect(result).toEqual([
        {
          componentName: 'payments-v1',
          endpoints: [
            {
              name: 'http',
              protocol: 'HTTP',
              environments: ['development', 'staging'],
              externalURL: 'http://stg/v1',
              routedBy: [
                { endpointName: 'payments-api', visibility: ['external'] },
              ],
            },
          ],
        },
        // Deployed only in another project, so nothing to offer.
        { componentName: 'payments-v2', endpoints: [] },
      ]);
    });
  });

  describe('listComponentTraffic', () => {
    const component = (endpoints: unknown[]) =>
      createOkResponse({
        metadata: { name: 'payments-v2', namespace: 'default' },
        status: { endpoints },
      });

    it("reads the component's reverse index and reports its live share per environment", async () => {
      routeGET({
        [`${NS}/components/{componentName}`]: opts => {
          expect(opts.params.path.componentName).toBe('payments-v2');
          return component([
            {
              name: 'payments-api',
              endpoint: 'http',
              environments: [{ name: 'development', weight: 10 }],
            },
          ]);
        },
        [`${NS}/endpointreleasebindings`]: opts => {
          expect(opts.params.query.endpoint).toBe('payments-api');
          return list([binding('development')]);
        },
      });

      const result = await service.listComponentTraffic(
        {
          namespaceName: 'default',
          projectName: 'shop',
          componentName: 'payments-v2',
        },
        'token',
      );

      expect(result).toEqual([
        expect.objectContaining({
          endpointName: 'payments-api',
          environment: 'development',
          weight: 10,
          totalWeight: 100,
          sharePercent: 10,
          hasOtherBackends: true,
        }),
      ]);
      expect(mockGET).not.toHaveBeenCalledWith(
        `${NS}/endpoints`,
        expect.anything(),
      );
    });

    it('skips the binding lookup when nothing routes to the component', async () => {
      routeGET({ [`${NS}/components/{componentName}`]: () => component([]) });

      const result = await service.listComponentTraffic(
        {
          namespaceName: 'default',
          projectName: 'shop',
          componentName: 'orders',
        },
        'token',
      );

      expect(result).toEqual([]);
      expect(mockGET).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchEndpointEnvironmentInfo', () => {
    it('lists every pipeline environment in promotion order', async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint([90, 10])),
        [`${NS}/endpointreleasebindings`]: () =>
          list([
            {
              ...binding('development'),
              spec: {
                ...binding('development').spec,
                backendOverrides: [{ name: 'payments-v2', weight: 50 }],
              },
            },
          ]),
        [`${NS}/endpointreleases/{endpointReleaseName}`]: opts => {
          expect(opts.params.path.endpointReleaseName).toBe('payments-api-aaa');
          return createOkResponse(endpoint([90, 10]));
        },
        [`${NS}/releasebindings`]: opts =>
          list(
            opts.params.query.component === 'payments-v1'
              ? [
                  componentBinding('payments-v1', 'development'),
                  componentBinding('payments-v1', 'staging'),
                ]
              : [componentBinding('payments-v2', 'development')],
          ),
        [`${NS}/environments`]: () =>
          list([
            environment('production', true),
            environment('development'),
            environment('staging'),
          ]),
        [`${NS}/projects/{projectName}`]: () =>
          createOkResponse({
            metadata: { name: 'shop' },
            spec: { deploymentPipelineRef: { name: 'default' } },
          }),
        [`${NS}/deploymentpipelines/{deploymentPipelineName}`]: () =>
          createOkResponse({
            metadata: { name: 'default' },
            spec: {
              promotionPaths: [
                {
                  sourceEnvironmentRef: { name: 'development' },
                  targetEnvironmentRefs: [{ name: 'staging' }],
                },
                {
                  sourceEnvironmentRef: { name: 'staging' },
                  targetEnvironmentRefs: [{ name: 'production' }],
                },
              ],
            },
          }),
      });

      const result = await service.fetchEndpointEnvironmentInfo(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
        },
        'token',
      );

      expect(result.map(e => [e.name, e.status])).toEqual([
        ['development', 'Routing'],
        ['staging', 'NotRouted'],
        ['production', 'NotRouted'],
      ]);
      expect(result[0]).toEqual(
        expect.objectContaining({
          displayName: 'DEVELOPMENT',
          endpointRelease: 'payments-api-aaa',
          servingRelease: 'payments-api-aaa',
          latestRelease: 'payments-api-aaa',
        }),
      );
      expect(result[0].overrides).toEqual([
        { name: 'payments-v2', weight: 50 },
      ]);
      expect(result[2].isProduction).toBe(true);
      expect(result.map(e => e.promotionTargets)).toEqual([
        [{ name: 'staging' }],
        [{ name: 'production' }],
        [],
      ]);
      expect(result.map(e => e.deployedBackends)).toEqual([
        ['payments-v1/http', 'payments-v2/http'],
        ['payments-v1/http'],
        [],
      ]);
    });

    it('refuses an endpoint of another project', async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint([90, 10])),
        [`${NS}/endpointreleasebindings`]: () => list([]),
        [`${NS}/environments`]: () => list([]),
        [`${NS}/projects/{projectName}`]: () =>
          createOkResponse({ metadata: { name: 'other' }, spec: {} }),
      });

      await expect(
        service.fetchEndpointEnvironmentInfo(
          {
            namespaceName: 'default',
            projectName: 'other',
            endpointName: 'payments-api',
          },
          'token',
        ),
      ).rejects.toThrow(/not found in project other/);
    });
  });

  describe('updateEndpointTraffic', () => {
    it('changes the weights and returns the new release', async () => {
      let reads = 0;
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            reads++ === 0
              ? endpoint([90, 10])
              : endpoint([50, 50], 'payments-api-bbb'),
          ),
      });
      mockPUT.mockResolvedValue(createOkResponse(endpoint([50, 50])));

      const result = await service.updateEndpointTraffic(
        {
          namespaceName: 'default',
          endpointName: 'payments-api',
          backends: [
            { componentName: 'payments-v1', endpoint: 'http', weight: 50 },
            { componentName: 'payments-v2', endpoint: 'http', weight: 50 },
          ],
        },
        'token',
      );

      expect(result).toEqual({
        latestRelease: 'payments-api-bbb',
        changed: true,
      });
      const body = mockPUT.mock.calls[0][1].body;
      expect(body.spec.backendRefs.map((r: any) => r.weight)).toEqual([50, 50]);
      expect(body.spec.owner).toEqual({ projectName: 'shop' });
    });

    it('does not write when the weights are unchanged', async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint([90, 10])),
      });

      const result = await service.updateEndpointTraffic(
        {
          namespaceName: 'default',
          endpointName: 'payments-api',
          backends: [
            { componentName: 'payments-v1', endpoint: 'http', weight: 90 },
          ],
        },
        'token',
      );

      expect(result).toEqual({
        latestRelease: 'payments-api-aaa',
        changed: false,
      });
      expect(mockPUT).not.toHaveBeenCalled();
    });
  });

  describe('updateEndpointReleaseBinding', () => {
    const request = {
      namespaceName: 'default',
      projectName: 'shop',
      endpointName: 'payments-api',
      environment: 'development',
      releaseName: 'payments-api-bbb',
    };

    it("moves an existing binding's pin", async () => {
      routeGET({
        [`${NS}/endpointreleasebindings`]: () => list([binding('development')]),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await service.updateEndpointReleaseBinding(
        request,
        'token',
      );

      expect(result).toEqual({
        bindingName: 'payments-api-development',
        created: false,
      });
      expect(mockPUT.mock.calls[0][1].body.spec.endpointRelease).toBe(
        'payments-api-bbb',
      );
      expect(mockPOST).not.toHaveBeenCalled();
    });

    it('creates the binding the first time the endpoint is routed there', async () => {
      routeGET({ [`${NS}/endpointreleasebindings`]: () => list([]) });
      mockPOST.mockResolvedValue(createOkResponse({}));

      const result = await service.updateEndpointReleaseBinding(
        request,
        'token',
      );

      expect(result).toEqual({
        bindingName: 'payments-api-development',
        created: true,
      });
      expect(mockPOST.mock.calls[0][1].body).toEqual({
        metadata: { name: 'payments-api-development' },
        spec: {
          owner: { projectName: 'shop', endpointName: 'payments-api' },
          environment: 'development',
          endpointRelease: 'payments-api-bbb',
        },
      });
    });
  });

  describe('endpoint resource tree', () => {
    it('reads the tree of the environment binding', async () => {
      routeGET({
        [`${NS}/endpointreleasebindings/{endpointReleaseBindingName}/k8sresources/tree`]:
          opts => ({
            data: {
              renderedReleases: [
                { name: opts.params.path.endpointReleaseBindingName },
              ],
            },
            response: { ok: true, status: 200 },
          }),
      });

      const tree = await service.fetchEndpointResourceTree(
        {
          namespaceName: 'default',
          endpointReleaseBindingName: 'payments-api-development',
        },
        'token',
      );

      expect(tree).toEqual({
        renderedReleases: [{ name: 'payments-api-development' }],
      });
    });

    it('fails when the API refuses', async () => {
      routeGET({
        [`${NS}/endpointreleasebindings/{endpointReleaseBindingName}/k8sresources/tree`]:
          () => ({
            error: { error: 'forbidden' },
            response: { ok: false, status: 403, statusText: 'Forbidden' },
          }),
      });

      await expect(
        service.fetchEndpointResourceTree(
          { namespaceName: 'default', endpointReleaseBindingName: 'x' },
          'token',
        ),
      ).rejects.toThrow();
    });

    it('sends the group only for non-core resources when reading events', async () => {
      const seen: any[] = [];
      routeGET({
        [`${NS}/endpointreleasebindings/{endpointReleaseBindingName}/k8sresources/events`]:
          opts => {
            seen.push(opts.params.query);
            return {
              data: { events: [] },
              response: { ok: true, status: 200 },
            };
          },
      });
      const base = {
        namespaceName: 'default',
        endpointReleaseBindingName: 'payments-api-development',
        version: 'v1',
        name: 'route',
      };

      await service.fetchEndpointResourceEvents(
        { ...base, group: 'gateway.networking.k8s.io', kind: 'HTTPRoute' },
        'token',
      );
      await service.fetchEndpointResourceEvents(
        { ...base, group: '', kind: 'Service' },
        'token',
      );

      expect(seen[0]).toMatchObject({ group: 'gateway.networking.k8s.io' });
      expect(seen[1]).not.toHaveProperty('group');
    });
  });

  describe('updateEndpointOverrides', () => {
    it("sets the environment binding's weights and waits until they apply", async () => {
      const applied = {
        ...binding('development'),
        status: {
          ...binding('development').status,
          backends: [
            { name: 'payments-v1', weight: 50, resolved: true },
            { name: 'payments-v2', weight: 50, resolved: true },
          ],
          conditions: [
            {
              type: 'RoutesReady',
              status: 'True',
              reason: 'RoutesReady',
              lastTransitionTime: '2026-10-12T00:00:00Z',
            },
          ],
        },
      };
      let reads = 0;
      routeGET({
        [`${NS}/endpointreleasebindings`]: opts => {
          expect(opts.params.query).toMatchObject({
            endpoint: 'payments-api',
            environment: 'development',
          });
          return list([reads++ === 0 ? binding('development') : applied]);
        },
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
      expect(opts.body.spec.backendOverrides).toEqual([
        { name: 'payments-v1', weight: 50 },
        { name: 'payments-v2', weight: 50 },
      ]);
      expect(opts.body.spec.endpointRelease).toBe('payments-api-aaa');
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

  describe('updateEndpointSettings', () => {
    it('changes the visibility, which cuts a release', async () => {
      let reads = 0;
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            reads++ === 0
              ? endpoint([90, 10])
              : endpoint([90, 10], 'payments-api-ccc'),
          ),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await service.updateEndpointSettings(
        {
          namespaceName: 'default',
          endpointName: 'payments-api',
          visibility: ['external', 'namespace'],
        },
        'token',
      );

      expect(result).toEqual({ latestRelease: 'payments-api-ccc' });
      const body = mockPUT.mock.calls[0][1].body;
      expect(body.spec.visibility).toEqual(['external', 'namespace']);
      expect(body.spec.autoDeploy).toBe(true);
    });
  });

  describe('deleteEndpoint and deleteEndpointRelease', () => {
    it('DELETEs the Endpoint', async () => {
      mockDELETE.mockResolvedValue(createOkResponse(undefined));
      await expect(
        service.deleteEndpoint(
          { namespaceName: 'default', endpointName: 'payments-api' },
          'token',
        ),
      ).resolves.toEqual({ endpointName: 'payments-api' });
      expect(mockDELETE).toHaveBeenCalledWith(
        `${NS}/endpoints/{endpointName}`,
        expect.objectContaining({
          params: {
            path: { namespaceName: 'default', endpointName: 'payments-api' },
          },
        }),
      );
    });

    it('DELETEs an EndpointRelease by name', async () => {
      mockDELETE.mockResolvedValue(createOkResponse(undefined));
      await service.deleteEndpointRelease(
        { namespaceName: 'default', releaseName: 'payments-api-aaa' },
        'token',
      );
      expect(mockDELETE).toHaveBeenCalledWith(
        `${NS}/endpointreleases/{endpointReleaseName}`,
        expect.objectContaining({
          params: {
            path: {
              namespaceName: 'default',
              endpointReleaseName: 'payments-api-aaa',
            },
          },
        }),
      );
    });
  });

  describe('rollouts', () => {
    const rolloutAnnotation = JSON.stringify({
      strategy: 'canary',
      stable: 'payments-v1',
      candidate: 'payments-v2',
      steps: [5, 25, 50, 100],
    });
    const withRollout = () => {
      const ep = endpoint([100, 0]);
      return {
        ...ep,
        metadata: {
          ...ep.metadata,
          annotations: { 'openchoreo.dev/rollout': rolloutAnnotation },
        },
      };
    };
    const routeRollout = () =>
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(withRollout()),
        [`${NS}/endpointreleasebindings`]: opts =>
          list(
            !opts.params.query.environment ||
              opts.params.query.environment === 'development'
              ? [binding('development')]
              : [],
          ),
      });
    const promote = () =>
      service.promoteRollout(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          from: 'development',
          to: 'staging',
        },
        'token',
      );

    it('promotes with the new version at 0%, so no traffic moves', async () => {
      routeRollout();
      mockPOST.mockResolvedValue(createOkResponse({}));

      const result = await promote();

      expect(result).toEqual({
        latestRelease: 'payments-api-aaa',
        environments: [{ name: 'staging', ok: true }],
      });
      expect(mockPOST.mock.calls[0][1].body.spec).toMatchObject({
        environment: 'staging',
        endpointRelease: 'payments-api-aaa',
        backendOverrides: [
          { name: 'payments-v1', weight: 100 },
          { name: 'payments-v2', weight: 0 },
        ],
      });
    });

    it('reports an environment that failed instead of throwing', async () => {
      routeRollout();
      mockPOST.mockRejectedValue(new Error('forbidden in staging'));

      expect((await promote()).environments).toEqual([
        { name: 'staging', ok: false, error: 'forbidden in staging' },
      ]);
    });

    it('refuses to complete while an environment still sends traffic to the old version', async () => {
      routeRollout();

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
      ).rejects.toThrow(/Send all traffic to payments-v2 in development/);
      expect(mockPUT).not.toHaveBeenCalled();
    });

    const threeWay = (latest: string) => {
      const ep = endpoint([70, 0], latest);
      return {
        ...ep,
        metadata: {
          ...ep.metadata,
          annotations: {
            'openchoreo.dev/rollout': JSON.stringify({
              strategy: 'canary',
              stable: 'payments-v1',
              candidate: 'payments-v2',
              baseline: [
                { name: 'payments-v1', weight: 70 },
                { name: 'payments-legacy', weight: 30 },
              ],
              steps: [5, 25, 50, 100],
            }),
          },
        },
        spec: {
          ...ep.spec,
          backendRefs: [
            ...ep.spec.backendRefs,
            {
              name: 'payments-legacy',
              kind: 'Component',
              component: { name: 'payments-legacy', endpoint: 'http' },
              weight: 30,
            },
          ],
        },
      };
    };

    it('abandoning puts back the split the rollout started from', async () => {
      let reads = 0;
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            threeWay(reads++ === 0 ? 'payments-api-aaa' : 'payments-api-bbb'),
          ),
        [`${NS}/endpointreleasebindings`]: () => list([]),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      await service.finishRollout(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          outcome: 'abandon',
        },
        'token',
      );

      const body = mockPUT.mock.calls[0][1].body;
      expect(body.spec.backendRefs.map((r: any) => [r.name, r.weight])).toEqual(
        [
          ['payments-v1', 70],
          ['payments-legacy', 30],
        ],
      );
      expect(body.metadata.annotations?.['openchoreo.dev/rollout']).toBe(
        undefined,
      );
    });

    it('completing swaps the replaced version and leaves the others', async () => {
      const done = {
        ...binding('development'),
        status: {
          ...binding('development').status,
          backends: [
            {
              componentName: 'payments-v1',
              endpoint: 'http',
              name: 'payments-v1',
              weight: 0,
            },
            {
              componentName: 'payments-v2',
              endpoint: 'http',
              name: 'payments-v2',
              weight: 7000,
            },
            {
              componentName: 'payments-legacy',
              endpoint: 'http',
              name: 'payments-legacy',
              weight: 3000,
            },
          ],
        },
      };
      let reads = 0;
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(
            threeWay(reads++ === 0 ? 'payments-api-aaa' : 'payments-api-bbb'),
          ),
        [`${NS}/endpointreleasebindings`]: () => list([done]),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));
      mockPOST.mockResolvedValue(createOkResponse({}));

      await service.finishRollout(
        {
          namespaceName: 'default',
          projectName: 'shop',
          endpointName: 'payments-api',
          outcome: 'complete',
        },
        'token',
      );

      const body = mockPUT.mock.calls[0][1].body;
      expect(body.spec.backendRefs.map((r: any) => [r.name, r.weight])).toEqual(
        [
          ['payments-v2', 70],
          ['payments-legacy', 30],
        ],
      );
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
            environments: ['development'],
          },
          'token',
        ),
      ).rejects.toThrow(/valid HTTP header name/);
      expect(mockGET).not.toHaveBeenCalled();
    });

    it('refuses to replace the versions while a rollout runs', async () => {
      routeRollout();

      await expect(
        service.updateEndpointTraffic(
          {
            namespaceName: 'default',
            endpointName: 'payments-api',
            backends: [
              { componentName: 'payments-v1', endpoint: 'http', weight: 100 },
            ],
            replaceBackends: true,
          },
          'token',
        ),
      ).rejects.toThrow(/Finish or abandon the rollout to payments-v2/);
      expect(mockPUT).not.toHaveBeenCalled();
    });
  });

  describe('deleteEndpointReleaseBinding', () => {
    it('fails clearly when the endpoint is not routed there', async () => {
      routeGET({ [`${NS}/endpointreleasebindings`]: () => list([]) });

      await expect(
        service.deleteEndpointReleaseBinding(
          {
            namespaceName: 'default',
            projectName: 'shop',
            endpointName: 'payments-api',
            environment: 'production',
          },
          'token',
        ),
      ).rejects.toThrow(/not routed in production/);
      expect(mockDELETE).not.toHaveBeenCalled();
    });
  });
});
