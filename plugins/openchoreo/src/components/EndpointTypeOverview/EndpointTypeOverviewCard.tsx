import { useEffect, useMemo, useState } from 'react';
import { Box, Grid, Typography } from '@material-ui/core';
import AccessTimeIcon from '@material-ui/icons/AccessTime';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Card, Skeleton } from '@openchoreo/backstage-design-system';
import {
  CHOREO_ANNOTATIONS,
  type EndpointTypeDetails,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { useDataplaneOverviewStyles } from '../DataplaneOverview/styles';
import { extractSchemaProperties } from '../ResourceTypeOverview/ResourceTypeOverviewCard';

// Caps each list at ~10 rows before scroll kicks in.
const LIST_MAX_HEIGHT = 320;

/**
 * Overview of an EndpointType or ClusterEndpointType: the resources it
 * renders for each Endpoint (e.g. an HTTPRoute on the data plane) and the
 * parameters an Endpoint of this type can set. Read-only: endpoint types
 * are managed by platform engineers outside the portal.
 */
export const EndpointTypeOverviewCard = () => {
  const classes = useDataplaneOverviewStyles();
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const createdAt =
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.CREATED_AT];

  const [details, setDetails] = useState<EndpointTypeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .fetchEndpointType(entity)
      .then(res => {
        if (!cancelled) setDetails(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, entity]);

  const parameters = useMemo(
    () => extractSchemaProperties(details?.parametersSchema),
    [details],
  );

  const renderBody = () => {
    if (loading) {
      return (
        <>
          <Skeleton variant="text" width={120} />
          <Skeleton variant="rect" height={64} />
        </>
      );
    }
    if (error || !details) {
      return (
        <Typography variant="body2" color="error">
          Failed to load the endpoint type: {error?.message ?? 'not found'}
        </Typography>
      );
    }
    return (
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <Typography className={classes.statusLabel} gutterBottom>
            Renders ({details.resources.length})
          </Typography>
          {details.resources.length === 0 ? (
            <Typography variant="body2" color="textSecondary">
              No resources declared.
            </Typography>
          ) : (
            <Box style={{ maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' }}>
              {details.resources.map(r => (
                <Box key={r.id} className={classes.infoRow}>
                  <Typography className={classes.infoLabel}>
                    {r.templateKind ?? r.id}
                  </Typography>
                  <Typography className={classes.infoValue}>
                    {r.id} · {r.targetPlane}
                    {r.forEach ? ' · per item' : ''}
                    {r.includeWhen ? ' · conditional' : ''}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Grid>
        <Grid item xs={12} sm={6}>
          <Typography className={classes.statusLabel} gutterBottom>
            Parameters ({parameters.length})
          </Typography>
          {parameters.length === 0 ? (
            <Typography variant="body2" color="textSecondary">
              No parameters declared.
            </Typography>
          ) : (
            <Box style={{ maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto' }}>
              {parameters.map(p => (
                <Box key={p.name} className={classes.infoRow}>
                  <Typography className={classes.infoLabel}>
                    {p.name}
                  </Typography>
                  <Typography className={classes.infoValue}>
                    {p.type}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Grid>
      </Grid>
    );
  };

  return (
    <Card padding={24} className={classes.card}>
      <Box className={classes.cardHeader}>
        <Typography variant="h5">{entity.kind} Details</Typography>
      </Box>
      {createdAt && (
        <Box className={classes.statusGrid}>
          <Box className={classes.statusItem}>
            <AccessTimeIcon className={classes.statusIcon} />
            <Box>
              <Typography className={classes.statusLabel}>Created</Typography>
              <Typography className={classes.statusValue}>
                {new Date(createdAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}
      <Box mt={2}>{renderBody()}</Box>
    </Card>
  );
};
