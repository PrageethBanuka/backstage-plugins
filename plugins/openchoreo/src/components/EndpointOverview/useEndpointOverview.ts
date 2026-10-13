import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import type {
  EndpointEnvironment,
  EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';

export interface EndpointOverview {
  endpoint: EndpointSummary | null;
  environments: EndpointEnvironment[];
  loading: boolean;
  error: Error | null;
}

/**
 * Loads the Endpoint and its per-environment view for the overview cards.
 * Each card calls this on its own, as the Resource overview cards do, so a
 * slow or failing card never blocks the others.
 */
export function useEndpointOverview(): EndpointOverview {
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const [state, setState] = useState<EndpointOverview>({
    endpoint: null,
    environments: [],
    loading: true,
    error: null,
  });

  const load = useCallback(() => {
    let cancelled = false;
    Promise.all([
      client.fetchEndpoint(entity),
      client.fetchEndpointEnvironmentInfo(entity),
    ])
      .then(([endpoint, environments]) => {
        if (cancelled) return;
        setState({
          endpoint,
          environments: environments ?? [],
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          endpoint: null,
          environments: [],
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client, entity]);

  useEffect(() => load(), [load]);

  return state;
}
