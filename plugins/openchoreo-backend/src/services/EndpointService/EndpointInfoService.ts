import { LoggerService } from '@backstage/backend-plugin-api';
import { InputError, NotFoundError } from '@backstage/errors';
import {
  createOpenChoreoApiClient,
  assertApiResponse,
  fetchAllPages,
  type OpenChoreoComponents,
} from '@openchoreo/openchoreo-client-node';
import {
  completeSplit,
  currentRollout,
  finishStrategy,
  parseRollout,
  planRollout,
  ROLLOUT_ANNOTATION,
  rolloutPosition,
  rolloutWeights,
  serializeRollout,
  stableSplit,
} from '@openchoreo/backstage-plugin-common';
import type {
  ComponentTrafficEntry,
  EndpointBackendWeight,
  EndpointEnvironment,
  EndpointEnvironmentSummary,
  EndpointReleaseSummary,
  EndpointTypeDetails,
  EndpointSummary,
  EndpointCandidate,
  EnvironmentResponse,
  UpdateEndpointOverridesRequest,
  EndpointWeightOverride,
  FinishRolloutRequest,
  PromoteRolloutRequest,
  RolloutActionResult,
  SetRolloutStageRequest,
  StartRolloutRequest,
  UpdateEndpointReleaseBindingRequest,
  UpdateEndpointRulesRequest,
  UpdateEndpointSettingsRequest,
  UpdateEndpointTrafficRequest,
} from '@openchoreo/backstage-plugin-common';
import {
  transformDeploymentPipeline,
  transformEnvironment,
} from '../transformers';
import {
  getEnvironmentOrder,
  getSourceEnvName,
} from '../EnvironmentService/environmentOrder';
import {
  applyBackends,
  applyWeights,
  deriveEndpointStatus,
  pruneRules,
  toApiRules,
  toBackendStatuses,
  toBackendWeights,
  toOverrides,
  toRules,
  validateRules,
} from './endpointStatus';

type Endpoint = OpenChoreoComponents['schemas']['Endpoint'];
type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];

type ApiClient = ReturnType<typeof createOpenChoreoApiClient>;

/**
 * Why the Endpoint can't cut a release, from Ready=False (a missing type, or a
 * backend with traffic whose component no longer exists, or a slot another
 * Endpoint already routes).
 */
const endpointProblem = (ep: Endpoint): string | undefined => {
  const ready = (ep.status?.conditions ?? []).find(c => c.type === 'Ready');
  if (!ready || ready.status !== 'False') {
    return undefined;
  }
  return ready.message || ready.reason;
};

/** How long updateEndpointTraffic waits for the controller to cut the release. */
const RELEASE_WAIT_MS = 10_000;
const RELEASE_POLL_MS = 500;

/**
 * How long updateEndpointOverrides waits for the data plane to accept the new
 * weights. Past it, the change still lands; the caller is told it is applying.
 */
