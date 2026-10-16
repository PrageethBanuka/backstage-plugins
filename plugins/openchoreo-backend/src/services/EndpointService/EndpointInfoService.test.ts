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
    type: { kind: 'ClusterEndpointType', name: 'http-weighted' },
    backendRefs: [
      { componentName: 'payments-v1', endpoint: 'http', weight: weights[0] },
      { componentName: 'payments-v2', endpoint: 'http', weight: weights[1] },
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
        { componentName: 'payments-v1', endpoint: 'http', weight: 90 },
        { componentName: 'payments-v2', endpoint: 'http', weight: 10 },
      ]);
      expect(result[0].environments.map(e => e.environment)).toEqual([
        'development',
        'staging',
      ]);
      expect(result[0].environments[0].status).toBe('Routing');
      expect(result[0].reclaimPolicy).toBe('Delete');
      expect(result[0].orphaned).toBe(false);
    });

    it('reports how an Endpoint was created and whether it is orphaned', async () => {
      const ep = {
        ...endpoint([90, 10]),
        metadata: {
          name: 'payments-api',
          namespace: 'default',
          annotations: {
            'openchoreo.dev/created-from': 'workload/payments-v1/http',
          },
        },
        spec: { ...endpoint([90, 10]).spec, reclaimPolicy: 'Retain' },
        status: {
          conditions: [
            {
              type: 'Orphaned',
              status: 'True',
              reason: 'NoBackends',
              lastTransitionTime: '2026-10-12T00:00:00Z',
            },
          ],
        },
      };
      routeGET({
        [`${NS}/endpoints`]: () => list([ep]),
        [`${NS}/endpointreleasebindings`]: () => list([]),
      });

      const [result] = await service.listProjectEndpoints(
        { namespaceName: 'default', projectName: 'shop' },
        'token',
      );

      expect(result.createdFrom).toBe('workload/payments-v1/http');
      expect(result.reclaimPolicy).toBe('Retain');
      expect(result.orphaned).toBe(true);
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
        [`${NS}/endpointreleasebindings`]: () => list([binding('development')]),
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

  describe('updateEndpointReclaimPolicy', () => {
    it('PUTs the Endpoint with the new policy and the same backends', async () => {
      routeGET({
        [`${NS}/endpoints/{endpointName}`]: () =>
          createOkResponse(endpoint([90, 10])),
      });
      mockPUT.mockResolvedValue(createOkResponse({}));

      const result = await service.updateEndpointReclaimPolicy(
        {
          namespaceName: 'default',
          endpointName: 'payments-api',
          reclaimPolicy: 'Retain',
        },
        'token',
      );

      expect(result).toEqual({ reclaimPolicy: 'Retain' });
      const [, opts] = mockPUT.mock.calls[0];
      expect(opts.body.spec.reclaimPolicy).toBe('Retain');
      expect(opts.body.spec.backendRefs).toHaveLength(2);
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
