import {
  nextRolloutStage,
  rolloutStages,
  type EndpointBackendWeight,
  type EndpointEnvironment,
  type EndpointRollout,
  type EndpointSummary,
  type RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';

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
    question: 'Which version works better for users?',
    pitch: 'Show a variant to one cookie group and compare.',
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

/** The stage shown on a tile, e.g. "Canary 25%" or "30% · set by hand". */
export function stageText(
  env: EndpointEnvironment,
  rollout: EndpointRollout,
): string {
  if (!inRollout(env, rollout) || !env.rollout) return 'Not started';
  if (env.rollout.manual) return `${env.rollout.percent}% · set by hand`;
  return rolloutStages(rollout)[env.rollout.index]?.label ?? 'Not started';
}

/** The tile's primary button on the Rollout tab. */
export type RolloutAction =
  | { kind: 'promote'; label: string; from: string }
  | {
      kind: 'stage';
      label: string;
      percent: number;
      /** This step also completes the rollout (last environment's switch). */
      completes: boolean;
    }
  | { kind: 'complete'; label: string };

/**
 * True when an environment no longer holds the rollout back: it runs the
 * new version with all traffic, or the Endpoint is not routed there. This
 * is the same check the backend makes before it completes a rollout, so
 * an environment that runs the Endpoint but that the rollout has not
 * reached counts as not done.
 */
function doneForCompletion(
  e: EndpointEnvironment,
  rollout: EndpointRollout,
): boolean {
  if (!e.bindingName) return true;
  return inRollout(e, rollout) && e.rollout?.percent === 100;
}

/**
 * Where the rollout is completed: the furthest environment in pipeline
 * order that runs the Endpoint (production, unless the Endpoint stops
 * short of it). Complete is an Endpoint-wide action, so it sits at the end
 * of the pipeline instead of on every tile.
 */
export function completionEnvironment(
  environments: EndpointEnvironment[],
): EndpointEnvironment | undefined {
  return [...environments].reverse().find(e => e.bindingName);
}

/** True once every environment running the Endpoint is done (see above). */
export function readyToComplete(
  environments: EndpointEnvironment[],
  rollout: EndpointRollout,
): boolean {
  return environments.every(e => doneForCompletion(e, rollout));
}

/**
 * The one next step in an environment: bring the rollout here from the
 * nearest environment before it that has it, or move to the next stage.
 * The last environment running the Endpoint also completes the rollout
 * once every environment sends all traffic to the new version; for
 * blue/green and A/B its switch does both at once.
 */
export function rolloutAction(
  env: EndpointEnvironment,
  endpoint: EndpointSummary,
  environments: EndpointEnvironment[],
): RolloutAction | undefined {
  const rollout = endpoint.rollout;
  if (!rollout) return undefined;
  if (!inRollout(env, rollout)) {
    const source = environments
      .slice(0, Math.max(0, environments.indexOf(env)))
      .reverse()
      .find(e => inRollout(e, rollout));
    // An environment that does not run the Endpoint only gets the rollout
    // from the environment right before it, as Promote does elsewhere.
    const adjacent =
      environments[environments.indexOf(env) - 1]?.name === source?.name;
    if (source && (env.bindingName || adjacent)) {
      return {
        kind: 'promote',
        label: `Promote from ${source.displayName}`,
        from: source.name,
      };
    }
    return undefined;
  }
  const done = (e: EndpointEnvironment) => doneForCompletion(e, rollout);
  const isLast = completionEnvironment(environments)?.name === env.name;
  if (environments.every(done)) {
    return isLast ? { kind: 'complete', label: 'Complete rollout' } : undefined;
  }
  const next = nextRolloutStage(
    rollout,
    env.rollout ?? { index: 0, percent: 0, manual: false },
  );
  if (!next) return undefined;
  return {
    kind: 'stage',
    label: next.action,
    percent: next.percent,
    completes:
      isLast &&
      rollout.strategy !== 'canary' &&
      next.percent === 100 &&
      environments.every(e => e.name === env.name || done(e)),
  };
}

/** The command that reaches the new version before it gets traffic. */
export function previewCommand(
  rollout: EndpointRollout,
  url: string | undefined,
): string | undefined {
  const p = rollout.preview;
  if (!p) return undefined;
  const target = url ?? '<endpoint URL>';
  if (p.kind === 'header') return `curl -H '${p.name}: ${p.value}' ${target}`;
  return `curl -H 'Cookie: ${p.name}=${p.value}'${
    p.mobileOnly ? " -A 'Mobile'" : ''
  } ${target}`;
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
