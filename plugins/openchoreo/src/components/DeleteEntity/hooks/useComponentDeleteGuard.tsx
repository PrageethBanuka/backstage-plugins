import { useEffect, useState, type ReactNode } from 'react';
import { Box, Typography } from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { Link } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { Entity } from '@backstage/catalog-model';
import type { ComponentTrafficEntry } from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../../api/OpenChoreoClientApi';

export interface ComponentDeleteGuard {
  /** True while the component's Endpoint traffic is being checked. */
  checking: boolean;
  /** Where the component still has traffic that must be moved first. */
  routed: ComponentTrafficEntry[];
  /** Note to show in the delete dialog, or undefined when nothing blocks. */
  note?: ReactNode;
}

/**
 * Guard, don't cascade: before deleting a component, check whether an
 * Endpoint still sends it traffic in some environment next to other
 * backends. If so, the delete is blocked (openchoreo-api refuses it with
 * StillRouted anyway) and the dialog names the Endpoint, environment and
 * weight, with a link to change traffic. A component that is the only
 * backend of a release can be deleted; its Endpoint's reclaim policy applies.
 */
export function useComponentDeleteGuard(
  entity: Entity | null,
  open: boolean,
): ComponentDeleteGuard {
  const client = useApi(openChoreoClientApiRef);
  const [checking, setChecking] = useState(false);
  const [routed, setRouted] = useState<ComponentTrafficEntry[]>([]);
  const isComponent = entity?.kind.toLowerCase() === 'component';

  useEffect(() => {
    if (!open || !entity || !isComponent) {
      setRouted([]);
      return undefined;
    }
    let cancelled = false;
    setChecking(true);
    Promise.resolve()
      .then(() => client.fetchComponentTraffic(entity))
      .then(entries => {
        if (!cancelled) {
          setRouted(
            (entries ?? []).filter(e => e.weight > 0 && e.hasOtherBackends),
          );
        }
      })
      .catch(() => {
        // The API refuses a routed delete itself; the check is a convenience.
        if (!cancelled) setRouted([]);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, entity, isComponent, open]);

  if (routed.length === 0) {
    return { checking, routed };
  }
  const namespace = entity?.metadata.namespace || 'default';
  return {
    checking,
    routed,
    note: (
      <Alert severity="error">
        <Typography variant="body2" gutterBottom>
          <strong>{entity?.metadata.name} still receives traffic.</strong>{' '}
          Deleting it now would break a live route, so it is blocked. Move its
          weight to 0 and roll out, then delete.
        </Typography>
        <Box component="ul" m={0} pl={2}>
          {routed.map(e => (
            <li key={`${e.endpointName}/${e.environment}`}>
              <Typography variant="body2">
                <Link to={`/catalog/${namespace}/endpoint/${e.endpointName}`}>
                  {e.endpointName}
                </Link>{' '}
                in {e.environment}: {e.sharePercent}%
              </Typography>
            </li>
          ))}
        </Box>
      </Alert>
    ),
  };
}
