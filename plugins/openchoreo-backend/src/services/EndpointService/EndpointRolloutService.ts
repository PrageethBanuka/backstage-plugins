import { LoggerService } from '@backstage/backend-plugin-api';
import { InputError, NotFoundError } from '@backstage/errors';
import {
  createOpenChoreoApiClient,
  assertApiResponse,
  fetchAllPages,
  type OpenChoreoComponents,
} from '@openchoreo/openchoreo-client-node';
import {
  CHOREO_LABELS,
  audienceProblem,
  endpointManagingComponent,
  convertToCanary,
  fromSpecRollout,
  planRollout,
  reconfigureRollout,
  rolloutStages,
  rolloutWeights,
  toSpecRollout,
  type ConvertRolloutRequest,
  type DeployEndpointReleaseRequest,
  type EndpointCapability,
  type EndpointRollout,
  type EndpointRolloutInfo,
  type EndpointWeightOverride,
  type FinishRolloutRequest,
  type RolloutActionResult,
  type RolloutPosition,
  type SetRolloutStageRequest,
  type StartRolloutRequest,
  type UpdateRolloutSettingsRequest,
  type UpdateEndpointOverridesRequest,
} from '@openchoreo/backstage-plugin-common';
import {
  applyBackends,
  toBackendWeights,
  toOverrides,
  validateMatches,
} from './endpointRolloutRefs';

type Endpoint = OpenChoreoComponents['schemas']['Endpoint'];
type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];
type ApiClient = ReturnType<typeof createOpenChoreoApiClient>;

const RELEASE_WAIT_MS = 10_000;
const POLL_MS = 500;
const OVERRIDES_WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Where an environment stands in the portal's stages. Blue/green and A/B
 * reach their second stage by weights rather than an openchoreo-api step
 * (switching everyone, shipping to everyone), so 0% and 100% are their two
 * stages, not weights set by hand.
 */
function position(
  rollout: EndpointRollout,
  step: number,
  percents: Record<string, number> | undefined,
): RolloutPosition {
  const percent = percents?.[rollout.candidate] ?? 0;
  const twoStages =
    rollout.strategy === 'blueGreen' || rollout.strategy === 'abTest';
  const index =
    step < 0 && twoStages
      ? rolloutStages(rollout).findIndex(s => s.percent === percent)
      : step;
  return { index, percent, manual: index < 0 };
}

/**
 * The Endpoint's labels once it routes to `backendRefs`. A component's
 * Endpoint that now routes to another component belongs to its project, so
 * the labels naming its source component go, as when a backend is added on
 * the Set up pane. A release line of the same component keeps them.
 */
function projectLabels(
  endpoint: Endpoint,
  backendRefs: NonNullable<Endpoint['spec']>['backendRefs'],
): Record<string, string> | undefined {
  const labels = endpoint.metadata.labels;
  const owner = endpointManagingComponent({
    labels,
    backendRefs: endpoint.spec?.backendRefs,
  });
  if (!owner || endpointManagingComponent({ labels, backendRefs })) {
    return labels;
  }
  const {
    [CHOREO_LABELS.ENDPOINT_SOURCE_COMPONENT]: _component,
    [CHOREO_LABELS.ENDPOINT_SOURCE_ENDPOINT]: _endpoint,
    [CHOREO_LABELS.ENDPOINT_SOURCE_RELEASE_LINE]: _line,
    ...rest
  } = labels ?? {};
  return rest;
}

/**
 * Progressive delivery on Endpoints. The rollout plan lives in the
 * Endpoint's spec.rollout and openchoreo-api carries it out: this service
 * maps the portal's calls onto its rollout operations, and sets hand-picked
 * weights on an environment's binding. All calls use the caller's token;
 * openchoreo-api enforces authorization.
 */
export class EndpointRolloutService {
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

  private async listBindings(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
    projectName?: string,
  ): Promise<EndpointReleaseBinding[]> {
    const bindings = await fetchAllPages(cursor =>
      client
        .GET('/api/v1/namespaces/{namespaceName}/endpointreleasebindings', {
          params: {
            path: { namespaceName },
            query: { endpoint: endpointName, limit: 100, cursor },
          },
        })
        .then(res => {
          assertApiResponse(res, 'list endpoint release bindings');
          return res.data!;
        }),
    );
    return bindings.filter(
      b => !projectName || b.spec?.owner.projectName === projectName,
    );
  }

