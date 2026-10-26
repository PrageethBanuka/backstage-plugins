import { Box, Button, Chip, Typography } from '@material-ui/core';
import { Link } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Card, Skeleton } from '@openchoreo/backstage-design-system';
import { useOverviewCardStyles } from '../Environments/OverviewCard/styles';
import { backendKey, sharePercents } from '../Endpoints/endpointUi';
import {
  inRollout,
  stageText,
  STRATEGY_COPY,
} from '../Endpoints/endpointRolloutUi';
import { useEndpointOverview } from './useEndpointOverview';

/**
 * Endpoint Overview card: the components that receive traffic, with their
 * share and how many environments each is deployed in. While a rollout
 * runs, a short summary links to the Rollout tab; there is no separate
 * rollout card, so a basic Endpoint's Overview matches a Resource's.
 */
export const EndpointBackendsCard = () => {
  const classes = useOverviewCardStyles();
  const { entity } = useEntity();
  const { endpoint, environments, loading, error } = useEndpointOverview();
  const namespace = entity.metadata.namespace || 'default';

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

  const backends = endpoint?.backends ?? [];
  const percents = sharePercents(backends.map(b => b.weight));

  return (
    <Card padding={16} className={classes.card}>
      <Box className={classes.cardHeader}>
        <Typography className={classes.cardTitle}>Backends</Typography>
        <Typography variant="caption" color="textSecondary">
          {backends.length} {backends.length === 1 ? 'component' : 'components'}
        </Typography>
      </Box>

      {error ? (
        <Box className={classes.disabledState}>
          <Typography variant="body2" color="error">
            Failed to load backends: {error.message}
          </Typography>
        </Box>
      ) : (
        <Box className={classes.content}>
          {backends.map((b, i) => {
            const deployedIn = environments.filter(e =>
              e.deployedBackends.includes(backendKey(b)),
            ).length;
            return (
              <Box
                key={backendKey(b)}
                display="flex"
                alignItems="baseline"
                justifyContent="space-between"
                gridGap={8}
              >
                <Typography variant="body2">
                  <Link
                    to={`/catalog/${namespace}/component/${b.componentName}`}
                  >
                    <strong>{b.componentName}</strong>
                  </Link>{' '}
                  <Typography
                    component="span"
                    variant="caption"
                    color="textSecondary"
                  >
                    /{b.endpoint}
                  </Typography>
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {percents[i]}% · deployed in {deployedIn}{' '}
                  {deployedIn === 1 ? 'environment' : 'environments'}
                </Typography>
              </Box>
            );
          })}
          {endpoint?.rollout && (
            <Box
              borderTop={1}
              borderColor="divider"
              pt={1}
              display="flex"
              flexDirection="column"
              gridGap={4}
            >
              <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
              >
                <Typography variant="body2">
                  <strong>Rollout</strong>
                </Typography>
                <Chip
                  size="small"
                  color="primary"
                  label={STRATEGY_COPY[endpoint.rollout.strategy].name}
                />
              </Box>
              <Typography variant="caption" color="textSecondary">
                {endpoint.rollout.stable} → {endpoint.rollout.candidate}
                {environments
                  .filter(e => inRollout(e, endpoint.rollout!))
                  .map(
                    e =>
                      ` · ${e.displayName}: ${stageText(e, endpoint.rollout!)}`,
                  )
                  .join('')}
              </Typography>
              <Box>
                <Link to="rollout" style={{ textDecoration: 'none' }}>
                  <Button variant="outlined" color="primary" size="small">
                    Open rollout
                  </Button>
                </Link>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Card>
  );
};
