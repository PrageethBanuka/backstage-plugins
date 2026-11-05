import type {
  EndpointBackendWeight,
  EndpointRolloutInfo,
  EndpointWeightOverride,
  RolloutPosition,
} from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment as MentorEnvironment } from '../../../api/OpenChoreoClientApi';
import { envResourceName, formatServiceURL } from '../endpointEnvironmentUtils';

export type EndpointSummary = EndpointRolloutInfo;

export interface EndpointBackendStatus extends EndpointBackendWeight {
  resolved: boolean;
  reason?: string;
}

/** One environment as the progressive delivery views read it. */
export interface EndpointEnvironment {
  /** Environment resource name. */
  name: string;
  displayName: string;
  bindingName?: string;
  endpointRelease?: string;
  status?: string;
  statusMessage?: string;
  invokeURL?: string;
  backends: EndpointBackendStatus[];
  overrides: EndpointWeightOverride[];
  rollout?: RolloutPosition;
  deployedBackends?: string[];
  promotionTargets: { name: string }[];
}

/** Maps an environment of the Endpoint Deploy tab to the progressive delivery view of it. */
export function toPdEnv(
  env: MentorEnvironment,
  info: EndpointSummary | undefined,
): EndpointEnvironment {
  const name = envResourceName(env);
  const served = info?.environments.find(e => e.environment === name);
  const refs = new Map((info?.backends ?? []).map(b => [b.name, b]));
  const url = env.urls?.external ?? env.urls?.internal;
  return {
    name,
    displayName: env.name,
    bindingName: env.bindingName,
    endpointRelease: env.endpointRelease,
    status: env.status,
    statusMessage: env.statusMessage,
    invokeURL: url ? formatServiceURL(url) : undefined,
    backends: (served?.backends ?? []).map(b => {
      const ref = refs.get(b.name);
      return {
        name: b.name,
        componentName: ref?.componentName ?? b.name,
        endpoint: ref?.endpoint ?? '',
        ...(ref?.releaseLine && { releaseLine: ref.releaseLine }),
        weight: b.weight,
        ...(b.mirror && { mirror: b.mirror }),
        resolved: b.resolved,
        reason: b.reason,
      };
    }),
    overrides: served?.overrides ?? [],
    rollout: served?.rollout,
    promotionTargets: (env.promotionTargets ?? []).map(t => ({
      name: t.resourceName ?? t.name,
    })),
  };
}
