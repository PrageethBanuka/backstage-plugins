import { Box, Button, Typography } from '@material-ui/core';
import { Link } from '@backstage/core-components';
import { Card, Skeleton } from '@openchoreo/backstage-design-system';
import { useOverviewCardStyles } from '../Environments/OverviewCard/styles';
import { TrafficSplitBar } from '../Endpoints/TrafficSplitBar';
import { useEndpointOverview } from './useEndpointOverview';
import { EndpointLifecycle } from './EndpointLifecycle';

/** Endpoint Overview card: the Endpoint's latest split and where it comes from. */
export const EndpointTrafficOverviewCard = () => {
  const classes = useOverviewCardStyles();
  const { endpoint, loading, error } = useEndpointOverview();

  if (loading) {
    return (
      <Card padding={16} className={classes.card}>
        <Box className={classes.cardHeader}>
          <Skeleton variant="text" width={100} height={28} />
        </Box>
        <Skeleton variant="rect" height={60} />
      </Card>
    );
  }

  return (
    <Card padding={16} className={classes.card}>
      <Box className={classes.cardHeader}>
        <Typography className={classes.cardTitle}>Traffic</Typography>
        <Typography variant="caption" color="textSecondary">
          latest release
        </Typography>
      </Box>

      {error || !endpoint ? (
        <Box className={classes.disabledState}>
          <Typography variant="body2" color={error ? 'error' : 'textSecondary'}>
            {error
              ? `Failed to load the endpoint: ${error.message}`
              : 'This endpoint no longer exists.'}
          </Typography>
        </Box>
      ) : (
        <Box className={classes.content}>
          <TrafficSplitBar
            backends={endpoint.backends}
            showLegend
            height={12}
          />
          <Typography variant="body2" color="textSecondary">
            Type {endpoint.type.name}
            {endpoint.latestRelease ? ` · ${endpoint.latestRelease}` : ''}
          </Typography>
          <EndpointLifecycle endpoint={endpoint} />
        </Box>
      )}

      <Box className={classes.actions}>
        <Link to="environments" style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary" size="small">
            Change traffic
          </Button>
        </Link>
      </Box>
    </Card>
  );
};
