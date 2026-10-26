import { InputError } from '@backstage/errors';
import { endpointRuleProblems } from '@openchoreo/backstage-plugin-common';
import type {
  EndpointBackendStatus,
  EndpointBackendWeight,
  EndpointRoutingStatus,
  EndpointRule,
  EndpointWeightOverride,
} from '@openchoreo/backstage-plugin-common';
import type { OpenChoreoComponents } from '@openchoreo/openchoreo-client-node';

type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];
type EndpointBackendRef = OpenChoreoComponents['schemas']['EndpointBackendRef'];
type Condition = OpenChoreoComponents['schemas']['Condition'];
type ApiEndpointRule = OpenChoreoComponents['schemas']['EndpointRule'];

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

/**
 * Maps API backendRefs to the wire shape. A missing weight means 1, as in the
 * CRD.
 */
export function toBackendWeights(
  refs: EndpointBackendRef[] | undefined,
): EndpointBackendWeight[] {
  return (refs ?? []).map(ref => ({
    componentName: ref.component?.name ?? ref.name,
    endpoint: ref.component?.endpoint ?? '',
    weight: ref.weight ?? 1,
    name: ref.name,
  }));
}

/** Keys an API backendRef the way the wire shape is keyed. */
const refKey = (ref: EndpointBackendRef) =>
  ref.component
    ? `${ref.component.name}/${ref.component.endpoint}`
    : `${ref.name}/`;

/** Keys a wire-shape backend. */
const key = (b: { componentName: string; endpoint: string }) =>
  `${b.componentName}/${b.endpoint}`;

/** Builds the API backendRef for a backend added from the portal. */
const toBackendRef = (b: EndpointBackendWeight): EndpointBackendRef => ({
  name: b.name ?? b.componentName,
  kind: 'Component',
  component: { name: b.componentName, endpoint: b.endpoint },
  weight: b.weight,
});

/** Maps API rules to the wire shape. */
export function toRules(rules: ApiEndpointRule[] | undefined): EndpointRule[] {
  return (rules ?? []).map(r => ({
    name: r.name,
    ...(r.matches?.length && { matches: r.matches }),
    backends: r.backends.map(b => ({ name: b.name, weight: b.weight ?? 1 })),
    ...(r.mirrors?.length && { mirrors: r.mirrors }),
  }));
}

/** Maps wire rules to the API shape, filling the CRD's defaults. */
export function toApiRules(rules: EndpointRule[]): ApiEndpointRule[] {
  return rules.map(r => ({
    name: r.name,
    ...(r.matches?.length && {
      matches: r.matches.map(m => ({
        ...(m.headers?.length && {
          headers: m.headers.map(h => ({
            name: h.name,
            type: h.type ?? 'Exact',
            value: h.value,
          })),
        }),
        ...(m.cookies?.length && { cookies: m.cookies }),
        ...(m.queryParams?.length && { queryParams: m.queryParams }),
      })),
    }),
    backends: r.backends.map(b => ({ name: b.name, weight: b.weight ?? 1 })),
    ...(r.mirrors?.length && { mirrors: r.mirrors }),
  }));
}

/** A binding's per-environment weights. */
export function toOverrides(
  binding: EndpointReleaseBinding | undefined,
): EndpointWeightOverride[] {
  return (binding?.spec?.backendOverrides ?? [])
    .filter(o => o.weight !== undefined)
    .map(o => ({ name: o.name, weight: o.weight! }));
}

/**
 * Drops rule backends and mirrors that are no longer backendRefs, and rules
 * left without backends, as the Component controller does when a backend's
 * component is deleted.
 */
export function pruneRules(
  rules: ApiEndpointRule[] | undefined,
  refs: EndpointBackendRef[],
): ApiEndpointRule[] {
  const known = new Set(refs.map(r => r.name));
  return (rules ?? [])
    .map(r => ({
      ...r,
      backends: r.backends.filter(b => known.has(b.name)),
      ...(r.mirrors && { mirrors: r.mirrors.filter(m => known.has(m.backend)) }),
    }))
    .filter(r => r.backends.length > 0);
}

/**
 * Refuses rules the CRD would refuse, with readable messages (see
 * endpointRuleProblems).
 */
export function validateRules(
  rules: EndpointRule[],
  backendNames: string[],
): void {
  const problems = endpointRuleProblems(rules, backendNames);
  if (problems.length > 0) {
    throw new InputError(`Invalid rules: ${problems.join('; ')}`);
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
 * new ones are appended. A backend can only be removed once its saved weight
 * is 0, so removing one never moves traffic by itself.
 */
export function applyBackends(
  refs: EndpointBackendRef[],
  backends: EndpointBackendWeight[],
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
  const requested = new Map(backends.map(b => [key(b), b.weight]));
  const removedWithTraffic = refs.filter(
    ref => !requested.has(refKey(ref)) && (ref.weight ?? 1) > 0,
  );
  if (removedWithTraffic.length > 0) {
    throw new InputError(
      `Move ${removedWithTraffic
        .map(refKey)
        .join(', ')} to 0% and save before removing it`,
    );
  }
  const kept = refs
    .filter(ref => requested.has(refKey(ref)))
    .map(ref => ({ ...ref, weight: requested.get(refKey(ref))! }));
  const known = new Set(refs.map(refKey));
  const added = backends.filter(b => !known.has(key(b))).map(toBackendRef);
  const updated = [...kept, ...added];
  if (updated.length === 0 || updated.every(ref => (ref.weight ?? 1) === 0)) {
    throw new InputError('At least one backend must have a weight above 0');
  }
  return updated;
}
