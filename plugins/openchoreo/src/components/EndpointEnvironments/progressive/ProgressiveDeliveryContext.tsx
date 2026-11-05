import { createContext, useContext } from 'react';
import type { EndpointEnvironment, EndpointSummary } from './pdTypes';

export interface ProgressiveDeliveryContextValue {
  endpoint: EndpointSummary;
  environments: EndpointEnvironment[];
  onCopy: (text: string, what: string) => void;
  /** Finishes the rollout, keeping the new version or the current one. */
  onFinish?: (outcome: 'complete' | 'abandon') => void;
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
