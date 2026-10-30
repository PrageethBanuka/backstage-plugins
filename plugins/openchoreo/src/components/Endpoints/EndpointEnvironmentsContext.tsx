import { createContext, useContext, type ReactNode } from 'react';
import type {
  EndpointEnvironment,
  EndpointReleaseSummary,
  EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import type { RolloutAction } from './endpointRolloutUi';

/**
 * What the canvas shows: deploy (versions of the routing per environment,
 * like a Resource) or, while a rollout runs, its steps.
 */
export type EndpointTabMode = 'deploy' | 'rollout';

export type ActionKind = 'rollout' | 'stop' | 'stage';

export interface EndpointEnvironmentsContextValue {
  mode: EndpointTabMode;
  endpoint: EndpointSummary;
  environments: EndpointEnvironment[];
  /** The Endpoint's releases, newest first. */
  releases: EndpointReleaseSummary[];
  loading: boolean;
  refetch: () => void | Promise<void>;

  pendingAction: { env: string; kind: ActionKind } | null;

  /** Pin `environment` to `releaseName`: deploy, promote or go back. */
  onRollOut: (environment: string, releaseName: string) => void | Promise<void>;
  /** Ask to stop routing in an environment (opens the confirmation). */
  onStopRoutingRequest: (environment: string) => void;
  /** Open the version history for an environment. */
  onViewReleases: (environment: string) => void;
  /** Open the K8s artifacts of an environment's binding. */
  onViewArtifacts: (environment: string) => void;
  /** Set an environment's weights by hand. */
  onConfigureOverrides: (environment: string) => void;
  /** Open the environment's overrides of the EndpointType's configs. */
  onConfigureEnvironment: (environment: string) => void;
  /** Run a tile's next rollout step. */
  onRolloutAction: (environment: string, action: RolloutAction) => void;
  /** Send all of an environment's traffic back to the stable version. */
  onRollBack: (environment: string) => void;
  /** Open the Manage rollout dialog for an environment. */
  onOpenRolloutDialog: (environment: string) => void;
  onCopy: (text: string, label: string) => void;
}

const EndpointEnvironmentsContext =
  createContext<EndpointEnvironmentsContextValue | null>(null);

interface ProviderProps {
  value: EndpointEnvironmentsContextValue;
  children: ReactNode;
}

export const EndpointEnvironmentsProvider = ({
  value,
  children,
}: ProviderProps) => (
  <EndpointEnvironmentsContext.Provider value={value}>
    {children}
  </EndpointEnvironmentsContext.Provider>
);

export function useEndpointEnvironmentsContext(): EndpointEnvironmentsContextValue {
  const ctx = useContext(EndpointEnvironmentsContext);
  if (!ctx) {
    throw new Error(
      'useEndpointEnvironmentsContext must be called inside <EndpointEnvironmentsProvider>',
    );
  }
  return ctx;
}

/** The split a release sends, or undefined when the release is unknown. */
export function releaseBackends(
  releases: EndpointReleaseSummary[],
  releaseName: string | undefined,
) {
  return releases.find(r => r.name === releaseName)?.backends;
}
