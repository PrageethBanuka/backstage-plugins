import type { EndpointBackendWeight } from '../types/endpoint-rollout-types';

const nameOf = (b: EndpointBackendWeight) => b.name ?? b.componentName;

/** Whether a backend gets a share of the requests no match takes. */
export const hasShare = (b: EndpointBackendWeight): boolean =>
  b.weight > 0 && !b.match && !b.mirror;

/**
 * Whole-number percentages that add up to exactly `total` (largest
 * remainder), in proportion to `weights`, so a 1:2 split reads 33 / 67 and
 * never 33 / 66. All-zero weights give 0s.
 */
export function splitPercents(weights: number[], total = 100): number[] {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map(w => (w / sum) * total);
  const floors = exact.map(Math.floor);
  let remaining = total - floors.reduce((acc, p) => acc + p, 0);
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

/**
 * The backends with `target` given `percent` of the shared requests, added
 * when it isn't one yet. The other backends with a share keep their ratio,
 * and the weights add up to 100, so the YAML reads as the percentages; match
 * and mirror backends keep their weight of 0.
 */
export function withShare(
  backends: EndpointBackendWeight[],
  target: EndpointBackendWeight,
  percent: number,
): EndpointBackendWeight[] {
  const name = nameOf(target);
  const others = backends.filter(b => nameOf(b) !== name && hasShare(b));
  const rest = splitPercents(
    others.map(b => b.weight),
    100 - percent,
  );
  const out = backends.map(b => {
    if (nameOf(b) === name) return { ...b, weight: percent };
    const i = others.indexOf(b);
    return i < 0 ? b : { ...b, weight: rest[i] };
  });
  return out.some(b => nameOf(b) === name)
    ? out
    : [...out, { ...target, weight: percent }];
}

/** Why a share can't be set, or '' when it can. */
export function shareProblem(
  backends: EndpointBackendWeight[],
  target: EndpointBackendWeight,
  percent: number,
): string {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return 'Give a whole percentage from 0 to 100';
  }
  return withShare(backends, target, percent).some(hasShare)
    ? ''
    : 'At least one backend needs a share';
}
