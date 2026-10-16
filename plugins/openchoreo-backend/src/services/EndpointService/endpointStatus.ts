import { InputError } from '@backstage/errors';
import type {
  EndpointBackendStatus,
  EndpointBackendWeight,
  EndpointRoutingStatus,
} from '@openchoreo/backstage-plugin-common';
import type { OpenChoreoComponents } from '@openchoreo/openchoreo-client-node';

type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];
type EndpointBackendRef = OpenChoreoComponents['schemas']['EndpointBackendRef'];
type Condition = OpenChoreoComponents['schemas']['Condition'];

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

/** Maps API backendRefs to the wire shape. A missing weight means 1, as in the CRD. */
export function toBackendWeights(
  refs: EndpointBackendRef[] | undefined,
): EndpointBackendWeight[] {
  return (refs ?? []).map(ref => ({
    componentName: ref.componentName,
    endpoint: ref.endpoint,
    weight: ref.weight ?? 1,
  }));
}

/** Backends of a binding as resolved in its environment. */
export function toBackendStatuses(
  binding: EndpointReleaseBinding | undefined,
): EndpointBackendStatus[] {
  return (binding?.status?.backends ?? []).map(b => ({
    componentName: b.componentName,
    endpoint: b.endpoint,
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
  const key = (b: { componentName: string; endpoint: string }) =>
    `${b.componentName}/${b.endpoint}`;
  const requested = new Map(weights.map(w => [key(w), w.weight]));
  const known = new Set(refs.map(key));
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
    requested.has(key(ref))
      ? { ...ref, weight: requested.get(key(ref))! }
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
  const key = (b: { componentName: string; endpoint: string }) =>
    `${b.componentName}/${b.endpoint}`;
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
    ref => !requested.has(key(ref)) && (ref.weight ?? 1) > 0,
  );
  if (removedWithTraffic.length > 0) {
    throw new InputError(
      `Move ${removedWithTraffic
        .map(key)
        .join(', ')} to 0% and save before removing it`,
    );
  }
  const kept = refs
    .filter(ref => requested.has(key(ref)))
    .map(ref => ({ ...ref, weight: requested.get(key(ref))! }));
  const known = new Set(refs.map(key));
  const added = backends
    .filter(b => !known.has(key(b)))
    .map(b => ({
      componentName: b.componentName,
      endpoint: b.endpoint,
      weight: b.weight,
    }));
  const updated = [...kept, ...added];
  if (updated.length === 0 || updated.every(ref => (ref.weight ?? 1) === 0)) {
    throw new InputError('At least one backend must have a weight above 0');
  }
  return updated;
}
