import { InputError } from '@backstage/errors';
import { backendMatchProblems } from '@openchoreo/backstage-plugin-common';
import type {
  EndpointBackendMatch,
  EndpointBackendStatus,
  EndpointBackendWeight,
  EndpointRoutingStatus,
  EndpointWeightOverride,
} from '@openchoreo/backstage-plugin-common';
import type { OpenChoreoComponents } from '@openchoreo/openchoreo-client-node';

type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];
type EndpointBackendRef = OpenChoreoComponents['schemas']['EndpointBackendRef'];
type Condition = OpenChoreoComponents['schemas']['Condition'];
type ApiEndpointMatch = OpenChoreoComponents['schemas']['EndpointMatch'];

export interface DerivedEndpointStatus {
  status: EndpointRoutingStatus;
  reason?: string;
  message?: string;
}

const findCondition = (
  binding: EndpointReleaseBinding,
  type: string,
): Condition | undefined =>
  binding.status?.conditions?.find(c => c.type === type);

/**
 * Derives how a binding is routing traffic from its conditions. This is the
 * single place the portal interprets EndpointReleaseBinding conditions.
 */
export function deriveEndpointStatus(
  binding: EndpointReleaseBinding | undefined,
): DerivedEndpointStatus {
  if (!binding || !binding.spec?.endpointRelease) {
    return { status: 'NotRouted' };
  }

  const finalizing = findCondition(binding, 'Finalizing');
  if (binding.metadata?.deletionTimestamp || finalizing?.status === 'True') {
    return {
      status: 'Releasing',
      reason: finalizing?.reason,
      message: finalizing?.message,
    };
  }

  const ready = findCondition(binding, 'Ready');
  if (!ready) {
    return { status: 'Applying' };
  }
  const detail = { reason: ready.reason, message: ready.message };
  if (ready.status === 'True') {
    return { status: 'Routing', ...detail };
  }
  switch (ready.reason) {
    case 'EndpointReleaseNotSet':
      return { status: 'NotRouted', ...detail };
    case 'BackendsUnresolved':
      return { status: 'BackendsUnresolved', ...detail };
    case 'RoutesProgressing':
    case 'ReleaseCreated':
    case 'ReleaseSynced':
      return { status: 'Applying', ...detail };
    default:
      return { status: 'Failed', ...detail };
  }
}

/** Maps an API match to the wire shape, leaving out empty parts. */
function toMatch(
  m: ApiEndpointMatch | undefined,
): EndpointBackendMatch | undefined {
  if (!m) return undefined;
  return {
    ...(m.path && { path: m.path }),
    ...(m.headers?.length && { headers: m.headers }),
    ...(m.cookies?.length && { cookies: m.cookies }),
  };
}

/** Maps a wire match to the API shape, filling the CRD's defaults. */
function toApiMatch(m: EndpointBackendMatch): ApiEndpointMatch {
  return {
    ...(m.path && {
      path: { type: m.path.type ?? 'PathPrefix', value: m.path.value },
    }),
    ...(m.headers?.length && {
      headers: m.headers.map(h => ({
        name: h.name,
        type: h.type ?? 'Exact',
        value: h.value,
      })),
    }),
    ...(m.cookies?.length && { cookies: m.cookies }),
  };
}

/**
 * Maps API backendRefs to the wire shape, with each backend's match and
 * mirror. A missing weight means 1, as in the CRD.
 */
export function toBackendWeights(
  refs: EndpointBackendRef[] | undefined,
): EndpointBackendWeight[] {
  return (refs ?? []).map(ref => {
    const match = toMatch(ref.match);
    return {
      componentName: ref.component?.name ?? ref.name,
      endpoint: ref.component?.endpoint ?? '',
      weight: ref.weight ?? 1,
      name: ref.name,
      ...(match && { match }),
      ...(ref.mirror && { mirror: { percent: ref.mirror.percent } }),
    };
  });
}

/** Keys an API backendRef the way the wire shape is keyed. */
const refKey = (ref: EndpointBackendRef) =>
  ref.component
    ? `${ref.component.name}/${ref.component.endpoint}`
    : `${ref.name}/`;

/** Keys a wire-shape backend. */
const key = (b: { componentName: string; endpoint: string }) =>
  `${b.componentName}/${b.endpoint}`;

/** A backend's match and mirror in the API shape, when it has them. */
const reachOf = (b: EndpointBackendWeight) => ({
  ...(b.match && { match: toApiMatch(b.match) }),
  ...(b.mirror && { mirror: { percent: b.mirror.percent } }),
});

/** Builds the API backendRef for a backend added from the portal. */
const toBackendRef = (b: EndpointBackendWeight): EndpointBackendRef => ({
  name: b.name ?? b.componentName,
  kind: 'Component',
  component: { name: b.componentName, endpoint: b.endpoint },
  weight: b.weight,
  ...reachOf(b),
});

