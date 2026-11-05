import { mockServices } from '@backstage/backend-test-utils';
import { createOkResponse } from '@openchoreo/test-utils';
import { EndpointInfoService } from './EndpointInfoService';

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
}));

const ref = (name: string, weight: number) => ({
  name,
  kind: 'Component',
  component: { name, endpoint: 'http' },
  weight,
});

const steps = (names: string[]) => ({
  steps: [5, 100].map(percent => ({
    backends: names.map(name => ({ name, percent })),
  })),
});

const endpoint = (rollout?: unknown) => ({
  metadata: { name: 'trips-api', namespace: 'default' },
  spec: {
    owner: { projectName: 'shop' },
    type: { kind: 'ClusterEndpointType', name: 'http' },
    backendRefs: [ref('stable', 100), ref('canary', 0), ref('canary-2', 0)],
    ...(rollout ? { rollout } : {}),
  },
});

const request = (backendName: string) => ({
  namespaceName: 'default',
  projectName: 'shop',
  endpointName: 'trips-api',
  backendName,
});

const FINISH =
  '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}/rollout/finish';

describe('EndpointInfoService.removeEndpointBackend with a rollout plan', () => {
  let service: EndpointInfoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EndpointInfoService(mockServices.logger.mock(), 'http://api');
    mockPUT.mockResolvedValue(createOkResponse({}));
    mockPOST.mockResolvedValue(createOkResponse({}));
  });

  it('finishes the rollout keeping stable when the only candidate goes', async () => {
    mockGET.mockResolvedValue(
      createOkResponse(
        endpoint({
          strategy: 'canary',
          stable: 'stable',
          candidates: [{ name: 'canary' }],
          canary: steps(['canary']),
        }),
      ),
    );

    await service.removeEndpointBackend(request('canary'), 'token');

    expect(mockPOST).toHaveBeenCalledWith(FINISH, {
      params: { path: { namespaceName: 'default', endpointName: 'trips-api' } },
      body: { keep: 'stable' },
    });
    expect(mockPUT).not.toHaveBeenCalled();
  });

  it('finishes the rollout keeping the candidate when stable goes', async () => {
    mockGET.mockResolvedValue(
      createOkResponse(
        endpoint({
          strategy: 'blueGreen',
          stable: 'stable',
          candidates: [{ name: 'canary' }],
        }),
      ),
    );

    await service.removeEndpointBackend(request('stable'), 'token');

    expect(mockPOST.mock.calls[0][1].body).toEqual({ keep: 'canary' });
  });

  it('drops one of several candidates from the plan with the backend', async () => {
    mockGET.mockResolvedValue(
      createOkResponse(
        endpoint({
          strategy: 'canary',
          stable: 'stable',
          candidates: [{ name: 'canary' }, { name: 'canary-2' }],
          canary: steps(['canary', 'canary-2']),
        }),
      ),
    );

    await service.removeEndpointBackend(request('canary-2'), 'token');

    expect(mockPOST).not.toHaveBeenCalled();
    const spec = mockPUT.mock.calls[0][1].body.spec;
    expect(spec.backendRefs.map((r: any) => r.name)).toEqual([
      'stable',
      'canary',
    ]);
    expect(spec.rollout.candidates).toEqual([{ name: 'canary' }]);
    expect(spec.rollout.canary).toEqual(steps(['canary']));
  });

  it('removes a backend outside the plan as before', async () => {
    mockGET.mockResolvedValue(createOkResponse(endpoint()));

    await service.removeEndpointBackend(request('canary-2'), 'token');

    expect(mockPOST).not.toHaveBeenCalled();
    expect(mockPUT.mock.calls[0][1].body.spec.rollout).toBeUndefined();
  });
});
