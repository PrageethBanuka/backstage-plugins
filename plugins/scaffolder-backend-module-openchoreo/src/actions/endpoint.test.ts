import { createEndpointAction } from './endpoint';

const mockPOST = jest.fn();

jest.mock('@openchoreo/openchoreo-client-node', () => ({
  ...jest.requireActual('@openchoreo/openchoreo-client-node'),
  createOpenChoreoApiClient: jest.fn(() => ({
    POST: mockPOST,
    GET: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  })),
}));

jest.mock('@openchoreo/backstage-plugin-catalog-backend-module', () => ({
  translateEndpointToEntity: jest.fn((data, ns, cfg) => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Endpoint',
    metadata: { name: data.name, namespace: ns },
    spec: {
      type: data.typeName,
      owner: cfg.defaultOwner,
      system: data.projectName,
      backends: data.backends,
    },
  })),
}));

const config = {
  getString: (k: string) => {
    if (k === 'openchoreo.baseUrl') return 'http://test';
    throw new Error(`unexpected getString: ${k}`);
  },
  getOptionalBoolean: () => false,
  getOptionalString: () => 'owners',
} as any;

const buildCtx = (input: Record<string, any> = {}) => ({
  input: {
    namespaceName: 'default',
    projectName: 'shop',
    endpointName: 'payments-api',
    typeKind: 'ClusterEndpointType' as const,
    typeName: 'http-gateway',
    backends: [{ componentName: 'payments-v1', endpoint: 'http', weight: 100 }],
    ...input,
  },
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  output: jest.fn(),
});

describe('createEndpointAction', () => {
  const immediateCatalog = { insertEntity: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    immediateCatalog.insertEntity.mockResolvedValue(undefined);
    mockPOST.mockResolvedValue({
      data: { metadata: { name: 'payments-api', uid: 'uid-1' } },
      error: undefined,
      response: { ok: true, status: 201 },
    });
  });

  it('POSTs an Endpoint with the type, backends and a default reclaim policy', async () => {
    const action = createEndpointAction(config, immediateCatalog as any);
    const ctx = buildCtx();
    await action.handler(ctx as any);

    const [path, opts] = mockPOST.mock.calls[0];
    expect(path).toBe('/api/v1/namespaces/{namespaceName}/endpoints');
    expect(opts.params.path.namespaceName).toBe('default');
    expect(opts.body).toEqual({
      metadata: { name: 'payments-api' },
      spec: {
        owner: { projectName: 'shop' },
        type: { kind: 'ClusterEndpointType', name: 'http-gateway' },
        backendRefs: [
          { componentName: 'payments-v1', endpoint: 'http', weight: 100 },
        ],
        reclaimPolicy: 'Delete',
      },
    });
    expect(immediateCatalog.insertEntity).toHaveBeenCalledTimes(1);
    expect(ctx.output).toHaveBeenCalledWith(
      'entityRef',
      'endpoint:default/payments-api',
    );
  });

  it('passes Retain and strips entity ref prefixes', async () => {
    const action = createEndpointAction(config, immediateCatalog as any);
    await action.handler(
      buildCtx({
        namespaceName: 'domain:default/default',
        projectName: 'system:default/shop',
        reclaimPolicy: 'Retain',
      }) as any,
    );

    const [, opts] = mockPOST.mock.calls[0];
    expect(opts.params.path.namespaceName).toBe('default');
    expect(opts.body.spec.owner.projectName).toBe('shop');
    expect(opts.body.spec.reclaimPolicy).toBe('Retain');
  });

  it('still succeeds when the immediate catalog insert fails', async () => {
    immediateCatalog.insertEntity.mockRejectedValueOnce(new Error('boom'));
    const action = createEndpointAction(config, immediateCatalog as any);
    const ctx = buildCtx();
    await expect(action.handler(ctx as any)).resolves.toBeUndefined();
    expect(ctx.output).toHaveBeenCalledWith('endpointName', 'payments-api');
  });
});
