import type {
  EndpointBackendMatch,
  EndpointBackendWeight,
  EndpointHeaderMatch,
  EndpointWeightOverride,
} from '../types/endpoint-types';

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

/** The progressive delivery strategy an Endpoint's backends show. */
export type EndpointStrategy =
  | { kind: 'none' }
  | { kind: 'canary'; stable: string; canary: string }
  | { kind: 'abTest'; control: string; variant: string; cookie: string }
  | { kind: 'mirror'; stable: string; shadow: string };

/** Name of a backend in the Endpoint: its backendRefs name. */
const nameOf = (b: EndpointBackendWeight) => b.name ?? b.componentName;

/**
 * Reads which strategy an Endpoint is running from its backends, for
 * Endpoints without the rollout note (changed with kubectl or GitOps). A
 * weight-0 backend is the new one:
 *
 * - with a mirror: a mirror rollout;
 * - with a cookie in its match: an A/B test;
 * - with any other match: a canary (a blue/green leaves the same shape; the
 *   note tells them apart).
 *
 * Several weighted backends without matches are a split set by hand, not a
 * rollout.
 */
export function detectEndpointStrategy(
  backends: EndpointBackendWeight[],
): EndpointStrategy {
  if (backends.length < 2) return { kind: 'none' };
  const candidate = backends.find(b => b.weight === 0 && (b.mirror || b.match));
  if (!candidate) return { kind: 'none' };
  // The main other backend: the one with the most traffic.
  const stable = nameOf(
    [...backends]
      .filter(b => b !== candidate)
      .sort((a, b) => b.weight - a.weight)[0],
  );
  if (candidate.mirror) {
    return { kind: 'mirror', stable, shadow: nameOf(candidate) };
  }
  const cookie = candidate.match?.cookies?.[0];
  if (cookie) {
    return {
      kind: 'abTest',
      control: stable,
      variant: nameOf(candidate),
      cookie: `${cookie.name}=${cookie.value}`,
    };
  }
  return { kind: 'canary', stable, canary: nameOf(candidate) };
}

/** A new component workload endpoint a strategy adds as a backend. */
export interface StrategyTarget {
  componentName: string;
  endpoint: string;
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
  const isTarget = (b: EndpointBackendWeight) =>
    b.componentName === target.componentName && b.endpoint === target.endpoint;
  const {
    match: _m,
    mirror: _r,
    ...base
  } = backends.find(isTarget) ?? {
    name: target.componentName,
    componentName: target.componentName,
    endpoint: target.endpoint,
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
