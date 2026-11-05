import { createContext, useContext } from 'react';
import type { EndpointEnvironment, EndpointSummary } from './pdTypes';

export interface ProgressiveDeliveryContextValue {
  endpoint: EndpointSummary;
  environments: EndpointEnvironment[];
  /** Opens Configure for an environment, by resource name. */
  onOpenRolloutDialog: (environment: string) => void;
  onCopy: (text: string, what: string) => void;
  /** Asks to keep only the new version, or to remove it, everywhere. */
  onFinish?: (outcome: 'complete' | 'abandon') => void;
  /** Asks to turn a mirror into a canary. */
  onConvert?: () => void;
  /** Why rollout changes are blocked right now; empty when they are not. */
  changeBlocked?: string;
}

const ProgressiveDeliveryContext =
  createContext<ProgressiveDeliveryContextValue | null>(null);

export const ProgressiveDeliveryProvider = ProgressiveDeliveryContext.Provider;

export function useEndpointEnvironmentsContext(): ProgressiveDeliveryContextValue {
  const value = useContext(ProgressiveDeliveryContext);
  if (!value) {
    throw new Error(
      'useEndpointEnvironmentsContext must be used within a ProgressiveDeliveryProvider',
    );
  }
  return value;
}

/** The progressive delivery state, or null on an Endpoint that has none loaded. */
export function useProgressiveDelivery(): ProgressiveDeliveryContextValue | null {
  return useContext(ProgressiveDeliveryContext);
}
