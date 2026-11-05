import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from './pdTypes';
import { inRollout, servingEnvironments } from './endpointRolloutUi';

/** Names a stage by what the environment serves there, never by backend. */
export function stageName(rollout: EndpointRollout, percent: number): string {
  switch (rollout.strategy) {
    case 'blueGreen':
      return percent >= 100 ? 'New' : 'Current';
    case 'abTest':
      return percent >= 100 ? 'Everyone' : 'Test group';
    case 'mirror':
      return percent === 0 ? 'Off' : `${percent}%`;
    default:
      return `${percent}%`;
  }
}

/**
 * A share in the strategy's words. Blue/green and A/B have no stage between
 * 0 and 100, so a share set there by hand reads as a plain percent.
 */
export function shareName(rollout: EndpointRollout, percent: number): string {
  const twoStage =
    rollout.strategy === 'blueGreen' || rollout.strategy === 'abTest';
  if (twoStage && percent > 0 && percent < 100) return `${percent}%`;
  return stageName(rollout, percent);
}

/**
 * The button that moves an environment to a stage: Abort back to 0, as
 * `occ endpoint rollout abort` does, or the next step by the stage's name.
 */
export function stageAction(rollout: EndpointRollout, percent: number): string {
  return percent === 0 ? 'Abort' : `Next step · ${stageName(rollout, percent)}`;
}

/**
 * What an environment's share gives the new version, said of the backend it
 * replaces, since a step takes only from that backend's traffic.
 */
export function shareMeaning(
  rollout: EndpointRollout,
  percent: number,
): string {
  const { candidate, stable } = rollout;
  const between = percent > 0 && percent < 100;
  if (rollout.strategy === 'blueGreen' && !between) {
    return percent === 0
      ? `Only preview requests reach ${candidate}.`
      : `${candidate} has all of ${stable}’s traffic.`;
  }
  if (rollout.strategy === 'abTest' && !between) {
    return percent === 0
      ? `Only the test group reaches ${candidate}.`
      : `Everyone on ${stable} now reaches ${candidate}.`;
  }
  return `${candidate} gets ${percent}% of ${stable}’s traffic.`;
}

/** Where an environment stands, in the same words as Configure. */
export function stageLabel(
  env: EndpointEnvironment,
  rollout: EndpointRollout,
): string {
  if (!inRollout(env, rollout)) return 'Not deployed';
  const percent = env.rollout?.percent ?? 0;
  if (env.rollout?.manual) return `${percent}% (set by hand)`;
  return stageName(rollout, percent);
}

/** How a rollout ends: keeping the new version, or the current one. */
export type FinishOutcome = 'complete' | 'abandon';

const MOVE_TO: Record<
  EndpointRollout['strategy'],
  Record<FinishOutcome, string>
> = {
  canary: { complete: 'Step them to 100%', abandon: 'Move them to 0%' },
  blueGreen: {
    complete: 'Switch them to New',
    abandon: 'Switch them back to Current',
  },
  abTest: {
    complete: 'Ship them to everyone',
    abandon: 'Move them back to the test group',
  },
  mirror: { complete: '', abandon: 'Turn copying off there' },
};

/**
 * Why the rollout can't end this way yet, or '' when it can. Finishing moves
 * no traffic: the backend that leaves must already get none anywhere, each
 * environment having been moved in its own Configure Traffic.
 */
export function finishProblem(
  rollout: EndpointRollout,
  environments: EndpointEnvironment[],
  outcome: FinishOutcome,
): string {
  if (outcome === 'complete' && rollout.strategy === 'mirror') {
    return `${rollout.candidate} only gets copies. Convert it to a canary first.`;
  }
  const leaving = outcome === 'complete' ? rollout.stable : rollout.candidate;
  const serving = servingEnvironments(environments, leaving);
  if (serving.length === 0) return '';
  const where = serving.map(e => e.displayName).join(', ');
  return `${leaving} still gets traffic in ${where}. ${
    MOVE_TO[rollout.strategy][outcome]
  } first.`;
}

const FINISH_LABEL: Record<EndpointRollout['strategy'], string> = {
  canary: 'Finish canary',
  blueGreen: 'Finish blue/green',
  abTest: 'Finish A/B test',
  mirror: 'Finish mirror',
};

/** The button and dialog that end a rollout, named by its strategy. */
export const finishLabel = (rollout: EndpointRollout): string =>
  FINISH_LABEL[rollout.strategy];
