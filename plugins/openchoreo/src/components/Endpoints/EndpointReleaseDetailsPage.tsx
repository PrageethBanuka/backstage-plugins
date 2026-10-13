import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { DetailPageLayout } from '@openchoreo/backstage-plugin-react';
import type {
  EndpointEnvironment,
  EndpointRoutingStatus,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { isForbiddenError, getErrorMessage } from '../../utils/errorUtils';
import { useEnvironmentPolling } from '../Environments/hooks';
import {
  ResourceTreeSourceContext,
  ResourceTreeView,
  type ResourceTreeSource,
} from '../Environments/ReleaseDataRenderer/ResourceTreeView';

const useStyles = makeStyles(theme => ({
  centered: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(4),
    gap: theme.spacing(2),
    minHeight: '300px',
  },
  errorContainer: {
    padding: theme.spacing(3),
    backgroundColor: theme.palette.error.light,
    borderRadius: theme.shape.borderRadius,
    color: theme.palette.error.dark,
  },
  errorTitle: {
    fontWeight: 600,
    marginBottom: theme.spacing(1),
  },
}));

/** The tree view reads a binding's health from a flat status. */
const TREE_STATUS: Record<
  EndpointRoutingStatus,
  'Ready' | 'NotReady' | 'Failed'
> = {
  Routing: 'Ready',
  Applying: 'NotReady',
  Releasing: 'NotReady',
  BackendsUnresolved: 'NotReady',
  NotRouted: 'NotReady',
  Failed: 'Failed',
};

/**
 * The K8s artifacts an Endpoint environment applied: the
 * EndpointReleaseBinding, the RenderedRelease it owns and the route. It
 * reuses the Component page's resource tree and events view; only the
 * source of the tree and events differs.
 */
export const EndpointReleaseDetailsPage = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const { entity } = useEntity();
  const { envName = '' } = useParams();
  const client = useApi(openChoreoClientApiRef);

  const namespaceName =
    entity.metadata.annotations?.['openchoreo.io/namespace'] ?? '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState<EndpointEnvironment | null>(null);
  const [tree, setTree] = useState<any>(null);

  const load = useCallback(
    async (showLoadingState = true) => {
      if (showLoadingState) {
        setLoading(true);
        setError(null);
      }
      try {
        const envs = await client.fetchEndpointEnvironmentInfo(entity);
        const current = envs.find(e => e.name === envName) ?? null;
        let nextTree: any = { renderedReleases: [] };
        if (current?.bindingName) {
          nextTree = await client.fetchEndpointResourceTree(
            entity,
            current.bindingName,
          );
        }
        setEnv(current);
        setTree(nextTree);
      } catch (err: unknown) {
        if (!showLoadingState) throw err;
        setError(
          isForbiddenError(err)
            ? 'You do not have permission to view the artifacts of this endpoint. Contact your administrator.'
            : getErrorMessage(err),
        );
      } finally {
        if (showLoadingState) setLoading(false);
      }
    },
    [client, entity, envName],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const poll = useCallback(() => {
    void load(false).catch(() => {
      // Background refreshes stay quiet; the manual refresh reports errors.
    });
  }, [load]);
  useEnvironmentPolling(Boolean(env?.bindingName), poll);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const bindingName = env?.bindingName ?? '';

  const source = useMemo<ResourceTreeSource>(
    () => ({
      rootKind: 'EndpointReleaseBinding',
      fetchEvents: resource =>
        client.fetchEndpointResourceEvents(entity, bindingName, resource),
    }),
    [client, entity, bindingName],
  );

  const bindingData = useMemo<Record<string, unknown> | null>(
    () =>
      env?.bindingName
        ? {
            name: env.bindingName,
            status: TREE_STATUS[env.status] ?? 'NotReady',
            statusReason: env.statusReason,
            statusMessage: env.statusMessage,
            releaseName: env.endpointRelease,
            environment: env.name,
          }
        : null,
    [env],
  );

  const actions = error ? (
    <Button onClick={() => void load()} color="primary" variant="outlined">
      Retry
    </Button>
  ) : undefined;

  return (
    <DetailPageLayout
      title="K8s artifacts"
      subtitle={env?.displayName ?? envName}
      onBack={() => navigate('..')}
      actions={actions}
    >
      {loading && (
        <Box className={classes.centered}>
          <CircularProgress />
          <Typography variant="body2" color="textSecondary">
            Loading K8s artifacts...
          </Typography>
        </Box>
      )}

      {error && !loading && (
        <Box className={classes.errorContainer}>
          <Typography className={classes.errorTitle}>
            Error loading K8s artifacts
          </Typography>
          <Typography variant="body2">{error}</Typography>
        </Box>
      )}

      {!loading && !error && bindingData && (
        <ResourceTreeSourceContext.Provider value={source}>
          <ResourceTreeView
            resourceTreeData={tree ?? { renderedReleases: [] }}
            releaseBindingData={bindingData}
            namespaceName={namespaceName}
            releaseBindingName={bindingName}
            onRefresh={handleRefresh}
            isRefreshing={refreshing}
          />
        </ResourceTreeSourceContext.Provider>
      )}

      {!loading && !error && !bindingData && (
        <Box className={classes.centered}>
          <Typography variant="body2" color="textSecondary">
            This Endpoint is not routed in {env?.displayName ?? envName} yet, so
            nothing has been applied there.
          </Typography>
        </Box>
      )}
    </DetailPageLayout>
  );
};
