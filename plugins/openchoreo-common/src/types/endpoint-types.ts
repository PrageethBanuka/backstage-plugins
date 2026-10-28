/**
 * BFF wire types for Endpoints: traffic routing across a project's
 * components. Shared by openchoreo-backend (producer) and the openchoreo
 * frontend plugin (consumer) so the two sides cannot drift.
 */

/**
 * How an Endpoint is routing traffic in one environment, derived from the
 * EndpointReleaseBinding conditions.
 *
 * - `Routing`: the pinned release's routes are accepted and serving.
 * - `Applying`: the routes were rendered and are waiting for the gateway.
 * - `BackendsUnresolved`: a weighted backend is not deployed in the
 *   environment; the previously accepted routes keep serving.
 * - `Failed`: the release could not be rendered or applied.
 * - `Releasing`: the binding is being removed; component routes are taking
 *   traffic back.
 * - `NotRouted`: no binding, or no release pinned yet.
 */
export type EndpointRoutingStatus =
  | 'Routing'
  | 'Applying'
  | 'BackendsUnresolved'
  | 'Failed'
  | 'Releasing'
  | 'NotRouted';

/** One backend of an Endpoint and its relative weight. */
export interface EndpointBackendWeight {
  /** The backend Component. */
  componentName: string;
  /** Workload endpoint name on the component. */
  endpoint: string;
  weight: number;
  /** The backend's name in the Endpoint (Endpoint.spec.backendRefs[].name). */
  name?: string;
  /**
   * Requests that meet all of these conditions go to this backend, whatever
   * the weights (Endpoint.spec.backendRefs[].match).
   */
  match?: EndpointBackendMatch;
  /** This backend gets a copy of a share of the weighted traffic. */
  mirror?: EndpointMirror;
}

/** Where an Endpoint is reachable from (Endpoint.spec.visibility). */
export type EndpointVisibility = 'namespace' | 'internal' | 'external';

/** A header condition of a backend's match. */
export interface EndpointHeaderMatch {
  name: string;
  type?: 'Exact' | 'RegularExpression';
  value: string;
}

/** An exact cookie condition of a backend's match. */
export interface EndpointNameValueMatch {
  name: string;
  value: string;
}

/**
 * The conditions a request must all meet to go to a backend, whatever the
 * weights. The path is relative to where the Endpoint is served.
 */
export interface EndpointBackendMatch {
  path?: { type?: 'PathPrefix' | 'Exact'; value: string };
  headers?: EndpointHeaderMatch[];
  /** At most one cookie. */
  cookies?: EndpointNameValueMatch[];
}

/** A copy of a share of the weighted traffic, for a backend at weight 0. */
export interface EndpointMirror {
  percent: number;
}

/** The strategies a rollout can run. */
export type RolloutStrategy = 'canary' | 'blueGreen' | 'abTest' | 'mirror';

/** How a person reaches the new backend before it gets traffic. */
export interface RolloutPreview {
  kind: 'header' | 'cookie' | 'path';
  name: string;
  value: string;
  /**
   * A/B only: a header the request must also carry, e.g. X-Client: ios or
   * a User-Agent pattern. Takes precedence over mobileOnly.
   */
  audience?: EndpointHeaderMatch;
  /** A/B only, from before audience: the cookie group must be on a phone. */
  mobileOnly?: boolean;
}

/**
 * The rollout running on an Endpoint: moving traffic from `stable` to
 * `candidate` (backend names) through `steps`, the candidate's share at each
 * stage after the first. Recorded on the Endpoint as an annotation so the
 * portal can show the stage and the next step after a reload.
 */
export interface EndpointRollout {
  strategy: RolloutStrategy;
  stable: string;
  candidate: string;
  /**
   * The Endpoint's other backends and their weights when the rollout
   * started. The candidate takes its share from `stable` only; the rest
   * keep their weights, and abandoning restores the whole split. Absent on
   * rollouts started before it was recorded: `stable` alone then.
   */
  baseline?: EndpointWeightOverride[];
  /** The candidate's percent at each stage after the first (which is 0). */
  steps: number[];
  preview?: RolloutPreview;
  startedAt?: string;
  startedBy?: string;
}

