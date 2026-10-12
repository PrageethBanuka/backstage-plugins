import { LoggerService } from '@backstage/backend-plugin-api';
import { NotFoundError } from '@backstage/errors';
import {
  createOpenChoreoApiClient,
  assertApiResponse,
  fetchAllPages,
  type OpenChoreoComponents,
} from '@openchoreo/openchoreo-client-node';
import type {
  ComponentTrafficEntry,
  EndpointEnvironment,
  EndpointEnvironmentSummary,
  EndpointReleaseSummary,
  EndpointSummary,
  EnvironmentResponse,
  UpdateEndpointReleaseBindingRequest,
  UpdateEndpointTrafficRequest,
} from '@openchoreo/backstage-plugin-common';
import {
  transformDeploymentPipeline,
  transformEnvironment,
} from '../transformers';
import { getEnvironmentOrder } from '../EnvironmentService/environmentOrder';
import {
  applyWeights,
  deriveEndpointStatus,
  toBackendStatuses,
  toBackendWeights,
} from './endpointStatus';

type Endpoint = OpenChoreoComponents['schemas']['Endpoint'];
type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];

type ApiClient = ReturnType<typeof createOpenChoreoApiClient>;

/** How long updateEndpointTraffic waits for the controller to cut the release. */
const RELEASE_WAIT_MS = 10_000;
const RELEASE_POLL_MS = 500;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * BFF service for Endpoints: traffic routing across a project's components.
 *
 * An Endpoint's split only changes in an environment when that
 * environment's EndpointReleaseBinding is pinned to a release, so the reads
 * here always pair the Endpoint (its latest split) with its bindings (what
 * each environment runs). All calls use the caller's token; openchoreo-api
 * enforces authorization.
 */
export class EndpointInfoService {
  private readonly logger: LoggerService;
  private readonly baseUrl: string;

  constructor(logger: LoggerService, baseUrl: string) {
    this.logger = logger;
    this.baseUrl = baseUrl;
  }

  private client(token?: string): ApiClient {
    return createOpenChoreoApiClient({
      baseUrl: this.baseUrl,
      token,
      logger: this.logger,
    });
  }

  private async listEndpoints(
    client: ApiClient,
    namespaceName: string,
    query: { project?: string; component?: string },
  ): Promise<Endpoint[]> {
    return fetchAllPages(cursor =>
      client
        .GET('/api/v1/namespaces/{namespaceName}/endpoints', {
          params: {
            path: { namespaceName },
            query: { ...query, limit: 100, cursor },
          },
        })
        .then(res => {
          assertApiResponse(res, 'list endpoints');
          return res.data!;
        }),
    );
  }

  private async listBindings(
    client: ApiClient,
    namespaceName: string,
    query: { endpoint?: string; environment?: string },
  ): Promise<EndpointReleaseBinding[]> {
    return fetchAllPages(cursor =>
      client
        .GET('/api/v1/namespaces/{namespaceName}/endpointreleasebindings', {
          params: {
            path: { namespaceName },
            query: { ...query, limit: 100, cursor },
          },
        })
        .then(res => {
          assertApiResponse(res, 'list endpoint release bindings');
          return res.data!;
        }),
    );
  }

  private async getEndpoint(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
  ): Promise<Endpoint> {
    const res = await client.GET(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      { params: { path: { namespaceName, endpointName } } },
    );
    assertApiResponse(res, 'get endpoint');
    return res.data!;
  }

  /** Bindings grouped by Endpoint, restricted to one project. */
  private groupBindings(
    bindings: EndpointReleaseBinding[],
    projectName: string,
  ): Map<string, EndpointReleaseBinding[]> {
    const byEndpoint = new Map<string, EndpointReleaseBinding[]>();
    for (const binding of bindings) {
      const owner = binding.spec?.owner;
      if (!owner || owner.projectName !== projectName) continue;
      const list = byEndpoint.get(owner.endpointName) ?? [];
      list.push(binding);
      byEndpoint.set(owner.endpointName, list);
    }
    return byEndpoint;
  }