const OVERRIDES_WAIT_MS = 20_000;

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
      const backends = toBackendWeights(ep.spec?.backendRefs);
      const rules = toRules(ep.spec?.rules);
      const { rollout, source } = currentRollout(
        ep.metadata.annotations,
        backends,
        rules,
      );
      return {
        name,
        namespaceName: request.namespaceName,
        projectName: request.projectName,
        type: {
          kind: ep.spec?.type.kind ?? 'EndpointType',
          name: ep.spec?.type.name ?? '',
        },
        visibility: ep.spec?.visibility ?? [],
        autoDeploy: ep.spec?.autoDeploy ?? false,
        backends,
        rules,
        ...(rollout && { rollout }),
        rolloutSource: source,
        latestRelease: ep.status?.latestRelease?.name,
        problem: endpointProblem(ep),
        environments,
      };
    });
  }

  /**
   * Lists the Endpoints that send traffic to a component, one entry per
   * environment the Endpoint is bound to, with this component's live share.
   *
   * The component's reverse index (status.endpoints, kept by the Component
   * controller) names the Endpoints, so only their bindings are read instead
   * of every Endpoint and binding in the namespace.
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
    const res = await client.GET(
      '/api/v1/namespaces/{namespaceName}/components/{componentName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            componentName: request.componentName,
          },
        },
      },
    );
    assertApiResponse(res, 'get component');
    const refs = res.data!.status?.endpoints ?? [];
    const endpointNames = [...new Set(refs.map(ref => ref.name))];
    if (endpointNames.length === 0) {
      return [];
    }

    const bindingLists = await Promise.all(
      endpointNames.map(endpoint =>
        this.listBindings(client, request.namespaceName, { endpoint }),
      ),
    );
    const bindingsByEndpoint = this.groupBindings(
      bindingLists.flat(),
      request.projectName,
    );

    const entries: ComponentTrafficEntry[] = [];
    for (const endpointName of endpointNames) {
      for (const binding of bindingsByEndpoint.get(endpointName) ?? []) {
        const backends = toBackendStatuses(binding);
        const totalWeight = backends.reduce((sum, b) => sum + b.weight, 0);
        const mine = backends.filter(
          b => b.componentName === request.componentName,
        );
        const weight = mine.reduce((sum, b) => sum + b.weight, 0);
        entries.push({
          endpointName,
          environment: binding.spec!.environment,
          status: deriveEndpointStatus(binding).status,
          weight,
          totalWeight,
          sharePercent:
            totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0,
          hasOtherBackends: backends.length > mine.length,
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
    const endpoint = await this.getEndpoint(
      client,
      request.namespaceName,
      request.endpointName,
    );
    if (endpoint.spec?.owner.projectName !== request.projectName) {
      throw new NotFoundError(
        `Endpoint ${request.endpointName} not found in project ${request.projectName}`,
      );
    }

    const [bindings, environments, promotionPaths, deployed] =
      await Promise.all([
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
        this.fetchDeployedBackends(
          client,
          request,
          toBackendWeights(endpoint.spec?.backendRefs),
        ),
      ]);

    const latestRelease = endpoint.status?.latestRelease?.name;
    const { rollout } = currentRollout(
      endpoint.metadata.annotations,
      toBackendWeights(endpoint.spec?.backendRefs),
      toRules(endpoint.spec?.rules),
    );
    const bindingByEnv = new Map<string, EndpointReleaseBinding>();
    for (const b of bindings) {
      if (b.spec?.owner.projectName === request.projectName) {
        bindingByEnv.set(b.spec.environment, b);
      }
    }
    const rulesByRelease = await this.fetchReleaseRules(
      client,
      request.namespaceName,
      [...bindingByEnv.values()].map(b => b.spec?.endpointRelease),
    );
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

    const targetsByEnv = new Map<string, { name: string }[]>();
    for (const path of promotionPaths) {
      const source = getSourceEnvName(path.sourceEnvironmentRef);
      const targets = targetsByEnv.get(source) ?? [];
      for (const t of path.targetEnvironmentRefs ?? []) {
        if (!targets.some(x => x.name === t.name))
          targets.push({ name: t.name });
      }
      targetsByEnv.set(source, targets);
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
        overrides: toOverrides(binding),
        ...(rollout &&
          binding && {
            rollout: rolloutPosition(
              rollout,
              Object.fromEntries(
                toBackendStatuses(binding).map(b => [
                  b.name ?? b.componentName,
                  b.weight,
                ]),
              ),
            ),
          }),
        rules: rulesByRelease.get(binding?.spec?.endpointRelease ?? '') ?? [],
        deployedBackends: [...(deployed.get(envName) ?? [])].sort(),
        promotionTargets: targetsByEnv.get(envName) ?? [],
      };
    });
  }

  /** The rules of each named release; a missing release has none. */
  private async fetchReleaseRules(
    client: ApiClient,
    namespaceName: string,
    names: Array<string | undefined>,
  ): Promise<Map<string, ReturnType<typeof toRules>>> {
    const unique = [...new Set(names.filter((n): n is string => !!n))];
    const entries = await Promise.all(
      unique.map(async name => {
        const res = await client.GET(
          '/api/v1/namespaces/{namespaceName}/endpointreleases/{endpointReleaseName}',
          { params: { path: { namespaceName, endpointReleaseName: name } } },
        );
        if (res.response.status === 404) {
          return [name, []] as const;
        }
        assertApiResponse(res, 'get endpoint release');
        return [name, toRules(res.data!.spec?.rules)] as const;
      }),
    );
    return new Map(entries.map(([n, r]) => [n, [...r]]));
  }

  /**
   * For each environment, the Endpoint's backends whose component is
   * deployed there and exposes the workload endpoint, as `component/endpoint`
   * keys. Lets the UI check a rollout before the controller would report
   * BackendsUnresolved.
   */
  private async fetchDeployedBackends(
    client: ApiClient,
    request: { namespaceName: string; projectName: string },
    backends: EndpointBackendWeight[],
  ): Promise<Map<string, Set<string>>> {
    const deployed = new Map<string, Set<string>>();
    const components = [...new Set(backends.map(b => b.componentName))];
    for (const rb of await this.listDeployedReleaseBindings(
      client,
      request,
      components,
    )) {
      const owner = rb.spec!.owner;
      const exposed = new Set((rb.status?.endpoints ?? []).map(e => e.name));
      for (const b of backends) {
        if (
          b.componentName === owner.componentName &&
          exposed.has(b.endpoint)
        ) {
          const env = rb.spec!.environment;
          const set = deployed.get(env) ?? new Set<string>();
          set.add(`${b.componentName}/${b.endpoint}`);
          deployed.set(env, set);
        }
      }
    }
    return deployed;
  }

  /**
   * The ReleaseBindings of the given components that deploy them in the
   * project: those of other projects and undeployed ones are left out.
   */
  private async listDeployedReleaseBindings(
    client: ApiClient,
    request: { namespaceName: string; projectName: string },
    components: string[],
  ) {
    const bindingsPerComponent = await Promise.all(
      components.map(componentName =>
        fetchAllPages(cursor =>
          client
            .GET('/api/v1/namespaces/{namespaceName}/releasebindings', {
              params: {
                path: { namespaceName: request.namespaceName },
                query: { component: componentName, limit: 100, cursor },
              },
            })
            .then(res => {
              assertApiResponse(res, 'list release bindings');
              return res.data!;
            }),
        ),
      ),
    );
    return bindingsPerComponent
      .flat()
      .filter(
        rb =>
          rb.spec?.owner?.projectName === request.projectName &&
          rb.spec?.state !== 'Undeploy',
      );
  }

  /**
   * The project's components and the workload endpoints they have deployed,
   * for picking an Endpoint's URL and backends. Each endpoint names the
   * Endpoint already serving its URL, since one URL is served by one
   * Endpoint.
   */
  async listEndpointCandidates(
    request: { namespaceName: string; projectName: string },
    token?: string,
  ): Promise<EndpointCandidate[]> {
    const client = this.client(token);
    const [components, endpoints] = await Promise.all([
      fetchAllPages(cursor =>
        client
          .GET('/api/v1/namespaces/{namespaceName}/components', {
            params: {
              path: { namespaceName: request.namespaceName },
              query: { project: request.projectName, limit: 100, cursor },
            },
          })
          .then(res => {
            assertApiResponse(res, 'list components');
            return res.data!;
          }),
      ),
      this.listEndpoints(client, request.namespaceName, {
        project: request.projectName,
      }),
    ]);

    // An Endpoint claims each component backend in each of its visibilities;
    // another Endpoint can route the same workload endpoint only in another
    // visibility.
    const routedBy = new Map<
      string,
      Array<{ endpointName: string; visibility: EndpointSummary['visibility'] }>
    >();
    for (const ep of endpoints) {
      for (const ref of ep.spec?.backendRefs ?? []) {
        if (!ref.component) continue;
        const k = `${ref.component.name}/${ref.component.endpoint}`;
        const list = routedBy.get(k) ?? [];
        if (!list.some(e => e.endpointName === ep.metadata.name)) {
          list.push({
            endpointName: ep.metadata.name,
            visibility: ep.spec?.visibility ?? [],
          });
        }
        routedBy.set(k, list);
      }
    }

    const names = components.map(c => c.metadata.name).sort();
    const bindings = await this.listDeployedReleaseBindings(
      client,
      request,
      names,
    );

    return names.map(componentName => {
      const byEndpoint = new Map<
        string,
        EndpointCandidate['endpoints'][number]
      >();
      for (const rb of bindings) {
        if (rb.spec!.owner.componentName !== componentName) continue;
        for (const status of rb.status?.endpoints ?? []) {
          const entry = byEndpoint.get(status.name) ?? {
            name: status.name,
            protocol: status.type,
            environments: [],
            routedBy: routedBy.get(`${componentName}/${status.name}`),
          };
          entry.environments.push(rb.spec!.environment);
          entry.externalURL ??= status.invokeURL;
          byEndpoint.set(status.name, entry);
        }
      }
      const deployedEndpoints = [...byEndpoint.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const e of deployedEndpoints) e.environments.sort();
      return { componentName, endpoints: deployedEndpoints };
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

  /**
   * The EndpointReleaseBinding itself, as stored (metadata, spec and
   * status), for the Definition tab of the K8s artifacts view.
   */
  async fetchEndpointReleaseBinding(
    request: { namespaceName: string; endpointReleaseBindingName: string },
    token?: string,
  ) {
    const res = await this.client(token).GET(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointReleaseBindingName: request.endpointReleaseBindingName,
          },
        },
      },
    );
    assertApiResponse(res, 'get endpoint release binding');
    return res.data;
  }

  /**
   * The live Kubernetes resources an environment's EndpointReleaseBinding
   * applied (its RenderedRelease and the HTTPRoute), for the K8s artifacts
   * view. Bindings are named `<endpoint>-<environment>`.
   */
  async fetchEndpointResourceTree(
    request: { namespaceName: string; endpointReleaseBindingName: string },
    token?: string,
  ) {
    const { data, error, response } = await this.client(token).GET(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}/k8sresources/tree',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointReleaseBindingName: request.endpointReleaseBindingName,
          },
        },
      },
    );
    assertApiResponse(
      { data, error, response },
      'fetch endpoint resource tree',
    );
    return data;
  }

  /** Kubernetes events for one resource in an endpoint binding's tree. */
  async fetchEndpointResourceEvents(
    request: {
      namespaceName: string;
      endpointReleaseBindingName: string;
      group: string;
      version: string;
      kind: string;
      name: string;
    },
    token?: string,
  ) {
    const { data, error, response } = await this.client(token).GET(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}/k8sresources/events',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointReleaseBindingName: request.endpointReleaseBindingName,
          },
          query: {
            ...(request.group ? { group: request.group } : {}),
            version: request.version,
            kind: request.kind,
            name: request.name,
          },
        },
      },
    );
    assertApiResponse(
      { data, error, response },
      'fetch endpoint resource events',
    );
    return data;
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
        rules: toRules(r.spec?.rules),
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
    if (request.replaceBackends) assertNoRollout(endpoint);
    const previous = endpoint.status?.latestRelease?.name;
    const refs = endpoint.spec?.backendRefs ?? [];
    const updatedRefs = request.replaceBackends
      ? applyBackends(refs, request.backends)
      : applyWeights(refs, request.backends);
    const changed =
      updatedRefs.length !== refs.length ||
      updatedRefs.some(
        (ref, i) =>
          ref.name !== refs[i].name ||
          (ref.weight ?? 1) !== (refs[i].weight ?? 1),
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
          spec: {
            ...endpoint.spec!,
            backendRefs: updatedRefs,
            rules: pruneRules(endpoint.spec?.rules, updatedRefs),
          },
        },
      },
    );
    assertApiResponse(res, 'update endpoint');

    return {
      latestRelease: await this.waitForRelease(
        client,
        request.namespaceName,
        request.endpointName,
        previous,
      ),
      changed: true,
    };
  }

  /**
   * Waits for the controller to cut a release other than `previous`. Release
   * names are content hashes, so any change of the split moves latestRelease.
   */
  private async waitForRelease(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
    previous: string | undefined,
  ): Promise<string | undefined> {
    const deadline = Date.now() + RELEASE_WAIT_MS;
    while (Date.now() < deadline) {
      const current = await this.getEndpoint(
        client,
        namespaceName,
        endpointName,
      );
      const latest = current.status?.latestRelease?.name;
      if (latest && latest !== previous) {
        return latest;
      }
      await sleep(RELEASE_POLL_MS);
    }
    this.logger.warn(
      `Endpoint ${endpointName}: no new release within ${RELEASE_WAIT_MS}ms`,
    );
    return undefined;
  }

  /** PUTs an Endpoint with a new spec. */
  private async putEndpoint(
    client: ApiClient,
    namespaceName: string,
    endpoint: Endpoint,
    spec: NonNullable<Endpoint['spec']>,
  ): Promise<void> {
    const res = await client.PUT(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: { namespaceName, endpointName: endpoint.metadata.name },
        },
        body: { metadata: endpoint.metadata, spec },
      },
    );
    assertApiResponse(res, 'update endpoint');
  }

  /**
   * Replaces an Endpoint's rules, and optionally its backends in the same
   * update, so a strategy (a new backend and its rule) is one release. The
   * controller cuts the release; it reaches an environment when its binding
   * is pinned to it (autoDeploy does that for the first environment).
   */
  async updateEndpointRules(
    request: UpdateEndpointRulesRequest,
    token?: string,
  ): Promise<{ latestRelease?: string; changed: boolean }> {
    const client = this.client(token);
    const endpoint = await this.getEndpoint(
      client,
      request.namespaceName,
      request.endpointName,
    );
    if (request.backends) assertNoRollout(endpoint);
    const refs = endpoint.spec?.backendRefs ?? [];
    const backendRefs = request.backends
      ? applyBackends(refs, request.backends)
      : refs;
    validateRules(
      request.rules,
      backendRefs.map(r => r.name),
    );
    const rules = toApiRules(request.rules);
    const previous = endpoint.status?.latestRelease?.name;
    if (
      JSON.stringify(rules) === JSON.stringify(endpoint.spec?.rules ?? []) &&
      JSON.stringify(backendRefs) === JSON.stringify(refs)
    ) {
      return { latestRelease: previous, changed: false };
    }
    await this.putEndpoint(client, request.namespaceName, endpoint, {
      ...endpoint.spec!,
      backendRefs,
      rules,
    });
    return {
      latestRelease: await this.waitForRelease(
        client,
        request.namespaceName,
        request.endpointName,
        previous,
      ),
      changed: true,
    };
  }

  /**
   * Changes where an Endpoint is reachable from and whether it deploys each
   * release to the first environment. A visibility change cuts a release.
   */
  async updateEndpointSettings(
    request: UpdateEndpointSettingsRequest,
    token?: string,
  ): Promise<{ latestRelease?: string }> {
    const client = this.client(token);
    const endpoint = await this.getEndpoint(
      client,
      request.namespaceName,
      request.endpointName,
    );
    if (request.visibility && request.visibility.length === 0) {
      throw new InputError('An Endpoint needs at least one visibility');
    }
    const previous = endpoint.status?.latestRelease?.name;
    await this.putEndpoint(client, request.namespaceName, endpoint, {
      ...endpoint.spec!,
      ...(request.visibility && { visibility: request.visibility }),
      ...(request.autoDeploy !== undefined && {
        autoDeploy: request.autoDeploy,
      }),
    });
    const visibilityChanged =
      request.visibility &&
      JSON.stringify([...request.visibility].sort()) !==
        JSON.stringify([...(endpoint.spec?.visibility ?? [])].sort());
    return {
      latestRelease: visibilityChanged
        ? await this.waitForRelease(
            client,
            request.namespaceName,
            request.endpointName,
            previous,
          )
        : previous,
    };
  }

  /**
   * Sets an environment's weights on its binding (spec.backendOverrides),
   * which moves that environment's traffic in seconds and cuts no release.
   * Overrides apply to backendRefs and to rules that split between several
   * backends; a single-backend rule, such as a preview header, ignores them.
   * An empty list clears them, so the release's weights apply again.
   *
   * Waits until the binding reports the new effective weights and the data
   * plane has accepted the routes; `applied` is false if that took longer.
   */
  async updateEndpointOverrides(
    request: UpdateEndpointOverridesRequest,
    token?: string,
  ): Promise<{ bindingName: string; applied: boolean }> {
    const client = this.client(token);
    const binding = (
      await this.listBindings(client, request.namespaceName, {
        endpoint: request.endpointName,
        environment: request.environment,
      })
    )[0];
    if (!binding) {
      throw new NotFoundError(
        `Endpoint ${request.endpointName} is not deployed in ${request.environment}; roll a release out there first`,
      );
    }
    const invalid = request.overrides.filter(
      o => !Number.isInteger(o.weight) || o.weight < 0 || o.weight > 1_000_000,
    );
    if (invalid.length > 0) {
      throw new InputError(
        `Weights must be whole numbers from 0 to 1000000: ${invalid
          .map(o => o.name)
          .join(', ')}`,
      );
    }
    const res = await client.PUT(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointReleaseBindingName: binding.metadata.name,
          },
        },
        body: {
          metadata: binding.metadata,
          spec: { ...binding.spec!, backendOverrides: request.overrides },
        },
      },
    );
    assertApiResponse(res, 'update endpoint release binding');

    const wanted = new Map(request.overrides.map(o => [o.name, o.weight]));
    const deadline = Date.now() + OVERRIDES_WAIT_MS;
    while (Date.now() < deadline) {
      const current = (
        await this.listBindings(client, request.namespaceName, {
          endpoint: request.endpointName,
          environment: request.environment,
        })
      )[0];
      const weightsMatch = (current?.status?.backends ?? []).every(
        b => !wanted.has(b.name) || (b.weight ?? 0) === wanted.get(b.name),
      );
      const routesReady = current?.status?.conditions?.some(
        c => c.type === 'RoutesReady' && c.status === 'True',
      );
      if (weightsMatch && routesReady) {
        return { bindingName: binding.metadata.name, applied: true };
      }
      await sleep(RELEASE_POLL_MS);
    }
    return { bindingName: binding.metadata.name, applied: false };
  }

  /**
   * Pins an environment to a release (roll out, promote or roll back).
   * Updates the environment's binding, or creates `<endpoint>-<environment>`
   * when the Endpoint is not routed there yet.
   */
  async updateEndpointReleaseBinding(
    request: UpdateEndpointReleaseBindingRequest & {
      /**
       * The environment's weights to set in the same update, so pinning a
       * release never shows its default split even briefly.
       */
      backendOverrides?: EndpointWeightOverride[];
    },
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
      // An override must name a backend of the pinned release, so drop the
      // ones for backends the new release no longer has (a finished canary
      // or a retired blue). The others keep this environment's weights.
      const overrides = existing.spec?.backendOverrides;
      let backendOverrides = request.backendOverrides ?? overrides;
      if (!request.backendOverrides && overrides?.length) {
        const rel = await client.GET(
          '/api/v1/namespaces/{namespaceName}/endpointreleases/{endpointReleaseName}',
          {
            params: {
              path: {
                namespaceName: request.namespaceName,
                endpointReleaseName: request.releaseName,
              },
            },
          },
        );
        assertApiResponse(rel, 'get endpoint release');
        const names = new Set(
          (rel.data!.spec?.backendRefs ?? []).map(r => r.name),
        );
        backendOverrides = overrides.filter(o => names.has(o.name));
      }
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
            spec: {
              ...existing.spec!,
              endpointRelease: request.releaseName,
              ...(backendOverrides && { backendOverrides }),
            },
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
            ...(request.backendOverrides && {
              backendOverrides: request.backendOverrides,
            }),
          },
        },
      },
    );
    assertApiResponse(res, 'create endpoint release binding');
    return { bindingName, created: true };
  }

  /**
   * Runs `action` for each environment, collecting what happened in each, so
   * one failing environment never hides the others' results.
   */
  private async eachEnvironment(
    environments: string[],
    action: (environment: string) => Promise<unknown>,
  ): Promise<RolloutActionResult['environments']> {
    const results: RolloutActionResult['environments'] = [];
    for (const name of environments) {
      try {
        await action(name);
        results.push({ name, ok: true });
      } catch (err: unknown) {
        results.push({
          name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  /**
   * Starts a rollout: the candidate joins at 0% with the rule its preview
   * needs, recorded in the rollout annotation, in one Endpoint update. Each
   * chosen environment then gets the new release with the candidate at 0%,
   * pinned and weighted in one binding update.
   */
  async startRollout(
    request: StartRolloutRequest,
    token?: string,
    startedBy?: string,
  ): Promise<RolloutActionResult> {
    const client = this.client(token);
    const endpoint = await this.getEndpoint(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const backends = toBackendWeights(endpoint.spec?.backendRefs);
    const rules = toRules(endpoint.spec?.rules);
    const existing = currentRollout(
      endpoint.metadata.annotations,
      backends,
      rules,
    );
    if (existing.source === 'annotation') {
      throw new InputError(
        `A ${existing.rollout!.strategy} rollout to ${
          existing.rollout!.candidate
        } is already running; complete or abandon it first`,
      );
    }
    const planned = planRollout(backends, rules, request.plan, startedBy);
    const backendRefs = applyBackends(
      endpoint.spec?.backendRefs ?? [],
      planned.backends,
    );
    validateRules(
      planned.rules,
      backendRefs.map(r => r.name),
    );
    const previous = endpoint.status?.latestRelease?.name;
    await this.putEndpoint(
      client,
      request.namespaceName,
      {
        ...endpoint,
        metadata: {
          ...endpoint.metadata,
          annotations: {
            ...(endpoint.metadata.annotations ?? {}),
            [ROLLOUT_ANNOTATION]: serializeRollout(planned.rollout),
          },
        },
      },
      { ...endpoint.spec!, backendRefs, rules: toApiRules(planned.rules) },
    );
    const latestRelease = await this.waitForRelease(
      client,
      request.namespaceName,
      request.endpointName,
      previous,
    );
    if (!latestRelease) {
      return { environments: [] };
    }
    const overrides = rolloutWeights(
      planned.rollout,
      backendRefs.map(r => r.name),
      0,
    );
    return {
      latestRelease,
      environments: await this.eachEnvironment(request.environments, env =>
        this.updateEndpointReleaseBinding(
          {
            namespaceName: request.namespaceName,
            projectName: request.projectName,
            endpointName: request.endpointName,
            environment: env,
            releaseName: latestRelease,
            backendOverrides: overrides,
          },
          token,
        ),
      ),
    };
  }

  /** Reads the Endpoint's recorded or detected rollout, or refuses. */
  private async requireRollout(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
  ) {
    const endpoint = await this.getEndpoint(
      client,
      namespaceName,
      endpointName,
    );
    const backends = toBackendWeights(endpoint.spec?.backendRefs);
    const { rollout } = currentRollout(
      endpoint.metadata.annotations,
      backends,
      toRules(endpoint.spec?.rules),
    );
    if (!rollout) {
      throw new InputError(`No rollout is running on ${endpointName}`);
    }
    return { endpoint, rollout, backendNames: backends.map(b => b.name!) };
  }

  /**
   * Moves one environment to a stage of the rollout: the candidate gets
   * `percent` of its traffic, the stable version the rest. No new release.
   */
  async setRolloutStage(
    request: SetRolloutStageRequest,
    token?: string,
  ): Promise<{ bindingName: string; applied: boolean }> {
    if (
      !Number.isInteger(request.percent) ||
      request.percent < 0 ||
      request.percent > 100
    ) {
      throw new InputError('percent must be a whole number from 0 to 100');
    }
    const client = this.client(token);
    const { rollout, backendNames } = await this.requireRollout(
      client,
      request.namespaceName,
      request.endpointName,
    );
    return this.updateEndpointOverrides(
      {
        namespaceName: request.namespaceName,
        endpointName: request.endpointName,
        environment: request.environment,
        overrides: rolloutWeights(rollout, backendNames, request.percent),
      },
      token,
    );
  }

  /**
   * Promotes the rollout to another environment: it gets the source's
   * release with the candidate at 0%, so promoting never moves traffic to
   * the new version by itself.
   */
  async promoteRollout(
    request: PromoteRolloutRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const client = this.client(token);
    const source = (
      await this.listBindings(client, request.namespaceName, {
        endpoint: request.endpointName,
        environment: request.from,
      })
    ).find(b => b.spec?.owner.projectName === request.projectName);
    const release = source?.spec?.endpointRelease;
    if (!release) {
      throw new InputError(
        `${request.endpointName} is not running in ${request.from}`,
      );
    }
    const endpoint = await this.getEndpoint(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const backends = toBackendWeights(endpoint.spec?.backendRefs);
    const { rollout } = currentRollout(
      endpoint.metadata.annotations,
      backends,
      toRules(endpoint.spec?.rules),
    );
    return {
      latestRelease: release,
      environments: await this.eachEnvironment([request.to], env =>
        this.updateEndpointReleaseBinding(
          {
            namespaceName: request.namespaceName,
            projectName: request.projectName,
            endpointName: request.endpointName,
            environment: env,
            releaseName: release,
            ...(rollout && {
              backendOverrides: rolloutWeights(
                rollout,
                backends.map(b => b.name!),
                0,
              ),
            }),
          },
          token,
        ),
      ),
    };
  }

  /**
   * Finishes the rollout. Complete keeps the candidate and is allowed once
   * every environment sends it all traffic; abandon keeps the stable
   * version, which only moves traffic back. Either way the Endpoint keeps
   * one version, the annotation goes, and every environment running the
   * Endpoint gets the new release.
   */
  async finishRollout(
    request: FinishRolloutRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const client = this.client(token);
    const { endpoint, rollout } = await this.requireRollout(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const bindings = (
      await this.listBindings(client, request.namespaceName, {
        endpoint: request.endpointName,
      })
    ).filter(
      b =>
        b.spec?.owner.projectName === request.projectName &&
        b.spec.endpointRelease,
    );
    if (request.outcome === 'complete') {
      const behind = bindings.filter(b => {
        const pos = rolloutPosition(
          rollout,
          Object.fromEntries(
            toBackendStatuses(b).map(x => [
              x.name ?? x.componentName,
              x.weight,
            ]),
          ),
        );
        return pos.percent !== 100;
      });
      if (behind.length > 0) {
        throw new InputError(
          `Send all traffic to ${rollout.candidate} in ${behind
            .map(b => b.spec!.environment)
            .join(', ')} before completing`,
        );
      }
    }
    // Complete swaps the replaced version for the new one and leaves the
    // untouched backends as they are; abandon puts back the split the
    // Endpoint had when the rollout started.
    const keep =
      request.outcome === 'complete'
        ? completeSplit(rollout)
        : stableSplit(rollout);
    const change = finishStrategy(
      toBackendWeights(endpoint.spec?.backendRefs),
      toRules(endpoint.spec?.rules),
      keep,
    );
    const kept = new Set(keep.map(k => k.name));
    const backendRefs = applyBackends(
      (endpoint.spec?.backendRefs ?? []).map(r =>
        kept.has(r.name) ? r : { ...r, weight: 0 },
      ),
      change.backends,
    );
    const annotations = { ...(endpoint.metadata.annotations ?? {}) };
    delete annotations[ROLLOUT_ANNOTATION];
    const previous = endpoint.status?.latestRelease?.name;
    await this.putEndpoint(
      client,
      request.namespaceName,
      { ...endpoint, metadata: { ...endpoint.metadata, annotations } },
      { ...endpoint.spec!, backendRefs, rules: toApiRules(change.rules) },
    );
    const latestRelease = await this.waitForRelease(
      client,
      request.namespaceName,
      request.endpointName,
      previous,
    );
    if (!latestRelease) {
      return { environments: [] };
    }
    return {
      latestRelease,
      environments: await this.eachEnvironment(
        bindings.map(b => b.spec!.environment),
        env =>
          this.updateEndpointReleaseBinding(
            {
              namespaceName: request.namespaceName,
              projectName: request.projectName,
              endpointName: request.endpointName,
              environment: env,
              releaseName: latestRelease,
              backendOverrides: [],
            },
            token,
          ),
      ),
    };
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

  /**
   * Deletes an Endpoint. Its finalizer hands each environment's URL back to
   * the component routes, then removes its bindings and releases.
   */
  async deleteEndpoint(
    request: { namespaceName: string; endpointName: string },
    token?: string,
  ): Promise<{ endpointName: string }> {
    const res = await this.client(token).DELETE(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
      },
    );
    assertApiResponse(res, 'delete endpoint');
    return { endpointName: request.endpointName };
  }

  /**
   * Deletes an old release from an Endpoint's history. openchoreo-api refuses
   * (409) a release an environment pins or that is the latest release.
   */
  async deleteEndpointRelease(
    request: { namespaceName: string; releaseName: string },
    token?: string,
  ): Promise<{ releaseName: string }> {
    const res = await this.client(token).DELETE(
      '/api/v1/namespaces/{namespaceName}/endpointreleases/{endpointReleaseName}',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointReleaseName: request.releaseName,
          },
        },
      },
    );
    assertApiResponse(res, 'delete endpoint release');
    return { releaseName: request.releaseName };
  }

  /** Reads a (Cluster)EndpointType for its catalog page. */
  async fetchEndpointType(
    request: {
      kind: 'EndpointType' | 'ClusterEndpointType';
      name: string;
      namespaceName?: string;
    },
    token?: string,
  ): Promise<EndpointTypeDetails> {
    const client = this.client(token);
    let spec: OpenChoreoComponents['schemas']['EndpointTypeSpec'] | undefined;
    if (request.kind === 'ClusterEndpointType') {
      const res = await client.GET('/api/v1/clusterendpointtypes/{cetName}', {
        params: { path: { cetName: request.name } },
      });
      assertApiResponse(res, 'get cluster endpoint type');
      spec = res.data!.spec;
    } else {
      if (!request.namespaceName) {
        throw new InputError('namespaceName is required for an EndpointType');
      }
      const res = await client.GET(
        '/api/v1/namespaces/{namespaceName}/endpointtypes/{etName}',
        {
          params: {
            path: {
              namespaceName: request.namespaceName,
              etName: request.name,
            },
          },
        },
      );
      assertApiResponse(res, 'get endpoint type');
      spec = res.data!.spec;
    }
    return {
      kind: request.kind,
      name: request.name,
      resources: (spec?.resources ?? []).map(r => ({
        id: r.id,
        targetPlane: r.targetPlane,
        templateKind: (r.template as { kind?: string } | undefined)?.kind,
        includeWhen: r.includeWhen,
        forEach: r.forEach,
      })),
      parametersSchema: spec?.parameters?.openAPIV3Schema,
      environmentConfigsSchema: spec?.environmentConfigs?.openAPIV3Schema,
    };
  }
}

/**
 * Refuses changing an Endpoint's backends while the portal runs a rollout
 * on it: the rollout's steps and its abandon depend on them.
 */
function assertNoRollout(endpoint: {
  metadata: { annotations?: Record<string, string> };
}) {
  const rollout = parseRollout(endpoint.metadata.annotations);
  if (rollout) {
    throw new InputError(
      `Finish or abandon the rollout to ${rollout.candidate} before changing the Endpoint's versions`,
    );
  }
}