/** Where an environment stands in a rollout. */
export interface RolloutPosition {
  /** Index into rolloutStages; -1 when the weights match no stage. */
  index: number;
  /** The candidate's share of traffic there, 0 to 100, rounded. */
  percent: number;
  /** True when the weights were set by hand and match no stage. */
  manual: boolean;
}

/** What to start: the strategy, the new backend and its preview. */
export interface RolloutPlan {
  strategy: RolloutStrategy;
  candidate: { componentName: string; endpoint: string };
  /** Canary only; defaults to 5, 25, 50, 100. */
  steps?: number[];
  preview?: RolloutPreview;
  /** Mirror only: the share of traffic to copy; defaults to 100. */
  mirrorPercent?: number;
  /**
   * The backend the new version replaces; defaults to the one with the most
   * traffic. Other backends keep their weights.
   */
  replaces?: string;
}

/**
 * A per-environment value on an EndpointReleaseBinding: a backend's weight,
 * or a mirror backend's copy share.
 */
export interface EndpointWeightOverride {
  /** The backend's name in the Endpoint. */
  name: string;
  weight?: number;
  mirror?: EndpointMirror;
}

/**
 * A project component that can be picked when creating an Endpoint, with the
 * workload endpoints it has deployed.
 */
export interface EndpointCandidate {
  componentName: string;
  endpoints: Array<{
    /** Workload endpoint name. */
    name: string;
    /** Workload endpoint protocol, e.g. HTTP. */
    protocol?: string;
    /** Environments the component is deployed in with this endpoint. */
    environments: string[];
    /** External URL in the first of those environments, if exposed. */
    externalURL?: string;
    /** Endpoints that already route this workload endpoint, and where. */
    routedBy?: Array<{
      endpointName: string;
      visibility: EndpointVisibility[];
    }>;
  }>;
}

/** A backend as resolved in one environment. */
export interface EndpointBackendStatus extends EndpointBackendWeight {
  resolved: boolean;
  /** Why the backend could not be resolved. */
  reason?: string;
}

/** An environment an Endpoint is bound to, as shown in the Endpoints list. */
export interface EndpointEnvironmentSummary {
  environment: string;
  bindingName: string;
  endpointRelease?: string;
  status: EndpointRoutingStatus;
  invokeURL?: string;
}

/** One Endpoint of a project, for the Endpoints list. */
export interface EndpointSummary {
  name: string;
  namespaceName: string;
  projectName: string;
  type: { kind: string; name: string };
  /** Where the Endpoint is reachable from. */
  visibility: EndpointVisibility[];
  /** Whether each new release is bound to the pipeline's first environment. */
  autoDeploy: boolean;
  /** The latest backends, with their matches and mirrors (spec.backendRefs). */
  backends: EndpointBackendWeight[];
  /** The rollout running on the Endpoint, if any. */
  rollout?: EndpointRollout;
  /**
   * Where `rollout` comes from: recorded by the portal, detected from the
   * backends, or none running.
   */
  rolloutSource: 'annotation' | 'detected' | 'none';
  latestRelease?: string;
  /**
   * Why the Endpoint is degraded and can't cut a release, e.g. a backend with
   * traffic whose component no longer exists. Undefined when it is healthy.
   */
  problem?: string;
  /** Environments with a binding; unbound environments are omitted. */
  environments: EndpointEnvironmentSummary[];
}

/**
 * Per-environment view of one Endpoint. One entry per environment of the
 * project's deployment pipeline, including environments without a binding.
 */
export interface EndpointEnvironment {
  /** Environment resource name. */
  name: string;
  displayName: string;
  isProduction: boolean;
  bindingName?: string;
  /** Release pinned by the binding. */
  endpointRelease?: string;
  /**
   * Release whose routes were last accepted on the data plane. It differs
   * from `endpointRelease` while a newer pin is still applying or blocked.
   */
  servingRelease?: string;
  /** Endpoint.status.latestRelease, repeated for convenience. */
  latestRelease?: string;
  status: EndpointRoutingStatus;
  statusReason?: string;
  statusMessage?: string;
  invokeURL?: string;
  /** Backends of the pinned release as resolved in this environment. */
  backends: EndpointBackendStatus[];
  /** The binding's per-environment values (spec.backendOverrides). */
  overrides: EndpointWeightOverride[];
  /** Where this environment stands in the Endpoint's rollout, if any. */
  rollout?: RolloutPosition;
  /**
   * The Endpoint's backends that are deployed in this environment, as
   * `component/endpoint` keys. A release can only route here when every
   * backend it weights above 0 is in this list.
   */
  deployedBackends: string[];
  /** Environments this one promotes to in the deployment pipeline. */
  promotionTargets: { name: string }[];
}