  /** Lists a project's Endpoints with the environments each is bound to. */
  async listProjectEndpoints(
    request: { namespaceName: string; projectName: string },
    token?: string,
  ): Promise<EndpointSummary[]> {
    const client = this.client(token);
    const [endpoints, bindings] = await Promise.all([
      this.listEndpoints(client, request.namespaceName, {
        project: request.projectName,
      }),
      this.listBindings(client, request.namespaceName, {}),
    ]);
    const bindingsByEndpoint = this.groupBindings(
      bindings,
      request.projectName,
    );

    return endpoints.map(ep => {
      const name = ep.metadata.name;
      const environments: EndpointEnvironmentSummary[] = (
        bindingsByEndpoint.get(name) ?? []
      )
        .map(b => ({
          environment: b.spec!.environment,
          bindingName: b.metadata.name,
          endpointRelease: b.spec?.endpointRelease,
          status: deriveEndpointStatus(b).status,
          invokeURL: b.status?.invokeURL,
        }))
        .sort((a, b) => a.environment.localeCompare(b.environment));
      return {
        name,
        namespaceName: request.namespaceName,
        projectName: request.projectName,
        type: {
          kind: ep.spec?.type.kind ?? 'EndpointType',
          name: ep.spec?.type.name ?? '',
        },
        backends: toBackendWeights(ep.spec?.backendRefs),
        latestRelease: ep.status?.latestRelease?.name,
        environments,
      };
    });
  }

  /**
   * Lists the Endpoints that send traffic to a component, one entry per
   * environment the Endpoint is bound to, with this component's live share.
   */
  async listComponentTraffic(
    request: {
      namespaceName: string;
      projectName: string;
      componentName: string;
    },
    token?: string,
  ): Promise<ComponentTrafficEntry[]> {
    const client = this.client(token);
    const endpoints = (
      await this.listEndpoints(client, request.namespaceName, {
        component: request.componentName,
      })
    ).filter(ep => ep.spec?.owner.projectName === request.projectName);
    if (endpoints.length === 0) {
      return [];
    }

    const bindingsByEndpoint = this.groupBindings(
      await this.listBindings(client, request.namespaceName, {}),
      request.projectName,
    );

    const entries: ComponentTrafficEntry[] = [];
    for (const ep of endpoints) {
      for (const binding of bindingsByEndpoint.get(ep.metadata.name) ?? []) {
        const backends = toBackendStatuses(binding);
        const totalWeight = backends.reduce((sum, b) => sum + b.weight, 0);
        const weight = backends
          .filter(b => b.componentName === request.componentName)
          .reduce((sum, b) => sum + b.weight, 0);
        entries.push({
          endpointName: ep.metadata.name,
          environment: binding.spec!.environment,
          status: deriveEndpointStatus(binding).status,
          weight,
          totalWeight,
          sharePercent:
            totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0,
          invokeURL: binding.status?.invokeURL,
        });
      }
    }
    return entries.sort(
      (a, b) =>
        a.endpointName.localeCompare(b.endpointName) ||
        a.environment.localeCompare(b.environment),
    );
  }