/** A binding's per-environment weights and mirror shares. */
export function toOverrides(
  binding: EndpointReleaseBinding | undefined,
): EndpointWeightOverride[] {
  return (binding?.spec?.backendOverrides ?? [])
    .filter(o => o.weight !== undefined || o.mirror)
    .map(o => ({
      name: o.name,
      ...(o.weight !== undefined && { weight: o.weight }),
      ...(o.mirror && { mirror: { percent: o.mirror.percent } }),
    }));
}

/**
 * Refuses backend matches the CRD or the webhook would refuse, with readable
 * messages (see backendMatchProblems).
 */
export function validateMatches(backends: EndpointBackendWeight[]): void {
  const problems = backends.flatMap(b =>
    b.match
      ? backendMatchProblems(b.match).map(
          p => `${b.name ?? b.componentName}: ${p}`,
        )
      : [],
  );
  for (const b of backends) {
    if (b.mirror && (b.weight !== 0 || b.match)) {
      problems.push(
        `${
          b.name ?? b.componentName
        }: a mirror backend needs weight 0 and no match`,
      );
    }
  }
  if (problems.length > 0) {
    throw new InputError(`Invalid backends: ${problems.join('; ')}`);
  }
}

/** Backends of a binding as resolved in its environment. */
export function toBackendStatuses(
  binding: EndpointReleaseBinding | undefined,
): EndpointBackendStatus[] {
  return (binding?.status?.backends ?? []).map(b => ({
    componentName: b.componentName ?? b.name,
    endpoint: b.endpoint ?? '',
    name: b.name,
    weight: b.weight ?? 0,
    ...(b.mirror && { mirror: { percent: b.mirror.percent } }),
    resolved: b.resolved,
    reason: b.reason,
  }));
}

/**
 * Applies new weights to an Endpoint's backendRefs. Only the weights of
 * existing backends change: backends cannot be added or removed this way, so
 * a request naming an unknown backend is rejected. Weights are whole numbers
 * from 0 to 1,000,000 (the CRD's range) and must not all be 0.
 */
export function applyWeights(
  refs: EndpointBackendRef[],
  weights: EndpointBackendWeight[],
): EndpointBackendRef[] {
  const requested = new Map(weights.map(w => [key(w), w.weight]));
  const known = new Set(refs.map(refKey));
  const invalid = weights.filter(
    w => !Number.isInteger(w.weight) || w.weight < 0 || w.weight > 1_000_000,
  );
  if (invalid.length > 0) {
    throw new InputError(
      `Weights must be whole numbers from 0 to 1000000: ${invalid
        .map(key)
        .join(', ')}`,
    );
  }
  const unknown = weights.filter(w => !known.has(key(w)));
  if (unknown.length > 0) {
    throw new InputError(
      `Unknown backends: ${unknown
        .map(key)
        .join(', ')}. Only the weights of existing backends can be changed.`,
    );
  }
  const updated = refs.map(ref =>
    requested.has(refKey(ref))
      ? { ...ref, weight: requested.get(refKey(ref))! }
      : ref,
  );
  if (updated.every(ref => (ref.weight ?? 1) === 0)) {
    throw new InputError('At least one backend must have a weight above 0');
  }
  return updated;
}

/**
 * Replaces an Endpoint's backends with the requested set, which is how a
 * canary starts: a new backend is added (usually at weight 0) to the same
 * Endpoint, so the URL never changes. Existing backends keep their order and
 * new ones are appended. A backend left out is removed, at any weight.
 *
 * With `reach`, each backend's match and mirror are set to the requested
 * ones (a strategy starting or finishing); without it they are kept, so a
 * Configure-page save leaves a running rollout's previews alone.
 */
export function applyBackends(
  refs: EndpointBackendRef[],
  backends: EndpointBackendWeight[],
  opts: { reach?: boolean } = {},
): EndpointBackendRef[] {
  const invalid = backends.filter(
    w => !Number.isInteger(w.weight) || w.weight < 0 || w.weight > 1_000_000,
  );
  if (invalid.length > 0) {
    throw new InputError(
      `Weights must be whole numbers from 0 to 1000000: ${invalid
        .map(key)
        .join(', ')}`,
    );
  }
  const keys = backends.map(key);
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
  if (duplicate) {
    throw new InputError(`Backend ${duplicate} is listed twice`);
  }
  // A backend can be removed at any weight: the new release only moves an
  // environment's traffic when that environment deploys it.
  const requested = new Map(backends.map(b => [key(b), b]));
  const kept = refs
    .filter(ref => requested.has(refKey(ref)))
    .map(ref => {
      const b = requested.get(refKey(ref))!;
      if (!opts.reach) return { ...ref, weight: b.weight };
      const { match: _m, mirror: _r, ...rest } = ref;
      return { ...rest, weight: b.weight, ...reachOf(b) };
    });
  const known = new Set(refs.map(refKey));
  const added = backends.filter(b => !known.has(key(b))).map(toBackendRef);
  const updated = [...kept, ...added];
  if (updated.length === 0 || updated.every(ref => (ref.weight ?? 1) === 0)) {
    throw new InputError('At least one backend must have a weight above 0');
  }
  return updated;
}