/** An EndpointRelease, for the release history and rollback. */
export interface EndpointReleaseSummary {
  name: string;
  createdAt?: string;
  backends: EndpointBackendWeight[];
}

/** One Endpoint routing to a component in one environment (Traffic card). */
export interface ComponentTrafficEntry {
  endpointName: string;
  environment: string;
  status: EndpointRoutingStatus;
  /** This component's weight and the total, from the binding's live backends. */
  weight: number;
  totalWeight: number;
  /** This component's share of the Endpoint's traffic, 0-100, rounded. */
  sharePercent: number;
  /**
   * Whether the release has backends other than this component. A component
   * with weight above 0 next to other backends can't be deleted until its
   * traffic is moved (StillRouted); the only backend can.
   */
  hasOtherBackends: boolean;
  invokeURL?: string;
}

/** A (Cluster)EndpointType, for its catalog page. Read-only. */
export interface EndpointTypeDetails {
  kind: 'EndpointType' | 'ClusterEndpointType';
  name: string;
  /** The resources the type renders for each Endpoint, e.g. an HTTPRoute. */
  resources: Array<{
    id: string;
    targetPlane: string;
    /** Kind of the rendered resource template, e.g. HTTPRoute. */
    templateKind?: string;
    includeWhen?: string;
    forEach?: string;
  }>;
  /** JSON Schema of the Endpoint's spec.parameters. */
  parametersSchema?: Record<string, unknown>;
  /** JSON Schema of per-environment configuration on the binding. */
  environmentConfigsSchema?: Record<string, unknown>;
}

/** Request body of PUT /update-endpoint-traffic. */
export interface UpdateEndpointTrafficRequest {
  namespaceName: string;
  endpointName: string;
  backends: EndpointBackendWeight[];
  /**
   * When true, `backends` is the Endpoint's full set: backends not listed are
   * removed (only allowed at weight 0) and new ones are added. When false or
   * omitted, only the weights of the listed existing backends change.
   */
  replaceBackends?: boolean;
}

/** Request body of PUT /update-endpoint-release-binding. */
export interface UpdateEndpointReleaseBindingRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  environment: string;
  releaseName: string;
}

/**
 * Request body of PUT /update-endpoint-overrides: per-environment weights on
 * the environment's binding. No release is cut.
 */
export interface UpdateEndpointOverridesRequest {
  namespaceName: string;
  endpointName: string;
  environment: string;
  /** An empty list clears the overrides, so the release's values apply. */
  overrides: EndpointWeightOverride[];
}

/** Request body of PUT /update-endpoint-settings. Cuts a new release. */
export interface UpdateEndpointSettingsRequest {
  namespaceName: string;
  endpointName: string;
  visibility?: EndpointVisibility[];
  autoDeploy?: boolean;
}

/** Request body of PUT /endpoint-rollout/start. */
export interface StartRolloutRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  plan: RolloutPlan;
  /** Environments the rollout starts in, at its first stage. */
  environments: string[];
}

/** Request body of PUT /endpoint-rollout/stage. */
export interface SetRolloutStageRequest {
  namespaceName: string;
  endpointName: string;
  environment: string;
  /** The candidate's share of traffic to set, 0 to 100. */
  percent: number;
}

/** Request body of PUT /endpoint-rollout/promote. */
export interface PromoteRolloutRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  /** Environment whose routing is copied. */
  from: string;
  /** Environment it goes to, at the rollout's first stage. */
  to: string;
}

/** Request body of PUT /endpoint-rollout/convert: a mirror becomes a canary. */
export interface ConvertRolloutRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  /** A header testers send to reach the canary early, if any. */
  testerHeader?: { name: string; value: string };
}

/** Request body of PUT /endpoint-rollout/finish. */
export interface FinishRolloutRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  /** complete keeps the candidate; abandon keeps the stable version. */
  outcome: 'complete' | 'abandon';
}

/** What a rollout action did in each environment it touched. */
export interface RolloutActionResult {
  latestRelease?: string;
  environments: Array<{ name: string; ok: boolean; error?: string }>;
}
