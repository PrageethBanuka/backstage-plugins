import { InputError } from '@backstage/errors';
import { backendMatchProblems } from '@openchoreo/backstage-plugin-common';
import type {
  EndpointBackendMatch,
  EndpointBackendWeight,
  EndpointWeightOverride,
} from '@openchoreo/backstage-plugin-common';
import type { OpenChoreoComponents } from '@openchoreo/openchoreo-client-node';

type EndpointReleaseBinding =
  OpenChoreoComponents['schemas']['EndpointReleaseBinding'];
type EndpointBackendRef = OpenChoreoComponents['schemas']['EndpointBackendRef'];
type ApiEndpointMatch = OpenChoreoComponents['schemas']['EndpointMatch'];

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

/** An Endpoint's backendRefs in the wire shape. A missing weight means 1, as in the CRD. */
export function toBackendWeights(
  refs: EndpointBackendRef[] | undefined,
): EndpointBackendWeight[] {
  return (refs ?? []).map(ref => {
    const match = toMatch(ref.match);
    return {
      componentName: ref.component?.name ?? ref.name,
      endpoint: ref.component?.endpoint ?? '',
      ...(ref.component?.releaseLine && {
        releaseLine: ref.component.releaseLine,
      }),
      weight: ref.weight ?? 1,
      name: ref.name,
      ...(match && { match }),
      ...(ref.mirror && { mirror: { percent: ref.mirror.percent } }),
    };
  });
}

const refKey = (ref: EndpointBackendRef) =>
  ref.component
    ? `${ref.component.name}/${ref.component.endpoint}/${
        ref.component.releaseLine ?? ''
      }`
    : `${ref.name}//`;

const key = (b: EndpointBackendWeight) =>
  `${b.componentName}/${b.endpoint}/${b.releaseLine ?? ''}`;

const reachOf = (b: EndpointBackendWeight) => ({
  ...(b.match && { match: toApiMatch(b.match) }),
  ...(b.mirror && { mirror: { percent: b.mirror.percent } }),
});

const toBackendRef = (b: EndpointBackendWeight): EndpointBackendRef => ({
  name: b.name ?? b.componentName,
  kind: 'Component',
  component: {
    name: b.componentName,
    endpoint: b.endpoint,
    ...(b.releaseLine && { releaseLine: b.releaseLine }),
  },
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

/** Refuses backend matches and mirrors the Endpoint CRD or controller would refuse. */
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

/**
 * Replaces an Endpoint's backends with the requested set. Existing backends
 * keep their order and new ones are appended; one left out is removed. With
 * `reach`, each backend's match and mirror are set to the requested ones;
 * without it they are kept.
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
