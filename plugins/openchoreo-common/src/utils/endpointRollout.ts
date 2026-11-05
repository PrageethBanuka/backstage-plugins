import type {
  EndpointBackendWeight,
  EndpointHeaderMatch,
  EndpointRollout,
  EndpointWeightOverride,
  RolloutPlan,
  RolloutPosition,
  RolloutPreview,
  RolloutSettings,
  EndpointRolloutSpec,
} from '../types/endpoint-rollout-types';
import {
  buildABTest,
  buildBlueGreen,
  buildCanary,
  buildMirror,
  isSameBackend,
  MOBILE_USER_AGENT,
  type StrategyChange,
} from './endpointStrategies';

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
 * The Endpoint's split outside the candidate, which abandoning restores, or
 * `stable` alone when the backends' weights aren't known.
 */
export function stableSplit(
  rollout: EndpointRollout,
): EndpointWeightOverride[] {
  const kept = (rollout.baseline ?? []).filter(b => (b.weight ?? 0) > 0);
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

/** The copy shares a mirror rollout steps through. */
export const MIRROR_STEPS = [5, 10, 25, 50, 100];

/** The stages of a rollout, in order; the first is always 0%. */
export function rolloutStages(rollout: EndpointRollout): RolloutStage[] {
  switch (rollout.strategy) {
    case 'mirror':
      return [
        {
          id: 'mirror-0',
          percent: 0,
          label: 'Not copying',
          action: 'Stop copying',
        },
        ...rollout.steps.map(p => ({
          id: `mirror-${p}`,
          percent: p,
          label: `Copying ${p}%`,
          action: `Copy ${p}%`,
        })),
      ];
    case 'blueGreen':
      return [
        {
          id: 'preview',
          percent: 0,
          label: 'Preview only',
          action: 'Switch back to Current',
        },
        {
          id: 'switched',
          percent: 100,
          label: 'Switched to New version',
          action: 'Switch to New version',
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
          label: 'New version for everyone',
          action: 'Ship to everyone',
        },
      ];
    default:
      return [
        {
          id: 'canary-0',
          percent: 0,
          label: 'Not started',
          action: 'Back to Current',
        },
        ...rollout.steps.map(p => ({
          id: p >= 100 ? 'canary-100' : `canary-${p}`,
          percent: p,
          label: p >= 100 ? 'All traffic on New version' : `Canary ${p}%`,
          action:
            p >= 100 ? 'Send all traffic to New version' : `Next step (${p}%)`,
        })),
      ];
  }
}

/**
 * Finds an environment's stage from what it serves: the effective weight of
 * each backend by name, and for a mirror rollout the candidate's effective
 * copy share. Values that match no stage are "set by hand".
 */
export function rolloutPosition(
  rollout: EndpointRollout,
  weights: Record<string, number>,
  mirrorPercent?: number,
): RolloutPosition {
  // The candidate's share of the traffic it and stable get; untouched
  // backends are outside the rollout.
  const candidate = weights[rollout.candidate] ?? 0;
  const total = candidate + (weights[rollout.stable] ?? 0);
  let percent = total > 0 ? Math.round((candidate / total) * 100) : 0;
  if (rollout.strategy === 'mirror') percent = mirrorPercent ?? 0;
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

const MAX_WEIGHT = 1_000_000;

/**
 * The binding weights that put an environment at `percent`, as openchoreo-api
 * writes them (pkg/endpointrollout): the candidate gets that share of
 * stable's weight and stable the rest. With nothing else on the route they
 * split 100; otherwise every weight is scaled by 100 so the percent is
 * exact, and the other backends keep their share. Used to preview a step.
 */
export function rolloutWeights(
  rollout: EndpointRollout,
  backendNames: string[],
  percent: number,
): EndpointWeightOverride[] {
  if (rollout.strategy === 'mirror') {
    return [{ name: rollout.candidate, mirror: { percent } }];
  }
  const stableWeight = rollout.baseline
    ? rollout.baseline.find(b => b.name === rollout.stable)?.weight ?? 0
    : 100;
  const others = untouchedSplit(rollout).filter(
    b => (b.weight ?? 0) > 0 && backendNames.includes(b.name),
  );
  let slice = 100;
  let scale = 1;
  if (others.length > 0) {
    const fits = [stableWeight, ...others.map(b => b.weight ?? 0)].every(
      w => w * 100 <= MAX_WEIGHT,
    );
    scale = fits ? 100 : 1;
    slice = stableWeight * scale;
  }
  const candidate = Math.round((slice * percent) / 100);
  return backendNames.map(name => {
    if (name === rollout.candidate) return { name, weight: candidate };
    if (name === rollout.stable)
      return { name, weight: Math.max(slice - candidate, 0) };
    const other = others.find(b => b.name === name);
    return { name, weight: other ? (other.weight ?? 0) * scale : 0 };
  });
}

/** The backends other than `candidate`, with their weights. */
function baselineOf(
  backends: EndpointBackendWeight[],
  candidate: string,
): EndpointWeightOverride[] {
  return backends
    .map(b => ({
      name: b.name ?? b.componentName,
      weight: b.mirror ? 0 : b.weight,
    }))
    .filter(b => b.name !== candidate);
}

function candidatePreview(
  strategy: EndpointRollout['strategy'],
  candidate: EndpointBackendWeight | undefined,
): RolloutPreview | undefined {
  const match = candidate?.match;
  if (!match) return undefined;
  const header = match.headers?.[0];
  const cookie = match.cookies?.[0];
  if (strategy === 'abTest' && cookie) {
    return {
      kind: 'cookie',
      name: cookie.name,
      value: cookie.value,
      ...(header && { audience: header }),
    };
  }
  if (match.path) return { kind: 'path', name: '', value: match.path.value };
  if (header) return { kind: 'header', name: header.name, value: header.value };
  return undefined;
}

/**
 * Reads spec.rollout as the portal shows it: the first candidate, its share
 * at each step, the other backends' weights and how the candidate is
 * previewed.
 */
export function fromSpecRollout(
  spec: EndpointRolloutSpec,
  backends: EndpointBackendWeight[],
): EndpointRollout {
  const candidate = spec.candidates[0]?.name ?? '';
  const block = spec.strategy === 'mirror' ? spec.mirror : spec.canary;
  const steps =
    spec.strategy === 'canary' || spec.strategy === 'mirror'
      ? (block?.steps ?? []).map(
          s => s.backends.find(b => b.name === candidate)?.percent ?? 0,
        )
      : [100];
  const preview = candidatePreview(
    spec.strategy,
    backends.find(b => (b.name ?? b.componentName) === candidate),
  );
  return {
    strategy: spec.strategy,
    stable: spec.stable,
    candidate,
    baseline: baselineOf(backends, candidate),
    steps,
    ...(preview && { preview }),
  };
}

/** Writes a rollout as spec.rollout. */
export function toSpecRollout(rollout: EndpointRollout): EndpointRolloutSpec {
  const steps = {
    steps: rollout.steps.map(percent => ({
      backends: [{ name: rollout.candidate, percent }],
    })),
  };
  return {
    strategy: rollout.strategy,
    stable: rollout.stable,
    candidates: [{ name: rollout.candidate }],
    ...(rollout.strategy === 'canary' && { canary: steps }),
    ...(rollout.strategy === 'mirror' && { mirror: steps }),
  };
}

/**
 * The backends and plan that start a rollout, written in one update: the
 * candidate joins at 0% with the match its preview needs, or its mirror.
 */
export function planRollout(
  backends: EndpointBackendWeight[],
  plan: RolloutPlan,
): StrategyChange & { rollout: EndpointRollout } {
  const preview = plan.preview;
  let change: StrategyChange;
  switch (plan.strategy) {
    case 'blueGreen':
      change = buildBlueGreen(
        backends,
        plan.candidate,
        preview?.kind === 'path' && preview.value
          ? { path: preview.value }
          : {
              header: {
                name: preview?.name || 'x-preview',
                value: preview?.value || 'green',
              },
            },
      );
      break;
    case 'mirror':
      // Copying starts at the first step when the release is deployed.
      change = buildMirror(
        backends,
        plan.candidate,
        plan.mirrorPercent ?? mirrorSteps(plan)[0],
      );
      break;
    case 'abTest':
      change = buildABTest(
        backends,
        plan.candidate,
        { name: preview?.name || 'exp_group', value: preview?.value || 'b' },
        abAudience(preview),
      );
      break;
    default:
      change = buildCanary(
        backends,
        plan.candidate,
        preview?.kind === 'header' && preview.name && preview.value
          ? { name: preview.name, value: preview.value }
          : undefined,
      );
  }
  const candidate =
    change.backends.find(b => isSameBackend(b, plan.candidate)) ??
    change.backends[change.backends.length - 1];
  let steps = [100];
  if (plan.strategy === 'canary') {
    steps = [
      ...new Set(
        (plan.steps?.length ? plan.steps : DEFAULT_CANARY_STEPS).filter(
          p => p > 0 && p <= 100,
        ),
      ),
    ].sort((a, b) => a - b);
  } else if (plan.strategy === 'mirror') {
    steps = mirrorSteps(plan);
  }
  if (steps[steps.length - 1] !== 100) steps.push(100);
  const candidateName = candidate.name ?? candidate.componentName;
  // The rollout replaces one version, the picked one or else the one with
  // the most traffic; the others keep their weights.
  const baseline = baselineOf(backends, candidateName);
  const stable =
    baseline.find(b => b.name === plan.replaces && (b.weight ?? 0) > 0)?.name ??
    [...baseline].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0]?.name ??
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
    },
  };
}

