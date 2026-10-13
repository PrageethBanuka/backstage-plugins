import { Box, Button, Chip, Tooltip, Typography } from '@material-ui/core';
import { Link } from '@backstage/core-components';
import CheckCircleIcon from '@material-ui/icons/CheckCircleOutlined';
import CloudOffIcon from '@material-ui/icons/CloudOff';
import ErrorIcon from '@material-ui/icons/ErrorOutlined';
import WarningIcon from '@material-ui/icons/ReportProblemOutlined';
import { Card, Skeleton } from '@openchoreo/backstage-design-system';
import type { EndpointRoutingStatus } from '@openchoreo/backstage-plugin-common';
import { useOverviewCardStyles } from '../Environments/OverviewCard/styles';
import { ENDPOINT_BADGE_LABEL } from '../Endpoints/badgeStatus';
import { useEndpointOverview } from './useEndpointOverview';

const STATUS_ICON: Record<
  EndpointRoutingStatus,
  { Icon: typeof CloudOffIcon; iconClass: string }
> = {
  Routing: { Icon: CheckCircleIcon, iconClass: 'statusIconReady' },
  Applying: { Icon: WarningIcon, iconClass: 'statusIconWarning' },
  Releasing: { Icon: WarningIcon, iconClass: 'statusIconWarning' },
  BackendsUnresolved: { Icon: WarningIcon, iconClass: 'statusIconWarning' },
  Failed: { Icon: ErrorIcon, iconClass: 'statusIconError' },
  NotRouted: { Icon: CloudOffIcon, iconClass: 'statusIconDefault' },
};

/** Endpoint Overview card: where the Endpoint is routing, per environment. */
export const EndpointDeploymentsCard = () => {
  const classes = useOverviewCardStyles();
  const { environments, loading, error } = useEndpointOverview();

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
        <Typography className={classes.cardTitle}>Deployments</Typography>
      </Box>

      {error ? (
        <Box className={classes.disabledState}>
          <Typography variant="body2" color="error">
            Failed to load environments: {error.message}
          </Typography>
        </Box>
      ) : (
        <Box className={classes.content}>
          {environments.length === 0 && (
            <Typography variant="body2" color="textSecondary">
              No environments configured
            </Typography>
          )}
          <Box className={classes.environmentChips}>
            {environments.map(env => {
              const { Icon, iconClass } = STATUS_ICON[env.status];
              return (
                <Tooltip
                  key={env.name}
                  title={`${env.displayName}: ${
                    ENDPOINT_BADGE_LABEL[env.status]
                  }`}
                >
                  <Chip
                    size="small"
                    className={classes.envChip}
                    variant="outlined"
                    label={
                      <Box display="flex" alignItems="center" gridGap={4}>
                        <Typography variant="body2">{env.name}</Typography>
                        <Icon
                          className={(classes as any)[iconClass]}
                          style={{ fontSize: '18px' }}
                        />
                      </Box>
                    }
                  />
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      )}

      <Box className={classes.actions}>
        <Link to="environments" style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary" size="small">
            Go to Deploy
          </Button>
        </Link>
      </Box>
    </Card>
  );
};