  private async findBinding(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
    environment: string,
    projectName?: string,
  ): Promise<EndpointReleaseBinding | undefined> {
    return (
      await this.listBindings(client, namespaceName, endpointName, projectName)
    ).find(b => b.spec?.environment === environment);
  }

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
      await sleep(POLL_MS);
    }
    this.logger.warn(
      `Endpoint ${endpointName}: no new release within ${RELEASE_WAIT_MS}ms`,
    );
    return undefined;
  }

  private async rolloutStatus(
    client: ApiClient,
    namespaceName: string,
    endpointName: string,
  ) {
    const res = await client.GET(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}/rollout',
      { params: { path: { namespaceName, endpointName } } },
    );
    assertApiResponse(res, 'get endpoint rollout');
    return res.data!;
  }

  /**
   * The routing features the Endpoint's type renders, or undefined when it
   * declares none or can't be read; openchoreo-api still refuses a rollout
   * the type can't render.
   */
  private async typeCapabilities(
    client: ApiClient,
    namespaceName: string,
    endpoint: Endpoint,
  ): Promise<EndpointCapability[] | undefined> {
    const ref = endpoint.spec?.type;
    if (!ref?.name) return undefined;
    try {
      const res =
        ref.kind === 'ClusterEndpointType'
          ? await client.GET('/api/v1/clusterendpointtypes/{cetName}', {
              params: { path: { cetName: ref.name } },
            })
          : await client.GET(
              '/api/v1/namespaces/{namespaceName}/endpointtypes/{etName}',
              { params: { path: { namespaceName, etName: ref.name } } },
            );
      const capabilities = res.response.ok
        ? res.data?.spec?.capabilities
        : undefined;
      return capabilities?.length ? capabilities : undefined;
    } catch (err: unknown) {
      this.logger.debug(
        `Endpoint ${endpoint.metadata.name}: couldn't read its type: ${err}`,
      );
      return undefined;
    }
  }

  /** The Endpoint's backends with their matches and mirrors, its plan and each environment. */
  async fetchEndpointRollout(
    namespaceName: string,
    endpointName: string,
    token?: string,
  ): Promise<EndpointRolloutInfo> {
    const client = this.client(token);
    const endpoint = await this.getEndpoint(
      client,
      namespaceName,
      endpointName,
    );
    const status = await this.rolloutStatus(
      client,
      namespaceName,
      endpointName,
    );
    const backends = toBackendWeights(endpoint.spec?.backendRefs);
    const rollout = endpoint.spec?.rollout
      ? fromSpecRollout(endpoint.spec.rollout, backends)
      : undefined;
    const [bindings, capabilities] = await Promise.all([
      this.listBindings(
        client,
        namespaceName,
        endpointName,
        endpoint.spec?.owner.projectName,
      ),
      this.typeCapabilities(client, namespaceName, endpoint),
    ]);
    return {
      backends,
      rollout,
      rolloutSource: rollout ? 'plan' : 'none',
      ...(endpoint.spec?.type?.name && { typeName: endpoint.spec.type.name }),
      ...(capabilities && { capabilities }),
      environments: bindings.map(b => {
        const env = status.environments.find(
          e => e.environment === b.spec!.environment,
        );
        return {
          environment: b.spec!.environment,
          bindingName: b.metadata.name,
          endpointRelease: b.spec?.endpointRelease,
          overrides: toOverrides(b),
          backends: (b.status?.backends ?? []).map(x => ({
            name: x.name,
            weight: x.weight ?? 0,
            ...(x.mirror && { mirror: { percent: x.mirror.percent } }),
            resolved: x.resolved,
            ...(x.reason && { reason: x.reason }),
          })),
          ...(rollout &&
            env?.step !== undefined && {
              rollout: position(rollout, env.step, env.percents),
            }),
        };
      }),
    };
  }

  /**
   * Sets one environment's weights and mirror shares on its binding, without
   * cutting a release, and waits briefly for the data plane to take them.
   */
  async updateEndpointOverrides(
    request: UpdateEndpointOverridesRequest,
    token?: string,
  ): Promise<{ bindingName: string; applied: boolean }> {
    const client = this.client(token);
    const binding = await this.findBinding(
      client,
      request.namespaceName,
      request.endpointName,
      request.environment,
    );
    if (!binding) {
      throw new NotFoundError(
        `Endpoint ${request.endpointName} is not deployed in ${request.environment}; deploy a release there first`,
      );
    }
    const badWeight = request.overrides.filter(
      o =>
        o.weight !== undefined &&
        (!Number.isInteger(o.weight) || o.weight < 0 || o.weight > 1_000_000),
    );
    if (badWeight.length > 0) {
      throw new InputError(
        `Weights must be whole numbers from 0 to 1000000: ${badWeight
          .map(o => o.name)
          .join(', ')}`,
      );
    }
    const badMirror = request.overrides.filter(
      o =>
        o.mirror &&
        (!Number.isInteger(o.mirror.percent) ||
          o.mirror.percent < 0 ||
          o.mirror.percent > 100),
    );
    if (badMirror.length > 0) {
      throw new InputError(
        `Mirror shares must be whole numbers from 0 to 100: ${badMirror
          .map(o => o.name)
          .join(', ')}`,
      );
    }
    if (request.overrides.some(o => o.weight === undefined && !o.mirror)) {
      throw new InputError('Each override needs a weight or a mirror');
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
    return this.waitApplied(client, request, binding.metadata.name);
  }

  /** Waits briefly for an environment's binding to serve the given overrides. */
  private async waitApplied(
    client: ApiClient,
    request: {
      namespaceName: string;
      endpointName: string;
      environment: string;
      overrides: EndpointWeightOverride[];
    },
    bindingName: string,
  ): Promise<{ bindingName: string; applied: boolean }> {
    const wanted = new Map(
      request.overrides
        .filter(o => o.weight !== undefined)
        .map(o => [o.name, o.weight!]),
    );
    const wantedMirror = new Map(
      request.overrides
        .filter(o => o.mirror)
        .map(o => [o.name, o.mirror!.percent]),
    );
    const deadline = Date.now() + OVERRIDES_WAIT_MS;
    while (Date.now() < deadline) {
      const res = await client.GET(
        '/api/v1/namespaces/{namespaceName}/endpointreleasebindings/{endpointReleaseBindingName}',
        {
          params: {
            path: {
              namespaceName: request.namespaceName,
              endpointReleaseBindingName: bindingName,
            },
          },
        },
      );
      const current = res.response.ok ? res.data : undefined;
      const weightsMatch = (current?.status?.backends ?? []).every(
        b =>
          (!wanted.has(b.name) || (b.weight ?? 0) === wanted.get(b.name)) &&
          (!wantedMirror.has(b.name) ||
            (b.mirror?.percent ?? 0) === wantedMirror.get(b.name)),
      );
      const resourcesReady = current?.status?.conditions?.some(
        c => c.type === 'ResourcesReady' && c.status === 'True',
      );
      if (weightsMatch && resourcesReady) {
        return { bindingName, applied: true };
      }
      await sleep(POLL_MS);
    }
    return { bindingName, applied: false };
  }

  /**
   * Pins a release in an environment and sets its weights in the same
   * update, creating the binding when the environment has none.
   */
  private async pinRelease(
    client: ApiClient,
    request: {
      namespaceName: string;
      projectName: string;
      endpointName: string;
      environment: string;
      releaseName: string;
      backendOverrides: EndpointWeightOverride[];
    },
  ): Promise<void> {
    const existing = await this.findBinding(
      client,
      request.namespaceName,
      request.endpointName,
      request.environment,
      request.projectName,
    );
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
            spec: {
              ...existing.spec!,
              endpointRelease: request.releaseName,
              backendOverrides: request.backendOverrides,
            },
          },
        },
      );
      assertApiResponse(res, 'update endpoint release binding');
      return;
    }
    const res = await client.POST(
      '/api/v1/namespaces/{namespaceName}/endpointreleasebindings',
      {
        params: { path: { namespaceName: request.namespaceName } },
        body: {
          metadata: { name: `${request.endpointName}-${request.environment}` },
          spec: {
            owner: {
              projectName: request.projectName,
              endpointName: request.endpointName,
            },
            environment: request.environment,
            endpointRelease: request.releaseName,
            backendOverrides: request.backendOverrides,
          },
        },
      },
    );
    assertApiResponse(res, 'create endpoint release binding');
  }

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
    if (!endpoint.spec?.rollout) {
      throw new InputError(`${endpointName} has no rollout plan`);
    }
    return {
      endpoint,
      backends,
      rollout: fromSpecRollout(endpoint.spec.rollout, backends),
    };
  }

  /** Writes an Endpoint change and waits for the release it cuts. */
  private async writeEndpoint(
    client: ApiClient,
    namespaceName: string,
    endpoint: Endpoint,
    spec: NonNullable<Endpoint['spec']>,
  ): Promise<RolloutActionResult> {
    const previous = endpoint.status?.latestRelease?.name;
    await this.putEndpoint(client, namespaceName, endpoint, spec);
    const latestRelease = await this.waitForRelease(
      client,
      namespaceName,
      endpoint.metadata.name,
      previous,
    );
    return { ...(latestRelease && { latestRelease }), environments: [] };
  }

  /**
   * Starts a rollout: openchoreo-api writes the plan and the candidate,
   * which joins at weight 0 with the match or mirror its strategy needs, in
   * one Endpoint update. Each environment starts with the candidate at 0%.
   */
  async startRollout(
    request: StartRolloutRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const problem = audienceProblem(request.plan.preview?.audience);
    if (problem) throw new InputError(problem);
    const client = this.client(token);
    const endpoint = await this.getEndpoint(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const planned = planRollout(
      toBackendWeights(endpoint.spec?.backendRefs),
      request.plan,
    );
    validateMatches(planned.backends);
    const backendRefs = applyBackends(
      endpoint.spec?.backendRefs ?? [],
      planned.backends,
      { reach: true },
    );
    const labels = projectLabels(endpoint, backendRefs);
    if (labels !== endpoint.metadata.labels) {
      await this.putEndpoint(
        client,
        request.namespaceName,
        { ...endpoint, metadata: { ...endpoint.metadata, labels } },
        endpoint.spec!,
      );
    }
    const previous = endpoint.status?.latestRelease?.name;
    const res = await client.POST(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}/rollout/start',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
        body: {
          rollout: toSpecRollout(planned.rollout),
          backends: backendRefs,
        },
      },
    );
    assertApiResponse(res, 'start endpoint rollout');
    const latestRelease = await this.waitForRelease(
      client,
      request.namespaceName,
      request.endpointName,
      previous,
    );
    return { ...(latestRelease && { latestRelease }), environments: [] };
  }

  /**
   * Moves one environment to the stage where the candidate gets `percent`,
   * through openchoreo-api's step. A share that is no step of the plan, such
   * as shipping an A/B test, is set on the binding as weights instead.
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
    const { rollout, backends } = await this.requireRollout(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const status = await this.rolloutStatus(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const to = (status.stages ?? []).findIndex(stage =>
      stage.backends.every(
        b => b.percent === (b.name === rollout.candidate ? request.percent : 0),
      ),
    );
    if (to < 0) {
      return this.updateEndpointOverrides(
        {
          namespaceName: request.namespaceName,
          endpointName: request.endpointName,
          environment: request.environment,
          overrides: rolloutWeights(
            rollout,
            backends.map(b => b.name!),
            request.percent,
          ),
        },
        token,
      );
    }
    const res = await client.POST(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}/rollout/step',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
        body: { environment: request.environment, to },
      },
    );
    assertApiResponse(res, 'step endpoint rollout');
    const env = res.data!.environments.find(
      e => e.environment === request.environment,
    );
    return this.waitApplied(
      client,
      {
        namespaceName: request.namespaceName,
        endpointName: request.endpointName,
        environment: request.environment,
        overrides: res.data!.change?.after ?? [],
      },
      env?.bindingName ?? '',
    );
  }

  /**
   * Changes how the new version is reached and the plan's steps. Steps
   * alone only edit spec.rollout, which cuts no release; a new match or
   * mirror for the new version does.
   */
  async updateRolloutSettings(
    request: UpdateRolloutSettingsRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const problem = audienceProblem(request.settings.preview?.audience);
    if (problem) throw new InputError(problem);
    const client = this.client(token);
    const { endpoint, backends, rollout } = await this.requireRollout(
      client,
      request.namespaceName,
      request.endpointName,
    );
    const next = reconfigureRollout(backends, rollout, request.settings);
    validateMatches(next.backends);
    const spec = {
      ...endpoint.spec!,
      rollout: toSpecRollout(next.rollout),
      ...(next.releaseChanged && {
        backendRefs: applyBackends(
          endpoint.spec?.backendRefs ?? [],
          next.backends,
          { reach: true },
        ),
      }),
    };
    if (!next.releaseChanged) {
      await this.putEndpoint(client, request.namespaceName, endpoint, spec);
      return { environments: [] };
    }
    return this.writeEndpoint(client, request.namespaceName, endpoint, spec);
  }

  /**
   * Finishes the rollout through openchoreo-api: complete keeps the
   * candidate, abandon keeps stable. It refuses while a backend that leaves
   * still gets traffic in an environment.
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
    const previous = endpoint.status?.latestRelease?.name;
    const res = await client.POST(
      '/api/v1/namespaces/{namespaceName}/endpoints/{endpointName}/rollout/finish',
      {
        params: {
          path: {
            namespaceName: request.namespaceName,
            endpointName: request.endpointName,
          },
        },
        body: {
          keep:
            request.outcome === 'complete' ? rollout.candidate : rollout.stable,
        },
      },
    );
    assertApiResponse(res, 'finish endpoint rollout');
    const latestRelease = await this.waitForRelease(
      client,
      request.namespaceName,
      request.endpointName,
      previous,
    );
    return { ...(latestRelease && { latestRelease }), environments: [] };
  }

  /**
   * Deploys a release to an environment with the binding's overrides kept
   * only while they still fit it. Overrides are weights for one set of
   * backends; once the release removes one of them (a finished rollout),
   * they all go and the release's own weights apply, as they do when the
   * overrides would leave every backend at weight 0. Otherwise the version
   * that stays could keep a weight of 0, e.g. blue after a blue/green
   * switch, and get no traffic.
   */
  async deployRelease(
    request: DeployEndpointReleaseRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const client = this.client(token);
    const res = await client.GET(
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
    assertApiResponse(res, 'fetch endpoint release');
    const refs = new Map(
      (res.data.spec?.backendRefs ?? []).map(r => [r.name, r]),
    );
    const binding = await this.findBinding(
      client,
      request.namespaceName,
      request.endpointName,
      request.environment,
      request.projectName,
    );
    const current = binding?.spec?.backendOverrides ?? [];
    const weightOf = (name: string) =>
      current.find(o => o.name === name)?.weight ?? refs.get(name)?.weight ?? 1;
    const fits =
      current.every(o => refs.has(o.name)) &&
      [...refs.keys()].some(name => weightOf(name) > 0);
    const backendOverrides = fits
      ? current
          .map(({ mirror, ...o }) =>
            mirror && refs.get(o.name)?.mirror ? { ...o, mirror } : o,
          )
          .filter(o => o.weight !== undefined || 'mirror' in o)
      : [];
    return {
      latestRelease: request.releaseName,
      environments: await this.eachEnvironment([request.environment], env =>
        this.pinRelease(client, {
          namespaceName: request.namespaceName,
          projectName: request.projectName,
          endpointName: request.endpointName,
          environment: env,
          releaseName: request.releaseName,
          backendOverrides,
        }),
      ),
    };
  }

  /**
   * Turns a mirror rollout into a canary on the same backend: the mirror
   * goes, the testers header becomes its match and the plan becomes a
   * canary, in one Endpoint change. Its release starts the canary at 0%.
   */
  async convertRollout(
    request: ConvertRolloutRequest,
    token?: string,
  ): Promise<RolloutActionResult> {
    const client = this.client(token);
    const { endpoint, backends, rollout } = await this.requireRollout(
      client,
      request.namespaceName,
      request.endpointName,
    );
    if (rollout.strategy !== 'mirror') {
      throw new InputError(
        `${request.endpointName} is running a ${rollout.strategy} rollout, not a mirror`,
      );
    }
    const converted = convertToCanary(
      backends,
      rollout,
      request.testerHeader,
      request.steps,
    );
    validateMatches(converted.backends);
    return this.writeEndpoint(client, request.namespaceName, endpoint, {
      ...endpoint.spec!,
      backendRefs: applyBackends(
        endpoint.spec?.backendRefs ?? [],
        converted.backends,
        { reach: true },
      ),
      rollout: toSpecRollout(converted.rollout),
    });
  }
}
