import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EmptyState,
  Link,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Box, Typography } from '@material-ui/core';
import { PageLoader, StatusBadge } from '@openchoreo/backstage-design-system';
import { ForbiddenState } from '@openchoreo/backstage-plugin-react';
import type { EndpointSummary } from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../utils/errorUtils';
import { deriveEndpointBadgeStatus, ENDPOINT_BADGE_LABEL } from './badgeStatus';
import { TrafficSplitBar } from './TrafficSplitBar';

const columns: TableColumn<EndpointSummary>[] = [
  {
    title: 'Endpoint',
    field: 'name',
    render: ep => (
      <Link to={encodeURIComponent(ep.name)}>
        <strong>{ep.name}</strong>
      </Link>
    ),
  },
  {
    title: 'Type',
    field: 'type.name',
    render: ep => (
      <Typography variant="body2" color="textSecondary">
        {ep.type.name}
      </Typography>
    ),
  },
  {
    title: 'Traffic split (latest)',
    sorting: false,
    render: ep => (
      <Box minWidth={180} maxWidth={260}>
        <TrafficSplitBar backends={ep.backends} showLegend />
      </Box>
    ),
  },
  {
    title: 'Environments',
    sorting: false,
    render: ep =>
      ep.environments.length === 0 ? (
        <Typography variant="body2" color="textSecondary">
          Not routed yet
        </Typography>
      ) : (
        <Box display="flex" flexWrap="wrap" gridGap={6}>
          {ep.environments.map(env => (
            <StatusBadge
              key={env.environment}
              status={deriveEndpointBadgeStatus(env.status)}
              label={`${env.environment}: ${ENDPOINT_BADGE_LABEL[env.status]}`}
            />
          ))}
        </Box>
      ),
  },
];

/**
 * The Project page's Endpoints tab: the project's Endpoints with their
 * latest split and where each is routed. Rows open the Endpoint's pipeline
 * view. Uses the Backstage Table like ProjectContentsCard.
 */
export const EndpointsList = () => {
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const [endpoints, setEndpoints] = useState<EndpointSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);

  const fetchEndpoints = useCallback(async () => {
    try {
      const res = await client.fetchProjectEndpoints(entity);
      if (cancelledRef.current) return;
      setEndpoints(res ?? []);
      setError(null);
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [client, entity]);

  useEffect(() => {
    cancelledRef.current = false;
    void fetchEndpoints();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchEndpoints]);

  if (isForbiddenError(error)) {
    return (
      <ForbiddenState
        message="You do not have permission to view endpoints for this project."
        minHeight="400px"
      />
    );
  }
  if (loading) {
    return <PageLoader />;
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
  if (endpoints.length === 0) {
    return (
      <EmptyState
        missing="content"
        title="No endpoints yet"
        description="An Endpoint routes traffic across this project's components with weights, for example a 90/10 canary. Create one with kubectl or GitOps; it appears here to manage traffic and roll it out."
      />
    );
  }

  return (
    <Table<EndpointSummary>
      title={`${endpoints.length} ${
        endpoints.length === 1 ? 'endpoint' : 'endpoints'
      }`}
      options={{ paging: false, search: false, padding: 'dense' }}
      columns={columns}
      data={endpoints}
    />
  );
};
