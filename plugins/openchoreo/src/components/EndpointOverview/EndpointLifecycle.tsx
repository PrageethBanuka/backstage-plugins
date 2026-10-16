import { useState } from 'react';
import {
  Box,
  FormControl,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { useEndpointTrafficPermission } from '@openchoreo/backstage-plugin-react';
import type {
  EndpointReclaimPolicy,
  EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { getErrorMessage } from '../../utils/errorUtils';

/** Turns "workload/payments-v1/http" into "payments-v1 / http". */
export function describeCreatedFrom(createdFrom?: string): string | undefined {
  if (!createdFrom) return undefined;
  if (createdFrom === 'portal') return 'the portal';
  const [kind, component, endpoint] = createdFrom.split('/');
  if (kind === 'workload' && component && endpoint) {
    return `${component} / ${endpoint} (Workload)`;
  }
  return createdFrom;
}

/**
 * The Endpoint's own lifecycle, on the Traffic overview card: where it came
 * from (history only), what happens when its last backend goes, and an
 * Orphaned notice while it has none.
 */
export const EndpointLifecycle = ({
  endpoint,
}: {
  endpoint: EndpointSummary;
}) => {
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const perm = useEndpointTrafficPermission();
  const [policy, setPolicy] = useState<EndpointReclaimPolicy>(
    endpoint.reclaimPolicy,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createdFrom = describeCreatedFrom(endpoint.createdFrom);

  const changePolicy = async (next: EndpointReclaimPolicy) => {
    const previous = policy;
    setPolicy(next);
    setSaving(true);
    setError(null);
    try {
      await client.updateEndpointReclaimPolicy(entity, next);
    } catch (err: unknown) {
      setPolicy(previous);
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box display="flex" flexDirection="column" gridGap={8}>
      {endpoint.problem && (
        <Alert severity="warning">
          Degraded: {endpoint.problem}. Environments keep their last good route.
        </Alert>
      )}
      {endpoint.orphaned && (
        <Alert severity="warning">
          No backends left. The Endpoint is kept without routes until a backend
          is added (reclaim policy Retain).
        </Alert>
      )}
      {createdFrom && (
        <Typography variant="body2" color="textSecondary">
          Created from {createdFrom}
        </Typography>
      )}
      <Box display="flex" alignItems="center" gridGap={8}>
        <Typography variant="body2" color="textSecondary">
          When no backend is left
        </Typography>
        <Tooltip title={perm.deniedTooltip}>
          <FormControl size="small">
            <Select
              value={policy}
              onChange={e =>
                changePolicy(e.target.value as EndpointReclaimPolicy)
              }
              disabled={saving || perm.loading || !perm.canChangeTraffic}
              inputProps={{ 'aria-label': 'Reclaim policy' }}
            >
              <MenuItem value="Delete">Delete the Endpoint</MenuItem>
              <MenuItem value="Retain">Keep it (Orphaned)</MenuItem>
            </Select>
          </FormControl>
        </Tooltip>
      </Box>
      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Box>
  );
};
