import { indigo, teal } from '@material-ui/core/colors';
import {
  splitPercents,
  type EndpointBackendMatch,
  type EndpointBackendWeight,
} from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from './pdTypes';

/** A backend's part in the running rollout. */
export type RolloutRole = 'Current' | 'New';

/** The two backends of a rollout, by name. */
export interface RolloutPair {
  stable: string;
  candidate: string;
}

export function roleOf(
  name: string,
  pair?: RolloutPair,
): RolloutRole | undefined {
  if (name === pair?.stable) return 'Current';
  if (name === pair?.candidate) return 'New';
  return undefined;
}

// Backends are shades of the portal's blue. Current keeps the full blue and
// New is teal, the one other hue, so the pair stands out; the other backends
// take lighter blues while a rollout runs.
const SHADES = [
  indigo[500],
  indigo[300],
  indigo[700],
  indigo[200],
  indigo[900],
];
const LIGHT_SHADES = [indigo[200], indigo[100], indigo[300]];

/** Blue is always Current and teal always New, in every view. */
export const roleColor = (role: RolloutRole): string =>
  role === 'Current' ? indigo[500] : teal[500];

/**
 * Each backend's colour, by name. A rollout's pair gets its role colours and
 * the others theirs by position among themselves, so a backend keeps its
 * colour in every bar, legend and flow on a page.
 */
export function backendColors(
  names: string[],
  pair?: RolloutPair,
): Map<string, string> {
  const shades = pair ? LIGHT_SHADES : SHADES;
  const others = names.filter(n => !roleOf(n, pair));
  return new Map(
    names.map(name => {
      const role = roleOf(name, pair);
      return [
        name,
        role ? roleColor(role) : shades[others.indexOf(name) % shades.length],
      ];
    }),
  );
}

/** The rollout's pair first, Current then New, then the others in order. */
export function pairFirst<T>(
  items: T[],
  nameOf: (item: T) => string,
  pair?: RolloutPair,
): T[] {
  if (!pair) return items;
  const rank = (item: T) => {
    const role = roleOf(nameOf(item), pair);
    if (role === 'Current') return 0;
    return role === 'New' ? 1 : 2;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

export const backendKey = (b: { componentName: string; endpoint: string }) =>
  `${b.componentName}/${b.endpoint}`;

/**
 * How a backend is named in the traffic views, as the portal names a
 * release line: "component @ line", and the component alone on its main line.
 */
export function backendLabel(
  b: Pick<EndpointBackendWeight, 'componentName' | 'releaseLine'>,
): string {
  return b.releaseLine
    ? `${b.componentName} @ ${b.releaseLine}`
    : b.componentName;
}

/** Whole-number percentages of `weights` that add up to exactly 100. */
export const sharePercents = (weights: number[]): number[] =>
  splitPercents(weights);

/** "payments-v1 90%, payments-v2 10%": the text form of a split bar. */
export function describeSplit(backends: EndpointBackendWeight[]): string {
  if (backends.length === 0) return 'No traffic';
  const pct = sharePercents(backends.map(b => b.weight));
  return backends.map((b, i) => `${backendLabel(b)} ${pct[i]}%`).join(', ');
}

/**
 * Backends a split sends traffic to that are not deployed in an
 * environment. A release with any of these cannot route there.
 */
export function missingBackends(
  env: EndpointEnvironment,
  backends: EndpointBackendWeight[],
): string[] {
  if (!env.deployedBackends) return [];
  const deployed = new Set(env.deployedBackends);
  return backends
    .filter(b => b.weight > 0 && !deployed.has(backendKey(b)))
    .map(b => b.componentName);
}

/**
 * One line for a backend's match, e.g. "x-preview: green", "path /next/…
 * and cookie exp=b", for the traffic sections and summaries.
 */
export function describeMatch(match: EndpointBackendMatch): string {
  return [
    ...(match.path
      ? [
          match.path.type === 'Exact'
            ? `path ${match.path.value}`
            : `path ${match.path.value.replace(/\/$/, '')}/…`,
        ]
      : []),
    ...(match.headers ?? []).map(h =>
      h.type === 'RegularExpression'
        ? `${h.name} ~ ${h.value}`
        : `${h.name}: ${h.value}`,
    ),
    ...(match.cookies ?? []).map(c => `cookie ${c.name}=${c.value}`),
  ].join(' and ');
}

/**
 * What a backend gets besides its weight, e.g. "x-preview: green" or "a copy
 * of 10% of traffic"; empty for a plain weighted backend.
 */
export function describeReach(b: EndpointBackendWeight): string {
  if (b.mirror) return `a copy of ${b.mirror.percent}% of traffic`;
  return b.match ? describeMatch(b.match) : '';
}
