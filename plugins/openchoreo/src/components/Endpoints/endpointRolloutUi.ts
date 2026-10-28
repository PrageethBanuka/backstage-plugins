import {
  abAudience,
  nextRolloutStage,
  rolloutStages,
  stableSplit,
  untouchedSplit,
  type EndpointBackendWeight,
  type EndpointEnvironment,
  type EndpointRollout,
  type EndpointSummary,
  type RolloutPreview,
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
 * The split abandoning restores, e.g. "trips-python 70% · trips-legacy
 * 30%", or just the replaced version's name when it was alone.
 */
export function restoredSummary(rollout: EndpointRollout): string {
  const split = stableSplit(rollout);
  if (split.length === 1) return split[0].name;
  return shares(
    rollout,
    split.map(b => b.name),
  );
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

/** What the replaced version keeps at a stage. */
export function stableKeeps(rollout: EndpointRollout, percent: number): string {
  return `${rollout.stable} keeps ${100 - percent}%${
    untouchedSplit(rollout).length > 0 ? ' of its traffic' : ''
  }`;
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

/** The tile's primary button while a rollout runs. */
export type RolloutAction =
  | { kind: 'promote'; label: string; from: string }
  | { kind: 'stage'; label: string; percent: number }
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
 * Once every environment running the Endpoint sends all traffic to the new
 * version, the last one offers Complete. A blue/green switch or an A/B ship
 * only moves traffic; completing is always its own step, as for a canary.
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
  if (
    rollout.strategy !== 'mirror' &&
    environments.every(e => doneForCompletion(e, rollout))
  ) {
    return completionEnvironment(environments)?.name === env.name
      ? { kind: 'complete', label: `Keep only ${rollout.candidate}` }
      : undefined;
  }
  const next = nextRolloutStage(
    rollout,
    env.rollout ?? { index: 0, percent: 0, manual: false },
  );
  if (!next) return undefined;
  return { kind: 'stage', label: next.action, percent: next.percent };
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
