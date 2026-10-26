import type {
  EndpointBackendWeight,
  EndpointRule,
  EndpointWeightOverride,
} from '../types/endpoint-types';

const NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const COOKIE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const COOKIE_VALUE = /^[A-Za-z0-9_.-]{1,128}$/;

/** The CRD's limit on rules per Endpoint. */
export const MAX_ENDPOINT_RULES = 16;

/**
 * Checks Endpoint rules against the CRD's rules and returns what is wrong, so
 * the portal and its backend refuse a bad set with readable messages instead
 * of an admission error: DNS-label names used once, known backends, only the
 * last rule without matches, at most one cookie per match, and the CRD's
 * limits and patterns. An empty list means the rules are valid.
 */
export function endpointRuleProblems(
  rules: EndpointRule[],
  backendNames: string[],
): string[] {
  const problems: string[] = [];
  const known = new Set(backendNames);
  if (rules.length > MAX_ENDPOINT_RULES) {
    problems.push(`at most ${MAX_ENDPOINT_RULES} rules`);
  }
  const names = new Set<string>();
  rules.forEach((r, i) => {
    const at = `rule ${r.name || i + 1}`;
    if (!NAME.test(r.name ?? '')) {
      problems.push(`${at}: name must be lowercase letters, digits and hyphens`);
    }
    if (names.has(r.name)) problems.push(`${at}: name is used twice`);
    names.add(r.name);
    if (!r.matches?.length && i !== rules.length - 1) {
      problems.push(`${at}: only the last rule may have no matches`);
    }
    if ((r.matches?.length ?? 0) > 8) problems.push(`${at}: at most 8 matches`);
    if (!r.backends?.length) problems.push(`${at}: needs a backend`);
    for (const b of r.backends ?? []) {
      if (!known.has(b.name)) problems.push(`${at}: unknown backend ${b.name}`);
      if (
        b.weight !== undefined &&
        (!Number.isInteger(b.weight) || b.weight < 0 || b.weight > 1_000_000)
      ) {
        problems.push(`${at}: weight of ${b.name} must be a whole number`);
      }
    }
    if (r.backends?.length && r.backends.every(b => (b.weight ?? 1) === 0)) {
      problems.push(`${at}: needs a backend with a weight above 0`);
    }
    for (const m of r.mirrors ?? []) {
      if (!known.has(m.backend)) {
        problems.push(`${at}: unknown mirror backend ${m.backend}`);
      }
      if (!Number.isInteger(m.percent) || m.percent < 1 || m.percent > 100) {
        problems.push(`${at}: mirror percent must be 1 to 100`);
      }
    }
    for (const m of r.matches ?? []) {
      if ((m.cookies?.length ?? 0) > 1) {
        problems.push(`${at}: at most one cookie per match`);
      }
      for (const c of m.cookies ?? []) {
        if (!COOKIE_NAME.test(c.name) || !COOKIE_VALUE.test(c.value)) {
          problems.push(
            `${at}: cookie ${c.name}=${c.value} uses characters a cookie match can't`,
          );
        }
      }
      for (const h of m.headers ?? []) {
        if (!h.name || !h.value) {
          problems.push(`${at}: a header condition needs a name and a value`);
        }
      }
      if (!m.headers?.length && !m.cookies?.length && !m.queryParams?.length) {
        problems.push(`${at}: a match needs a header, cookie or query parameter`);
      }
    }
  });
  return problems;
}

/** The progressive delivery strategy an Endpoint's backends and rules show. */
export type EndpointStrategy =
  | { kind: 'none' }
  | { kind: 'canary'; stable: string; canary: string; testerRule?: string }
  | { kind: 'blueGreen'; blue: string; green: string; previewRule: string }
  | { kind: 'abTest'; control: string; variant: string; cookie: string };

/** Name of a backend in the Endpoint: its backendRefs name. */
const nameOf = (b: EndpointBackendWeight) => b.name ?? b.componentName;

/** Rules the strategy builders write, so detection can recognise them. */
export const STRATEGY_RULES = {
  canaryTesters: 'canary-testers',
  bluePreview: 'preview',
  abVariant: 'group-b',
} as const;

/**
 * Reads which strategy an Endpoint is running from its backends and rules,
 * to label it and offer the next steps. Nothing is stored for it: the
 * strategy is what the split and the rules already say.
 *
 * - A/B: a rule matching a cookie sends to one backend.
 * - Blue/green: a rule matching a header sends to a backend at weight 0.
 * - Canary: two backends; the second is the new version, optionally with a
 *   testers' header rule.
 */
export function detectEndpointStrategy(
  backends: EndpointBackendWeight[],
  rules: EndpointRule[],
): EndpointStrategy {
  if (backends.length < 2) return { kind: 'none' };
  const single = (r: EndpointRule) =>
    r.backends.length === 1 ? r.backends[0].name : undefined;
  const firstOther = (name: string) =>
    nameOf(backends.find(b => nameOf(b) !== name) ?? backends[0]);

  for (const r of rules) {
    const target = single(r);
    const cookie = r.matches?.flatMap(m => m.cookies ?? [])[0];
    if (target && cookie) {
      return {
        kind: 'abTest',
        control: firstOther(target),
        variant: target,
        cookie: `${cookie.name}=${cookie.value}`,
      };
    }
  }
  for (const r of rules) {
    const target = single(r);
    const hasHeader = r.matches?.some(m => m.headers?.length);
    const targetBackend = backends.find(b => nameOf(b) === target);
    if (target && hasHeader && r.name !== STRATEGY_RULES.canaryTesters) {
      if (targetBackend && targetBackend.weight === 0) {
        return {
          kind: 'blueGreen',
          blue: firstOther(target),
          green: target,
          previewRule: r.name,
        };
      }
    }
  }
  const testers = rules.find(r => r.name === STRATEGY_RULES.canaryTesters);
  return {
    kind: 'canary',
    stable: nameOf(backends[0]),
    canary: nameOf(backends[backends.length - 1]),
    ...(testers && { testerRule: testers.name }),
  };
}

