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
  componentName: string;
  /** Workload endpoint name on the component. */
  endpoint: string;
  weight: number;
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
  /** The latest split (Endpoint.spec.backendRefs). */
  backends: EndpointBackendWeight[];
  latestRelease?: string;
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
  invokeURL?: string;
}

/** Request body of PUT /update-endpoint-traffic. */
export interface UpdateEndpointTrafficRequest {
  namespaceName: string;
  endpointName: string;
  backends: EndpointBackendWeight[];
}

/** Request body of PUT /update-endpoint-release-binding. */
export interface UpdateEndpointReleaseBindingRequest {
  namespaceName: string;
  projectName: string;
  endpointName: string;
  environment: string;
  releaseName: string;
}
