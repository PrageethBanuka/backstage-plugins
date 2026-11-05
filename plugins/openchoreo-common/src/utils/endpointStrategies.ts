import type {
  EndpointBackendMatch,
  EndpointBackendWeight,
  EndpointCapability,
  EndpointHeaderMatch,
  EndpointWeightOverride,
  RolloutStrategy,
} from '../types/endpoint-rollout-types';

const COOKIE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const COOKIE_VALUE = /^[A-Za-z0-9_.-]{1,128}$/;
/** A header name as the CRD accepts it (an HTTP token). */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/**
 * Checks a backend's match the way the CRD and the Endpoint webhook do, so
 * the portal and its backend refuse a bad one with a readable message
 * instead of an admission error. An empty list means the match is valid.
 */
export function backendMatchProblems(match: EndpointBackendMatch): string[] {
  const problems: string[] = [];
  const { path, headers = [], cookies = [] } = match;
  if (!path && headers.length === 0 && cookies.length === 0) {
    problems.push('a match needs a path, a header or a cookie');
  }
  if (path) {
    if (!/^\/[^?#]*$/.test(path.value)) {
      problems.push(`path ${path.value} must start with / and have no ? or #`);
    } else if (
      path.value.includes('//') ||
      path.value
        .split('/')
        .slice(1)
        .some(s => s === '.' || s === '..')
    ) {
      problems.push(`path ${path.value} must not contain //, . or ..`);
    }
  }
  if (headers.length > 8) problems.push('at most 8 headers');
  const seen = new Set<string>();
  for (const h of headers) {
    const name = h.name.toLowerCase();
    if (!HEADER_NAME.test(h.name)) {
      problems.push(`header name "${h.name}" is not a valid HTTP header name`);
    }
    if (!h.value) problems.push(`give a value for ${h.name}`);
    if (seen.has(name)) problems.push(`header ${h.name} is matched twice`);
    seen.add(name);
    if (name === 'cookie' && cookies.length > 0) {
      problems.push(
        'match the cookie with cookies, or the Cookie header with headers, not both',
      );
    }
  }
  if (cookies.length > 1) problems.push('at most one cookie');
  for (const c of cookies) {
    if (!COOKIE_NAME.test(c.name) || !COOKIE_VALUE.test(c.value)) {
      problems.push(
        `cookie ${c.name}=${c.value} uses characters a cookie match can't`,
      );
    }
  }
  return problems;
}

/** Name of a backend in the Endpoint: its backendRefs name. */
const nameOf = (b: EndpointBackendWeight) => b.name ?? b.componentName;

/** A new component workload endpoint a strategy adds as a backend. */
export interface StrategyTarget {
  componentName: string;
  endpoint: string;
  /** Release line of the component; absent for its main line. */
  releaseLine?: string;
  /** The backend's name in the Endpoint; derived when absent. */
  name?: string;
}

/** A name as the Endpoint accepts it: a lowercase DNS label of up to 63 characters. */
function toLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/**
 * A backend name for a new target that no other backend has: the component
 * and release line, then its endpoint, then a number, so two endpoints of
 * one release line (or a component next to a backend already named after
 * it) don't collide.
 */
export function uniqueBackendName(
  backends: Array<{ name?: string; componentName: string }>,
  target: StrategyTarget,
  taken: string[] = [],
): string {
  const used = new Set([
    ...backends.map(b => b.name ?? b.componentName),
    ...taken,
  ]);
  const base = toLabel(
    target.releaseLine
      ? `${target.componentName}-${target.releaseLine}`
      : target.componentName,
  );
  if (!used.has(base)) return base;
  const withEndpoint = toLabel(`${base}-${target.endpoint}`);
  if (!used.has(withEndpoint)) return withEndpoint;
  for (let i = 2; ; i++) {
    const numbered = toLabel(`${withEndpoint.slice(0, 60)}-${i}`);
    if (!used.has(numbered)) return numbered;
  }
}

/** Whether a backend routes to the given component, endpoint and release line. */
export function isSameBackend(
  b: Pick<EndpointBackendWeight, 'componentName' | 'endpoint' | 'releaseLine'>,
  target: StrategyTarget,
): boolean {
  return (
    b.componentName === target.componentName &&
    b.endpoint === target.endpoint &&
    (b.releaseLine ?? '') === (target.releaseLine ?? '')
  );
}

/** What a strategy writes to the Endpoint, in one update and one release. */
export interface StrategyChange {
  backends: EndpointBackendWeight[];
}

/**
 * Adds the target at weight 0 with the given match or mirror; a backend the
 * Endpoint already has for it (left at 0% by an earlier rollout) is reused.
 */
function withTarget(
  backends: EndpointBackendWeight[],
  target: StrategyTarget,
  reach: Pick<EndpointBackendWeight, 'match' | 'mirror'>,
): StrategyChange {
  const isTarget = (b: EndpointBackendWeight) => isSameBackend(b, target);
  const {
    match: _m,
    mirror: _r,
    ...base
  } = backends.find(isTarget) ?? {
    name: target.name || uniqueBackendName(backends, target),
    componentName: target.componentName,
    endpoint: target.endpoint,
    ...(target.releaseLine ? { releaseLine: target.releaseLine } : {}),
    weight: 0,
  };
  const added: EndpointBackendWeight = { ...base, weight: 0, ...reach };
  return {
    backends: backends.some(isTarget)
      ? backends.map(b => (isTarget(b) ? added : b))
      : [...backends, added],
  };
}

/**
 * Canary: the new backend joins at weight 0, so nothing moves until an
 * environment's weights are stepped up (5, 25, 50, 100). Testers who send
 * the header always reach it, if a header is given.
 */
export function buildCanary(
  backends: EndpointBackendWeight[],
  target: StrategyTarget,
  testerHeader?: { name: string; value: string },
): StrategyChange {
  return withTarget(
    backends,
    target,
    testerHeader
      ? { match: { headers: [{ ...testerHeader, type: 'Exact' }] } }
      : {},
  );
}

/**
 * Blue/green: green joins at weight 0 and only the preview reaches it, by a
 * header or by a path under the Endpoint's own. Switching moves an
 * environment's weights all at once (blue 0, green 100); the preview keeps
 * working either way.
 */
export function buildBlueGreen(
  backends: EndpointBackendWeight[],
  target: StrategyTarget,
  preview: { header: { name: string; value: string } } | { path: string },
): StrategyChange {
  return withTarget(backends, target, {
    match:
      'path' in preview
        ? { path: { type: 'PathPrefix', value: preview.path } }
        : { headers: [{ ...preview.header, type: 'Exact' }] },
  });
}

/** A User-Agent condition that matches phones and most tablets. */
export const MOBILE_USER_AGENT = {
  name: 'user-agent',
  type: 'RegularExpression' as const,
  value: '.*Mobi.*',
};

/**
 * What is wrong with an A/B audience header, or undefined when it is fine.
 * A regular expression is checked with the browser's engine; the gateway
 * uses RE2, which is close but not identical, so admission is the backstop.
 */
export function audienceProblem(
  h: EndpointHeaderMatch | undefined,
): string | undefined {
  if (!h) return undefined;
  if (!HEADER_NAME.test(h.name)) {
    return `Header name "${h.name}" must be a valid HTTP header name`;
  }
  if (!h.value) return `Give a value for ${h.name}`;
  if (h.value.length > 4096) return `The value for ${h.name} is too long`;
  if (h.type === 'RegularExpression') {
    try {
      // eslint-disable-next-line no-new
      new RegExp(h.value);
    } catch {
      return `"${h.value}" is not a valid regular expression`;
    }
  }
  return undefined;
}

/**
 * A/B test: visitors whose cookie says they are in the variant group reach
 * the variant; everyone else stays on the current backend. The app assigns
 * the cookie once, so each visitor stays in a group. An audience header
 * (a phone User-Agent, or one the app sends) must hold as well.
 */
export function buildABTest(
  backends: EndpointBackendWeight[],
  target: StrategyTarget,
  cookie: { name: string; value: string },
  audience?: EndpointHeaderMatch,
): StrategyChange {
  return withTarget(backends, target, {
    match: {
      cookies: [cookie],
      ...(audience && {
        headers: [{ ...audience, type: audience.type ?? 'Exact' }],
      }),
    },
  });
}

/**
 * Mirror: the new backend joins at weight 0 and gets a copy of `percent` of
 * the weighted traffic. Users only ever get the other backends' answers.
 */
export function buildMirror(
  backends: EndpointBackendWeight[],
  target: StrategyTarget,
  percent: number,
): StrategyChange {
  return withTarget(backends, target, { mirror: { percent } });
}

/**
 * Finishes a strategy: only the `keep` backends stay, at the weights given
 * (one name keeps that backend at 100), as plain weighted backends without
 * a match or mirror.
 */
export function finishStrategy(
  backends: EndpointBackendWeight[],
  keep: string | EndpointWeightOverride[],
): StrategyChange {
  const weights = new Map(
    typeof keep === 'string'
      ? [[keep, 100]]
      : keep.map(k => [k.name, k.weight ?? 0] as [string, number]),
  );
  return {
    backends: backends
      .filter(b => weights.has(nameOf(b)))
      .map(({ match: _m, mirror: _r, ...b }) => ({
        ...b,
        weight: weights.get(nameOf(b))!,
      })),
  };
}

const STRATEGY_NEEDS: Record<
  RolloutStrategy,
  { needs: EndpointCapability[]; what: string }
> = {
  canary: { needs: [], what: '' },
  blueGreen: { needs: ['Match'], what: 'send testers to the new version' },
  abTest: { needs: ['Match'], what: 'route a cookie group' },
  mirror: { needs: ['Mirror'], what: 'mirror requests' },
};

/**
 * Why an Endpoint's type can't run a strategy, or undefined when it can. A
 * type that declares no capabilities is not checked, as in openchoreo-api.
 */
export function strategyUnsupported(
  strategy: RolloutStrategy,
  capabilities: EndpointCapability[] | undefined,
  typeName = 'This type',
): string | undefined {
  if (!capabilities?.length) return undefined;
  const { needs, what } = STRATEGY_NEEDS[strategy];
  return needs.every(c => capabilities.includes(c))
    ? undefined
    : `${typeName} can't ${what}`;
}

/**
 * Why an Endpoint's type can't reach the new version the way chosen: a
 * testers' header, an audience header matched by regular expression, or a
 * mirror that copies part of the requests.
 */
export function reachUnsupported(
  reach: {
    testersHeader?: boolean;
    audience?: EndpointHeaderMatch;
    mirrorShares?: number[];
  },
  capabilities: EndpointCapability[] | undefined,
  typeName = 'This type',
): string | undefined {
  if (!capabilities?.length) return undefined;
  if (reach.testersHeader && !capabilities.includes('Match')) {
    return `${typeName} can't route testers by a header; turn the header off`;
  }
  if (
    reach.audience?.type === 'RegularExpression' &&
    !capabilities.includes('RegularExpression')
  ) {
    return `${typeName} can't match a header by regular expression; use "is exactly"`;
  }
  if (
    reach.mirrorShares?.some(p => p < 100) &&
    !capabilities.includes('MirrorPercent')
  ) {
    return `${typeName} can only copy every request; make 100% the only step`;
  }
  return undefined;
}
