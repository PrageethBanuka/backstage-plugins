import type { Theme } from '@material-ui/core/styles';
import {
  cyan,
  deepPurple,
  indigo,
  lime,
  pink,
  teal,
} from '@material-ui/core/colors';
import type {
  EndpointBackendWeight,
  EndpointEnvironment,
} from '@openchoreo/backstage-plugin-common';

/**
 * Backend colours, assigned by position in the Endpoint's backendRefs so a
 * backend keeps its colour in every bar, legend and slider on a page. Status
 * hues (green, amber, red) are deliberately absent.
 */
const BACKEND_HUES = [indigo, teal, pink, deepPurple, cyan, lime];

export const backendColor = (theme: Theme, index: number): string => {
  const hue = BACKEND_HUES[index % BACKEND_HUES.length];
  return theme.palette.type === 'dark' ? hue[300] : hue[500];
};

export const backendKey = (b: { componentName: string; endpoint: string }) =>
  `${b.componentName}/${b.endpoint}`;

/**
 * Whole-number percentages that add up to exactly 100 (largest remainder),
 * so a 1:2 split reads 33 / 67 and never 33 / 66. All-zero weights give 0s.
 */
export function sharePercents(weights: number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map(w => (w / total) * 100);
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((sum, p) => sum + p, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i] += 1;
    remaining -= 1;
  }
  return floors;
}

/** "payments-v1 90%, payments-v2 10%": the text form of a split bar. */
export function describeSplit(backends: EndpointBackendWeight[]): string {
  if (backends.length === 0) return 'No traffic';
  const pct = sharePercents(backends.map(b => b.weight));
  return backends.map((b, i) => `${b.componentName} ${pct[i]}%`).join(', ');
}

/** A split as bare percentages, e.g. `75 / 25`, for button labels. */
export function splitLabel(backends: EndpointBackendWeight[]): string {
  if (backends.length === 0) return 'no traffic';
  return sharePercents(backends.map(b => b.weight)).join(' / ');
}

/**
 * One plain sentence about an environment's state, using the controller's
 * own message where it has one. Undefined when there is nothing to say.
 */
export function statusMessage(env: EndpointEnvironment): string | undefined {
  switch (env.status) {
    case 'Applying':
      return 'The route was rendered and is waiting for the gateway to accept it.';
    case 'BackendsUnresolved':
      return `${
        env.statusMessage ?? 'A backend is not deployed in this environment.'
      } The previous route is still serving traffic.`;
    case 'Failed':
      return env.statusMessage ?? 'The endpoint type could not render a route.';
    case 'Releasing':
      return "The components' own routes are taking the traffic back.";
    case 'NotRouted':
      return "This Endpoint doesn't route traffic here yet.";
    default:
      return undefined;
  }
}

/**
 * Backends a split sends traffic to that are not deployed in an
 * environment. A release with any of these cannot route there.
 */
export function missingBackends(
  env: EndpointEnvironment,
  backends: EndpointBackendWeight[],
): string[] {
  const deployed = new Set(env.deployedBackends);
  return backends
    .filter(b => b.weight > 0 && !deployed.has(backendKey(b)))
    .map(b => b.componentName);
}