/** A new component workload endpoint a strategy adds as a backend. */
export interface StrategyTarget {
  componentName: string;
  endpoint: string;
}

/** What a strategy writes to the Endpoint, in one update and one release. */
export interface StrategyChange {
  backends: EndpointBackendWeight[];
  rules: EndpointRule[];
}

/** Adds the target at weight 0 unless the Endpoint already has it. */
function withTarget(
  backends: EndpointBackendWeight[],
  target: StrategyTarget,
): { backends: EndpointBackendWeight[]; name: string } {
  const existing = backends.find(
    b =>
      b.componentName === target.componentName &&
      b.endpoint === target.endpoint,
  );
  if (existing) return { backends, name: nameOf(existing) };
  return {
    backends: [
      ...backends,
      {
        name: target.componentName,
        componentName: target.componentName,
        endpoint: target.endpoint,
        weight: 0,
      },
    ],
    name: target.componentName,
  };
}

/** Drops the rules a strategy writes, keeping the Endpoint's own. */
const withoutStrategyRules = (rules: EndpointRule[]) =>
  rules.filter(
    r => !(Object.values(STRATEGY_RULES) as string[]).includes(r.name),
  );

/** Puts strategy rules first and any catch-all the Endpoint has last. */
const ordered = (strategyRules: EndpointRule[], own: EndpointRule[]) => [
  ...strategyRules,
  ...own.filter(r => r.matches?.length),
  ...own.filter(r => !r.matches?.length),
];

/**
 * Canary: the new version joins at weight 0, so nothing moves until an
 * environment's weights are stepped up (5, 25, 50, 100). Testers who send
 * the header always reach it, if a header is given.
 */
export function buildCanary(
  backends: EndpointBackendWeight[],
  rules: EndpointRule[],
  target: StrategyTarget,
  testerHeader?: { name: string; value: string },
): StrategyChange {
  const added = withTarget(backends, target);
  const own = withoutStrategyRules(rules);
  return {
    backends: added.backends,
    rules: ordered(
      testerHeader
        ? [
            {
              name: STRATEGY_RULES.canaryTesters,
              matches: [{ headers: [{ ...testerHeader, type: 'Exact' }] }],
              backends: [{ name: added.name }],
            },
          ]
        : [],
      own,
    ),
  };
}

/**
 * Blue/green: green joins at weight 0 and only the preview header reaches
 * it. Switching moves an environment's weights all at once (blue 0, green
 * 100); the preview keeps working either way.
 */
export function buildBlueGreen(
  backends: EndpointBackendWeight[],
  rules: EndpointRule[],
  target: StrategyTarget,
  previewHeader: { name: string; value: string },
): StrategyChange {
  const added = withTarget(backends, target);
  return {
    backends: added.backends,
    rules: ordered(
      [
        {
          name: STRATEGY_RULES.bluePreview,
          matches: [{ headers: [{ ...previewHeader, type: 'Exact' }] }],
          backends: [{ name: added.name }],
        },
      ],
      withoutStrategyRules(rules),
    ),
  };
}

/** A User-Agent condition that matches phones and most tablets. */
export const MOBILE_USER_AGENT = {
  name: 'user-agent',
  type: 'RegularExpression' as const,
  value: '.*Mobi.*',
};

/**
 * A/B test: visitors whose cookie says they are in the variant group reach
 * the variant; everyone else stays on the current version. The app assigns
 * the cookie once, so each visitor stays in a group. With mobileOnly, the
 * cookie AND a mobile User-Agent must both hold.
 */
export function buildABTest(
  backends: EndpointBackendWeight[],
  rules: EndpointRule[],
  target: StrategyTarget,
  cookie: { name: string; value: string },
  mobileOnly = false,
): StrategyChange {
  const added = withTarget(backends, target);
  return {
    backends: added.backends,
    rules: ordered(
      [
        {
          name: STRATEGY_RULES.abVariant,
          matches: [
            {
              cookies: [cookie],
              ...(mobileOnly && { headers: [MOBILE_USER_AGENT] }),
            },
          ],
          backends: [{ name: added.name }],
        },
      ],
      withoutStrategyRules(rules),
    ),
  };
}

/**
 * Finishes a strategy: only the `keep` backends stay, at the weights given
 * (one name keeps that backend at 100), and the strategy's rules go. Other
 * rules keep the backends and mirrors that remain.
 */
export function finishStrategy(
  backends: EndpointBackendWeight[],
  rules: EndpointRule[],
  keep: string | EndpointWeightOverride[],
): StrategyChange {
  const weights = new Map(
    typeof keep === 'string'
      ? [[keep, 100]]
      : keep.map(k => [k.name, k.weight] as [string, number]),
  );
  const kept = backends
    .filter(b => weights.has(nameOf(b)))
    .map(b => ({ ...b, weight: weights.get(nameOf(b))! }));
  return {
    backends: kept,
    rules: withoutStrategyRules(rules)
      .map(r => ({
        ...r,
        backends: r.backends.filter(b => weights.has(b.name)),
        mirrors: r.mirrors?.filter(m => weights.has(m.backend)),
      }))
      .filter(r => r.backends.length > 0),
  };
}
