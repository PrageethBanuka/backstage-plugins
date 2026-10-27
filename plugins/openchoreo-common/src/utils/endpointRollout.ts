import type {
  EndpointBackendWeight,
  EndpointHeaderMatch,
  EndpointRollout,
  EndpointRule,
  EndpointWeightOverride,
  RolloutPlan,
  RolloutPosition,
  RolloutPreview,
} from '../types/endpoint-types';
import {
  buildABTest,
  buildBlueGreen,
  buildCanary,
  detectEndpointStrategy,
  MOBILE_USER_AGENT,
  type StrategyChange,
} from './endpointRules';

/** The Endpoint annotation that records the rollout the portal started. */
export const ROLLOUT_ANNOTATION = 'openchoreo.dev/rollout';

/** One stage of a rollout: where the candidate's traffic share stands. */
export interface RolloutStage {
  /** Stable id, e.g. canary-25, preview, switched. */
  id: string;
  /** The candidate's share of traffic at this stage, 0 to 100. */
  percent: number;
  /** What the stage is called on screen. */
  label: string;
  /** The button that moves an environment to this stage. */
  action: string;
}

/**
 * The Endpoint's split when the rollout started, which abandoning restores.
 * A rollout recorded before the baseline was kept has `stable` alone.
 */
export function stableSplit(
  rollout: EndpointRollout,
): EndpointWeightOverride[] {
  const kept = (rollout.baseline ?? []).filter(b => b.weight > 0);
  return kept.length > 0 ? kept : [{ name: rollout.stable, weight: 100 }];
}

/**
 * The backends outside the rollout: every version serving when it started
 * other than the one it replaces. Like the other services on an Argo
 * Rollouts or Flagger route, they keep their traffic throughout.
 */
export function untouchedSplit(
  rollout: EndpointRollout,
): EndpointWeightOverride[] {
  return stableSplit(rollout).filter(
    b => b.name !== rollout.stable && b.name !== rollout.candidate,
  );
}

/** The version the rollout replaces, on screen. */
export function stableLabel(rollout: EndpointRollout): string {
  return rollout.stable;
}

/**
 * The split a completed rollout leaves: the new version with the replaced
 * version's weight, and every untouched backend as it was.
 */
export function completeSplit(
  rollout: EndpointRollout,
): EndpointWeightOverride[] {
  const untouched = untouchedSplit(rollout);
  if (untouched.length === 0) return [{ name: rollout.candidate, weight: 100 }];
  const replaced =
    stableSplit(rollout).find(b => b.name === rollout.stable)?.weight ?? 0;
  return [...untouched, { name: rollout.candidate, weight: replaced }];
}

/**
 * Splits `total` across `weights` in their ratio as whole numbers that add
 * up to `total` exactly (largest remainder).
 */