  /**
   * Per-environment view of one Endpoint, in deployment-pipeline order. Every
   * pipeline environment is listed, bound or not, so the UI can offer to
   * route traffic there.
   */
  async fetchEndpointEnvironmentInfo(
    request: {
      namespaceName: string;
      projectName: string;
      endpointName: string;
    },
    token?: string,
  ): Promise<EndpointEnvironment[]> {
    const client = this.client(token);
    const [endpoint, bindings, environments, promotionPaths] =
      await Promise.all([
        this.getEndpoint(client, request.namespaceName, request.endpointName),
        this.listBindings(client, request.namespaceName, {
          endpoint: request.endpointName,
        }),
        fetchAllPages(cursor =>
          client
            .GET('/api/v1/namespaces/{namespaceName}/environments', {
              params: {
                path: { namespaceName: request.namespaceName },
                query: { limit: 100, cursor },
              },
            })
            .then(res => {
              assertApiResponse(res, 'list environments');
              return res.data!;
            }),
        ),
        this.fetchPromotionPaths(client, request),
      ]);

    if (endpoint.spec?.owner.projectName !== request.projectName) {
      throw new NotFoundError(
        `Endpoint ${request.endpointName} not found in project ${request.projectName}`,
      );
    }

    const latestRelease = endpoint.status?.latestRelease?.name;
    const bindingByEnv = new Map<string, EndpointReleaseBinding>();
    for (const b of bindings) {
      if (b.spec?.owner.projectName === request.projectName) {
        bindingByEnv.set(b.spec.environment, b);
      }
    }
    const envByName = new Map<string, EnvironmentResponse>(
      environments.map(e => {
        const env = transformEnvironment(e);
        return [env.name, env];
      }),
    );

    // Pipeline order first, then any bound environment outside the
    // pipeline, so a binding is never hidden.
    const nameMap = new Map(
      [...envByName.keys()].map(name => [name.toLowerCase(), name]),
    );
    const ordered = getEnvironmentOrder(promotionPaths, nameMap);
    for (const env of bindingByEnv.keys()) {
      if (!ordered.includes(env)) ordered.push(env);
    }

    return ordered.map(envName => {
      const env = envByName.get(envName);
      const binding = bindingByEnv.get(envName);
      const derived = deriveEndpointStatus(binding);
      return {
        name: envName,
        displayName: env?.displayName || envName,
        isProduction: env?.isProduction ?? false,
        bindingName: binding?.metadata.name,
        endpointRelease: binding?.spec?.endpointRelease,
        servingRelease: binding?.status?.serving?.endpointRelease,
        latestRelease,
        status: derived.status,
        statusReason: derived.reason,
        statusMessage: derived.message,
        invokeURL: binding?.status?.invokeURL,
        backends: toBackendStatuses(binding),
      };
    });
  }

