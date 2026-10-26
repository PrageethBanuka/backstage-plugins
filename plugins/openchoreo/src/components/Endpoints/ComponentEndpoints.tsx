import { useEffect, useState } from 'react';
import {
  EmptyState,
  Link,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Box, Button, Tooltip, Typography } from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import { Link as RouterLink } from 'react-router-dom';
import { makeStyles } from '@material-ui/core/styles';
import { PageLoader, StatusBadge } from '@openchoreo/backstage-design-system';
import {
  buildCreateEndpointPath,
  ForbiddenState,
  useEndpointCreatePermission,
} from '@openchoreo/backstage-plugin-react';
import {
  CHOREO_ANNOTATIONS,
  type ComponentTrafficEntry,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../utils/errorUtils';
import { useEnvironmentDetailPanelStyles } from '../Environments/styles';
import { deriveEndpointBadgeStatus, ENDPOINT_BADGE_LABEL } from './badgeStatus';

const useStyles = makeStyles(theme => ({
  shareBar: {
    flex: '1 1 auto',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: theme.palette.action.hover,
    minWidth: 80,
  },
  shareFill: {
    height: '100%',
    backgroundColor: theme.palette.primary.main,
  },
}));

/** Opens the Endpoint template with this component as the first backend. */
const CreateEndpointButton = () => {
  const { entity } = useEntity();
  const { canCreate, loading, createDeniedTooltip } =
    useEndpointCreatePermission();
  const projectName = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.PROJECT];
  const namespaceName =
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE] ??
    entity.metadata.namespace ??
    'default';
  const componentName =
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.COMPONENT] ??
    entity.metadata.name;
  if (!projectName) return null;
  return (
    <span title={createDeniedTooltip}>
      <Button
        variant="outlined"
        color="primary"
        startIcon={<AddIcon />}
        component={RouterLink}
        to={buildCreateEndpointPath(projectName, namespaceName, componentName)}
        disabled={loading || !canCreate}
      >
        Create Endpoint
      </Button>
    </span>
  );
};

/**
 * The Component page's Endpoints tab: every Endpoint that sends traffic to
 * this component, one row per environment, with the component's live share.
 * The list comes from the component's reverse index (status.endpoints).
 * Read-only: traffic is changed on the Endpoint's own page.
 */
export const ComponentEndpoints = () => {
  const classes = useStyles();
  const urlClasses = useEnvironmentDetailPanelStyles();
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const [entries, setEntries] = useState<ComponentTrafficEntry[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .fetchComponentTraffic(entity)
      .then(res => {
        if (!cancelled) setEntries(res ?? []);
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, entity]);

  if (isForbiddenError(error)) {
    return (
      <ForbiddenState
        message="You do not have permission to view endpoints for this component."
        minHeight="400px"
      />
    );
  }
  if (error) {
    return (
      <EmptyState
        missing="data"
        title="Failed to load endpoints"
        description={getErrorMessage(error)}
      />
    );
  }
  if (!entries) {
    return <PageLoader />;
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        missing="content"
        title="No endpoints route to this component"
        description="An Endpoint routes traffic across a project's components with weights, for example a 90/10 canary. Endpoints that include this component appear here."
        action={<CreateEndpointButton />}
      />
    );
  }

  const namespace = entity.metadata.namespace || 'default';
  const columns: TableColumn<ComponentTrafficEntry>[] = [
    {
      title: 'Endpoint',
      field: 'endpointName',
      render: e => (
        <Box>
          <Link to={`/catalog/${namespace}/endpoint/${e.endpointName}`}>
            <strong>{e.endpointName}</strong>
          </Link>
        </Box>
      ),
    },
    { title: 'Environment', field: 'environment' },
    {
      title: 'Share here',
      sorting: false,
      render: e => (
        <Box display="flex" alignItems="center" gridGap={8} minWidth={160}>
          <Box
            className={classes.shareBar}
            role="img"
            aria-label={`${e.sharePercent}% of ${e.endpointName} traffic in ${e.environment}`}
          >
            <Box
              className={classes.shareFill}
              style={{ width: `${e.sharePercent}%` }}
            />
          </Box>
          <Typography variant="caption">{e.sharePercent}%</Typography>
        </Box>
      ),
    },
    {
      title: 'Status',
      field: 'status',
      render: e => (
        <StatusBadge
          status={deriveEndpointBadgeStatus(e.status)}
          label={ENDPOINT_BADGE_LABEL[e.status]}
        />
      ),
    },
    {
      title: 'Invoke URL',
      field: 'invokeURL',
      render: e =>
        e.invokeURL ? (
          <Box className={urlClasses.inlineUrlRow}>
            <Tooltip title={e.invokeURL}>
              <a
                href={e.invokeURL}
                target="_blank"
                rel="noopener noreferrer"
                className={urlClasses.inlineUrl}
              >
                {e.invokeURL}
              </a>
            </Tooltip>
          </Box>
        ) : (
          <Typography variant="caption" color="textSecondary">
            —
          </Typography>
        ),
    },
  ];

  return (
    <Box display="flex" flexDirection="column" gridGap={16}>
      <Box display="flex" justifyContent="flex-end">
        <CreateEndpointButton />
      </Box>
      <Table<ComponentTrafficEntry>
        title={`${entries.length} ${entries.length === 1 ? 'route' : 'routes'}`}
        options={{ paging: false, search: false, padding: 'dense' }}
        columns={columns}
        data={entries}
      />
    </Box>
  );
};