function shareOut(
  weights: EndpointWeightOverride[],
  total: number,
): EndpointWeightOverride[] {
  const sum = weights.reduce((acc, w) => acc + w.weight, 0);
  if (sum <= 0) return weights.map(w => ({ ...w, weight: 0 }));
  const exact = weights.map(w => (w.weight / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((acc, w) => acc + w, 0);
  exact
    .map((x, i) => ({ i, rest: x - out[i] }))
    .sort((a, b) => b.rest - a.rest)
    .forEach(({ i }) => {
      if (left > 0) {
        out[i] += 1;
        left -= 1;
      }
    });
  return weights.map((w, i) => ({ name: w.name, weight: out[i] }));
}

/**
 * The header an A/B test's group must also carry: the recorded audience, or
 * the phone User-Agent for rollouts recorded with mobileOnly.
 */
export function abAudience(
  preview: RolloutPreview | undefined,
): EndpointHeaderMatch | undefined {
  if (preview?.audience) return preview.audience;
  return preview?.mobileOnly ? MOBILE_USER_AGENT : undefined;
}

/** The default canary steps. */
export const DEFAULT_CANARY_STEPS = [5, 25, 50, 100];

/** The stages of a rollout, in order; the first is always 0%. */
export function rolloutStages(rollout: EndpointRollout): RolloutStage[] {
  switch (rollout.strategy) {
    case 'blueGreen':
      return [
        {
          id: 'preview',
          percent: 0,
          label: 'Preview only',
          action: `Switch back to ${stableLabel(rollout)}`,
        },
        {
          id: 'switched',
          percent: 100,
          label: `Switched to ${rollout.candidate}`,
          action: `Switch to ${rollout.candidate}`,
        },
      ];
    case 'abTest':
      return [
        {
          id: 'experiment',
          percent: 0,
          label: 'Experiment running',
          action: 'Restart the experiment',
        },
        {
          id: 'shipped',
          percent: 100,
          label: `${rollout.candidate} for everyone`,
          action: `Ship ${rollout.candidate} to everyone`,
        },
      ];
    default:
      return [
        {
          id: 'canary-0',
          percent: 0,
          label: 'Not started',
          action: `Roll back to ${stableLabel(rollout)}`,
        },
        ...rollout.steps.map(p => ({
          id: p >= 100 ? 'canary-100' : `canary-${p}`,
          percent: p,
          label:
            p >= 100 ? `All traffic on ${rollout.candidate}` : `Canary ${p}%`,
          action:
            p >= 100
              ? `Send all traffic to ${rollout.candidate}`
              : `Advance to ${p}%`,
        })),
      ];
  }
}

/**
 * Finds an environment's stage from the weights it serves (backend name to
 * effective weight). Weights that match no stage are "set by hand".
 */
export function rolloutPosition(
  rollout: EndpointRollout,
  weights: Record<string, number>,
): RolloutPosition {
  // The candidate's share of the traffic it and the replaced version get;
  // untouched backends are outside the rollout.
  const candidate = weights[rollout.candidate] ?? 0;
  const total = candidate + (weights[rollout.stable] ?? 0);
  const percent = total > 0 ? Math.round((candidate / total) * 100) : 0;
  const index = rolloutStages(rollout).findIndex(s => s.percent === percent);
  return { index, percent, manual: index < 0 };
}

/** The stage after `index`, or undefined at the last stage. */
export function nextRolloutStage(
  rollout: EndpointRollout,
  position: RolloutPosition,
): RolloutStage | undefined {
  const stages = rolloutStages(rollout);
  if (position.manual) {
    return stages.find(s => s.percent > position.percent);
  }
  return stages[position.index + 1];
}

/** Weights total this much when untouched backends share the route. */
const SHARED_TOTAL = 10000;

/**
 * The binding weights that put an environment at `percent`: the candidate
 * gets that share of the replaced version's traffic, the replaced version
 * the rest, untouched backends their baseline share, and any other backend
 * 0. With nothing untouched the weights add up to 100; otherwise to 10000,
 * so a step of a small slice still reads back exactly.
 */
export function rolloutWeights(
  rollout: EndpointRollout,
  backendNames: string[],
  percent: number,
): EndpointWeightOverride[] {
  const untouched = untouchedSplit(rollout).filter(b =>
    backendNames.includes(b.name),
  );
  const replaced =
    stableSplit(rollout).find(b => b.name === rollout.stable)?.weight ?? 0;
  const untouchedTotal = untouched.reduce((sum, b) => sum + b.weight, 0);
  let slice = 100;
  let others = new Map<string, number>();
  if (untouched.length > 0 && replaced > 0) {
    slice = Math.round((SHARED_TOTAL * replaced) / (replaced + untouchedTotal));
    others = new Map(
      shareOut(untouched, SHARED_TOTAL - slice).map(b => [b.name, b.weight]),
    );
  }
  const candidate = Math.round((slice * percent) / 100);
  return backendNames.map(name => {
    if (name === rollout.candidate) return { name, weight: candidate };
    if (name === rollout.stable) return { name, weight: slice - candidate };
    return { name, weight: others.get(name) ?? 0 };
  });
}

const isWeight = (b: any): b is EndpointWeightOverride =>
  typeof b?.name === 'string' &&
  typeof b?.weight === 'number' &&
  Number.isFinite(b.weight) &&
  b.weight >= 0;

/** The backends other than `candidate`, with their current weights. */
function baselineOf(
  backends: EndpointBackendWeight[],
  candidate: string,
): EndpointWeightOverride[] {
  return backends
    .map(b => ({ name: b.name ?? b.componentName, weight: b.weight }))
    .filter(b => b.name !== candidate);
}

/** Reads the rollout annotation; undefined when absent or unreadable. */
export function parseRollout(
  annotations: Record<string, string> | undefined,
): EndpointRollout | undefined {
  const raw = annotations?.[ROLLOUT_ANNOTATION];
  if (!raw) return undefined;
  try {
    const r = JSON.parse(raw);
    if (
      ['canary', 'blueGreen', 'abTest'].includes(r?.strategy) &&
      typeof r.stable === 'string' &&
      typeof r.candidate === 'string' &&
      Array.isArray(r.steps)
    ) {
      const { baseline, ...rest } = r;
      return {
        ...rest,
        ...(Array.isArray(baseline) &&
          baseline.every(isWeight) && { baseline }),
      } as EndpointRollout;
    }
  } catch {
    // An unreadable annotation is ignored: the strategy is detected instead.
  }
  return undefined;
}

/** Writes the rollout annotation value. */
export function serializeRollout(rollout: EndpointRollout): string {
  return JSON.stringify(rollout);
}

/**
 * The rollout an Endpoint is running: the recorded one, or one detected from
 * its backends and rules for Endpoints changed outside the portal.
 */
export function currentRollout(
  annotations: Record<string, string> | undefined,
  backends: EndpointBackendWeight[],
  rules: EndpointRule[],
): { rollout?: EndpointRollout; source: 'annotation' | 'detected' | 'none' } {
  const recorded = parseRollout(annotations);
  const names = new Set(backends.map(b => b.name ?? b.componentName));
  if (recorded && names.has(recorded.stable) && names.has(recorded.candidate)) {
    const baseline = recorded.baseline?.filter(b => names.has(b.name));
    return {
      rollout: { ...recorded, ...(baseline && { baseline }) },
      source: 'annotation',
    };
  }
  const detected = detectEndpointStrategy(backends, rules);
  switch (detected.kind) {
    case 'canary':
      return {
        rollout: {
          strategy: 'canary',
          stable: detected.stable,
          candidate: detected.canary,
          baseline: baselineOf(backends, detected.canary),
          steps: DEFAULT_CANARY_STEPS,
        },
        source: 'detected',
      };
    case 'blueGreen':
      return {
        rollout: {
          strategy: 'blueGreen',
          stable: detected.blue,
          candidate: detected.green,
          baseline: baselineOf(backends, detected.green),
          steps: [100],
        },
        source: 'detected',
      };
    case 'abTest':
      return {
        rollout: {
          strategy: 'abTest',
          stable: detected.control,
          candidate: detected.variant,
          baseline: baselineOf(backends, detected.variant),
          steps: [100],
        },
        source: 'detected',
      };
    default:
      return { source: 'none' };
  }
}

/**
 * The backends, rules and annotation that start a rollout, written in one
 * update: the candidate joins at 0% with the rule its preview needs.
 */
export function planRollout(
  backends: EndpointBackendWeight[],
  rules: EndpointRule[],
  plan: RolloutPlan,
  startedBy?: string,
): StrategyChange & { rollout: EndpointRollout } {
  const preview = plan.preview;
  let change: StrategyChange;
  switch (plan.strategy) {
    case 'blueGreen':
      change = buildBlueGreen(backends, rules, plan.candidate, {
        name: preview?.name || 'x-preview',
        value: preview?.value || 'green',
      });
      break;
    case 'abTest':
      change = buildABTest(
        backends,
        rules,
        plan.candidate,
        { name: preview?.name || 'exp_group', value: preview?.value || 'b' },
        abAudience(preview),
      );
      break;
    default:
      change = buildCanary(
        backends,
        rules,
        plan.candidate,
        preview?.kind === 'header' && preview.name && preview.value
          ? { name: preview.name, value: preview.value }
          : undefined,
      );
  }
  const candidate =
    change.backends.find(
      b =>
        b.componentName === plan.candidate.componentName &&
        b.endpoint === plan.candidate.endpoint,
    ) ?? change.backends[change.backends.length - 1];
  const steps =
    plan.strategy === 'canary'
      ? [
          ...new Set(
            (plan.steps?.length ? plan.steps : DEFAULT_CANARY_STEPS).filter(
              p => p > 0 && p <= 100,
            ),
          ),
        ].sort((a, b) => a - b)
      : [100];
  if (steps[steps.length - 1] !== 100) steps.push(100);
  const candidateName = candidate.name ?? candidate.componentName;
  // The rollout replaces one version, the picked one or else the one with
  // the most traffic; the others keep their weights (the baseline records
  // the whole split for abandoning).
  const baseline = baselineOf(backends, candidateName);
  const stable =
    baseline.find(b => b.name === plan.replaces && b.weight > 0)?.name ??
    [...baseline].sort((a, b) => b.weight - a.weight)[0]?.name ??
    candidateName;
  return {
    ...change,
    rollout: {
      strategy: plan.strategy,
      stable,
      candidate: candidateName,
      baseline,
      steps,
      ...(preview && { preview }),
      startedAt: new Date().toISOString(),
      ...(startedBy && { startedBy }),
    },
  };
}

/**
 * Environments that must move before the rollout can complete: those whose
 * candidate share is not yet 100%. Abandoning is always allowed, since it
 * only moves traffic back to the stable version.
 */
export function completionBlockers<
  E extends { name: string; displayName: string; bindingName?: string },
>(environments: E[], positions: Record<string, RolloutPosition>): E[] {
  return environments.filter(
    e => e.bindingName && (positions[e.name]?.percent ?? 0) !== 100,
  );
}
