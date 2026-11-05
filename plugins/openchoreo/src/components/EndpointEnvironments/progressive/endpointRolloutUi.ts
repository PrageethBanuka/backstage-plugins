import {
  abAudience,
  rolloutPosition,
  stableSplit,
  untouchedSplit,
  type EndpointBackendWeight,
  type EndpointRollout,
  type RolloutPreview,
  type RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment, EndpointSummary } from './pdTypes';

/** How each strategy is named and explained on screen. */
export const STRATEGY_COPY: Record<
  RolloutStrategy,
  { name: string; question: string; pitch: string }
> = {
  canary: {
    name: 'Canary',
    question: 'Is it safe for a share of real traffic?',
    pitch: 'Send a small share of traffic first, then more.',
  },
  blueGreen: {
    name: 'Blue/green',
    question: 'Does it work before anyone sees it?',
    pitch: 'Test the new version on a header, then switch everyone at once.',
  },
  abTest: {
    name: 'A/B test',
    question: 'Which backend works better for users?',
    pitch: 'Send one group of users to it and compare.',
  },
  mirror: {
    name: 'Mirror',
    question: 'Does it hold up under real traffic?',
    pitch: 'Copy live traffic to it. Nobody sees its answers.',
  },
};

const nameOf = (b: { name?: string; componentName: string }) =>
  b.name ?? b.componentName;

/** True when the environment runs a release that has the new version. */
export function inRollout(
  env: EndpointEnvironment,
  rollout: EndpointRollout,
): boolean {
  return (
    Boolean(env.bindingName) &&
    env.backends.some(b => nameOf(b) === rollout.candidate)
  );
}

/** Backends with their share of the split the rollout started from. */
function shares(rollout: EndpointRollout, names: string[]): string {
  const split = stableSplit(rollout);
  const total = split.reduce((sum, b) => sum + (b.weight ?? 0), 0);
  return split
    .filter(b => names.includes(b.name))
    .map(b => `${b.name} ${Math.round(((b.weight ?? 0) / total) * 100)}%`)
    .join(' · ');
}

/**
 * The backends the rollout leaves alone with their shares, e.g.
 * "trips-legacy 30%"; empty when the replaced version was alone.
 */
export function untouchedSummary(rollout: EndpointRollout): string {
  return shares(
    rollout,
    untouchedSplit(rollout).map(b => b.name),
  );
}

/** Who takes part in an A/B test besides the cookie group, on screen. */
export function audienceText(preview: RolloutPreview | undefined): string {
  const h = abAudience(preview);
  if (!h) return 'Everyone in the cookie group';
  if (h.type === 'RegularExpression') {
    return `The cookie group, when ${h.name} matches ${h.value}`;
  }
  return `The cookie group, when ${h.name} is ${h.value}`;
}

/** The command that reaches the new backend before it gets traffic. */
export function previewCommand(
  rollout: EndpointRollout,
  url: string | undefined,
): string | undefined {
  const p = rollout.preview;
  if (!p || rollout.strategy === 'mirror') return undefined;
  const target = url ?? '<endpoint URL>';
  if (p.kind === 'header') return `curl -H '${p.name}: ${p.value}' ${target}`;
  if (p.kind === 'path') return `curl ${target.replace(/\/$/, '')}${p.value}`;
  const h = abAudience(p);
  let extra = '';
  if (h && h.type === 'RegularExpression') {
    // A value that matches the pattern; the phone pattern has a known one.
    extra =
      h.value === '.*Mobi.*'
        ? " -A 'Mobile'"
        : ` -H '${h.name}: <a value matching ${h.value}>'`;
  } else if (h) {
    extra = ` -H '${h.name}: ${h.value}'`;
  }
  return `curl -H 'Cookie: ${p.name}=${p.value}'${extra} ${target}`;
}

/**
 * The weights an environment serves now (its backends after per-environment
 * weights), in the Endpoint's backend order so colours match everywhere.
 */
export function servedSplit(
  env: EndpointEnvironment,
  endpoint: EndpointSummary,
): EndpointBackendWeight[] {
  const live = new Map(env.backends.map(b => [nameOf(b), b.weight]));
  const known = endpoint.backends
    .filter(b => live.has(nameOf(b)))
    .map(b => ({ ...b, weight: live.get(nameOf(b))! }));
  const extra = env.backends.filter(
    b => !endpoint.backends.some(x => nameOf(x) === nameOf(b)),
  );
  return [...known, ...extra];
}

/**
 * The environments where a backend still gets user traffic. A backend can
 * leave the Endpoint only once this is empty, so removing it moves no one.
 */
export function servingEnvironments(
  environments: EndpointEnvironment[],
  backend: string,
): EndpointEnvironment[] {
  return environments.filter(
    e =>
      e.bindingName &&
      e.backends.some(b => nameOf(b) === backend && b.weight > 0),
  );
}

/**
 * The new version's share the environment's overrides ask for, or undefined
 * without overrides. It differs from what is served while traffic moves.
 */
export function requestedPercent(
  env: EndpointEnvironment,
  rollout: EndpointRollout,
): number | undefined {
  if (env.overrides.length === 0) return undefined;
  const weights = Object.fromEntries(
    env.overrides.map(o => [o.name, o.weight ?? 0]),
  );
  const mirror = env.overrides.find(o => o.name === rollout.candidate)?.mirror;
  return rolloutPosition(rollout, weights, mirror?.percent).percent;
}
