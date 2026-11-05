import type {
  EndpointBackendWeight,
  EndpointRollout,
} from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from './pdTypes';
import { inRollout } from './endpointRolloutUi';

/** Names a stage by what the environment serves there, never by backend. */
export function stageName(rollout: EndpointRollout, percent: number): string {
  switch (rollout.strategy) {
    case 'blueGreen':
      return percent >= 100 ? 'New version' : 'Current';
    case 'abTest':
      return percent >= 100 ? 'Everyone' : 'Test group';
    case 'mirror':
      return percent === 0 ? 'Off' : `${percent}%`;
    default:
      return `${percent}%`;
  }
}

/** The button that moves an environment to a stage. */
export function stageAction(rollout: EndpointRollout, percent: number): string {
  switch (rollout.strategy) {
    case 'blueGreen':
      return percent >= 100 ? 'Switch to the new version' : 'Switch back';
    case 'abTest':
      return percent >= 100 ? 'Ship to everyone' : 'Back to the test group';
    case 'mirror':
      return percent === 0 ? 'Stop copying' : `Copy ${percent}%`;
    default:
      return percent === 0 ? 'Back to Current' : `Go to ${percent}%`;
  }
}

/** The split with the rollout's two backends named by their role. */
export function roleSplit(
  split: EndpointBackendWeight[],
  rollout: EndpointRollout,
): EndpointBackendWeight[] {
  return split.map(b => {
    const name = b.name ?? b.componentName;
    if (name === rollout.candidate) {
      return { ...b, componentName: 'New version', releaseLine: undefined };
    }
    if (name === rollout.stable) {
      return { ...b, componentName: 'Current', releaseLine: undefined };
    }
    return b;
  });
}

/** Where an environment stands, in the same words as Configure. */
export function stageLabel(
  env: EndpointEnvironment,
  rollout: EndpointRollout,
): string {
  if (!inRollout(env, rollout)) return 'Not started here';
  const percent = env.rollout?.percent ?? 0;
  if (env.rollout?.manual) return `${percent}% (set by hand)`;
  return stageName(rollout, percent);
}
