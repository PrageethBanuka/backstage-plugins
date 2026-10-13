import { createContext, useContext, type ReactNode } from 'react';
import type {
  EndpointEnvironment,
  EndpointReleaseSummary,
  EndpointSummary,
} from '@openchoreo/backstage-plugin-common';

export type ActionKind = 'rollout' | 'stop';

export interface EndpointEnvironmentsContextValue {
  endpoint: EndpointSummary;
  environments: EndpointEnvironment[];
  /** The Endpoint's releases, newest first. */
  releases: EndpointReleaseSummary[];
  loading: boolean;
  refetch: () => void | Promise<void>;

  pendingAction: { env: string; kind: ActionKind } | null;

  /** Pin `environment` to `releaseName`: roll out, promote or roll back. */
  onRollOut: (environment: string, releaseName: string) => void | Promise<void>;
  /** Ask to stop routing in an environment (opens the confirmation). */
  onStopRoutingRequest: (environment: string) => void;
  /** Open the traffic editor. */
  onChangeTraffic: () => void;
  /** Open the release history for an environment (rollback). */
  onViewReleases: (environment: string) => void;
  /** Open the K8s artifacts of an environment's binding. */
  onViewArtifacts: (environment: string) => void;
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