/**
 * A mirror's copy shares: the plan's own steps, or the usual ramp through
 * the share it starts at.
 */
function mirrorSteps(plan: RolloutPlan): number[] {
  const chosen = plan.steps?.length
    ? plan.steps
    : [...MIRROR_STEPS, plan.mirrorPercent ?? 100];
  return [...new Set(chosen)]
    .filter(p => p > 0 && p <= 100)
    .sort((a, b) => a - b);
}

/** JSON with object keys sorted, to compare values written in any key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

/**
 * Changes a running rollout's settings: the new version's match or mirror
 * and the steps. The strategy, the versions and the baseline stay.
 * `releaseChanged` says whether the Endpoint's backends change, which cuts
 * a release; steps alone live only in spec.rollout, which isn't.
 */
export function reconfigureRollout(
  backends: EndpointBackendWeight[],
  rollout: EndpointRollout,
  settings: RolloutSettings,
): StrategyChange & { rollout: EndpointRollout; releaseChanged: boolean } {
  const candidate = backends.find(
    b => (b.name ?? b.componentName) === rollout.candidate,
  );
  if (!candidate) return { backends, rollout, releaseChanged: false };
  const planned = planRollout(backends, {
    strategy: rollout.strategy,
    candidate,
    replaces: rollout.stable,
    steps: settings.steps,
    preview: settings.preview,
    // New steps keep the share a running mirror copies now.
    mirrorPercent: settings.mirrorPercent ?? candidate.mirror?.percent,
  });
  const after = planned.backends.find(b => isSameBackend(b, candidate))!;
  const { preview: _preview, ...kept } = rollout;
  return {
    backends: planned.backends,
    rollout: {
      ...kept,
      steps: planned.rollout.steps,
      ...(settings.preview && { preview: settings.preview }),
    },
    releaseChanged:
      canonical([candidate.match, candidate.mirror]) !==
      canonical([after.match, after.mirror]),
  };
}

/**
 * Turns a mirror rollout into a canary on the same backend: the mirror goes,
 * the testers header (if any) becomes its match, and the plan restarts at
 * the canary's first stage.
 */
export function convertToCanary(
  backends: EndpointBackendWeight[],
  rollout: EndpointRollout,
  testerHeader?: { name: string; value: string },
): StrategyChange & { rollout: EndpointRollout } {
  const candidate = backends.find(
    b => (b.name ?? b.componentName) === rollout.candidate,
  );
  const change = candidate
    ? buildCanary(backends, candidate, testerHeader)
    : { backends };
  return {
    ...change,
    rollout: {
      ...rollout,
      strategy: 'canary',
      steps: DEFAULT_CANARY_STEPS,
      preview: testerHeader && { kind: 'header', ...testerHeader },
    },
  };
}