  private async fetchPromotionPaths(
    client: ApiClient,
    request: { namespaceName: string; projectName: string },
  ): Promise<any[]> {
    const projectRes = await client.GET(
      '/api/v1/namespaces/{namespaceName}/projects/{projectName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            projectName: request.projectName,
          },
        },
      },
    );
    assertApiResponse(projectRes, 'get project');
    const pipelineName = projectRes.data?.spec?.deploymentPipelineRef?.name;
    if (!pipelineName) {
      return [];
    }
    const pipelineRes = await client.GET(
      '/api/v1/namespaces/{namespaceName}/deploymentpipelines/{deploymentPipelineName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            deploymentPipelineName: pipelineName,
          },
        },
      },
    );
    assertApiResponse(pipelineRes, 'get deployment pipeline');
    return transformDeploymentPipeline(pipelineRes.data!).promotionPaths ?? [];
  }

  /** An Endpoint's releases, newest first. */
  async listEndpointReleases(
    request: { namespaceName: string; endpointName: string },
    token?: string,
  ): Promise<EndpointReleaseSummary[]> {
    const client = this.client(token);
    const releases = await fetchAllPages(cursor =>
      client
        .GET('/api/v1/namespaces/{namespaceName}/endpointreleases', {
          params: {
            path: { namespaceName: request.namespaceName },
            query: { endpoint: request.endpointName, limit: 100, cursor },
          },
        })
        .then(res => {
          assertApiResponse(res, 'list endpoint releases');
          return res.data!;
        }),
    );
    return releases
      .map(r => ({
        name: r.metadata.name,
        createdAt: r.metadata.creationTimestamp,
        backends: toBackendWeights(r.spec?.backendRefs),
      }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  /**
   * Changes an Endpoint's weights. The Endpoint controller cuts a new
   * release; no environment's traffic moves until a binding is pinned to it.
   * Waits briefly for the release so the caller can roll it out straight
   * away; `latestRelease` is undefined if the controller has not cut it yet.
   */
  async updateEndpointTraffic(
    request: UpdateEndpointTrafficRequest,
    token?: string,
  ): Promise<{ latestRelease?: string; changed: boolean }> {
    const client = this.client(token);
    const endpoint = await this.getEndpoint(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const previous = endpoint.status?.latestRelease?.name;
    const refs = endpoint.spec?.backendRefs ?? [];
    const updatedRefs = applyWeights(refs, request.backends);
    const changed = updatedRefs.some(
      (ref, i) => (ref.weight ?? 1) !== (refs[i].weight ?? 1),
    );
    if (!changed) {
      return { latestRelease: previous, changed: false };
    }

    const res = await client.PUT(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
        body: {
          metadata: endpoint.metadata,
          spec: { ...endpoint.spec!, backendRefs: updatedRefs },
        },
      },
    );
    assertApiResponse(res, 'update endpoint');

    const deadline = Date.now() + RELEASE_WAIT_MS;
    while (Date.now() < deadline) {
      const current = await this.getEndpoint(
        client,
        request.namespaceName,
        request.endpointName,
      );
      const latest = current.status?.latestRelease?.name;
      // Release names are content hashes, so any change of weights moves
      // latestRelease, also when it returns to an earlier release.
      if (latest && latest !== previous) {
        return { latestRelease: latest, changed: true };
      }
      await sleep(RELEASE_POLL_MS);
    }
    this.logger.warn(
      `Endpoint ${request.endpointName}: no new release within ${RELEASE_WAIT_MS}ms`,
    );
    return { latestRelease: undefined, changed: true };
  }

  /**
   * Pins an environment to a release (roll out, promote or roll back).
   * Updates the environment's binding, or creates `<endpoint>-<environment>`
   * when the Endpoint is not routed there yet.
   */
  async updateEndpointReleaseBinding(
    request: UpdateEndpointReleaseBindingRequest,
    token?: string,
  ): Promise<{ bindingName: string; created: boolean }> {
    const client = this.client(token);
    const existing = (
      await this.listBindings(client, request.namespaceName, {
        endpoint: request.endpointName,
        environment: request.environment,
      })
    ).find(b => b.spec?.owner.projectName === request.projectName);

    if (existing) {
      const res = await client.PUT(
        '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}',
        {
          params: {
            path: {
              namespaceName: request.namespaceName,
              endpointReleaseBindingName: existing.metadata.name,
            },
          },
          body: {
            metadata: existing.metadata,
            spec: { ...existing.spec!, endpointRelease: request.releaseName },
          },
        },
      );
      assertApiResponse(res, 'update endpoint release binding');
      return { bindingName: existing.metadata.name, created: false };
    }

    const bindingName = `${request.endpointName}-${request.environment}`;
    const res = await client.POST(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings',
      {
        params: { path: { namespaceName: request.namespaceName } },
        body: {
          metadata: { name: bindingName },
          spec: {
            owner: {
              projectName: request.projectName,
              endpointName: request.endpointName,
            },
            environment: request.environment,
            endpointRelease: request.releaseName,
          },
        },
      },
    );
    assertApiResponse(res, 'create endpoint release binding');
    return { bindingName, created: true };
  }

  /**
   * Stops routing an Endpoint in an environment. The binding hands traffic
   * back to the components' own routes before its routes are removed.
   */
  async deleteEndpointReleaseBinding(
    request: {
      namespaceName: string;
      projectName: string;
      endpointName: string;
      environment: string;
    },
    token?: string,
  ): Promise<{ bindingName: string }> {
    const client = this.client(token);
    const existing = (
      await this.listBindings(client, request.namespaceName, {
        endpoint: request.endpointName,
        environment: request.environment,
      })
    ).find(b => b.spec?.owner.projectName === request.projectName);
    if (!existing) {
      throw new NotFoundError(
        `Endpoint ${request.endpointName} is not routed in ${request.environment}`,
      );
    }
    const res = await client.DELETE(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointReleaseBindingName: existing.metadata.name,
          },
        },
      },
    );
    assertApiResponse(res, 'delete endpoint release binding');
    return { bindingName: existing.metadata.name };
  }
}
