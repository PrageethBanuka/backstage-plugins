import { useEffect, useState } from 'react';
import { Box, Button, Tooltip, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Link } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Card, StatusBadge } from '@openchoreo/backstage-design-system';
import type { ComponentTrafficEntry } from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { useOverviewCardStyles } from '../Environments/OverviewCard/styles';
import { useEnvironmentDetailPanelStyles } from '../Environments/styles';
import { deriveEndpointBadgeStatus, ENDPOINT_BADGE_LABEL } from './badgeStatus';

const useStyles = makeStyles(theme => ({
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  },
  rowHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  },
  share: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  shareBar: {
    flex: '1 1 auto',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: theme.palette.action.hover,
  },
  shareFill: {
    height: '100%',
    backgroundColor: theme.palette.primary.main,
  },
  pct: {
    fontVariantNumeric: 'tabular-nums',
    minWidth: 64,
    textAlign: 'right',
  },
}));

/**
 * Component Overview card: which Endpoints send traffic to this component,
 * and how much, per environment. Built on the Overview card template
 * (DeploymentStatusCard). Renders nothing when no Endpoint routes to the
 * component, so the Overview is unchanged for anyone not using Endpoints.
 */
export const TrafficCard = () => {
  const classes = useStyles();
  const urlClasses = useEnvironmentDetailPanelStyles();
  const cardClasses = useOverviewCardStyles();
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const [entries, setEntries] = useState<ComponentTrafficEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .fetchComponentTraffic(entity)
      .then(res => {
        if (!cancelled) setEntries(res ?? []);
      })
      // The card is supplementary: on any error (including 403) it stays
      // hidden rather than adding a failure to the Overview.
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, entity]);

  if (!entries || entries.length === 0) {
    return null;
  }

  const namespace = entity.metadata.namespace || 'default';
  const endpointsTab = `/catalog/${namespace}/component/${entity.metadata.name}/endpoints`;

  return (
    <Card padding={16} className={cardClasses.card}>
      <Box className={cardClasses.cardHeader}>
        <Typography className={cardClasses.cardTitle}>Traffic</Typography>
        <Typography variant="caption" color="textSecondary">
          via Endpoints
        </Typography>
      </Box>

      <Box className={cardClasses.content}>
        {entries.map(entry => (
          <Box
            key={`${entry.endpointName}/${entry.environment}`}
            className={classes.row}
          >
            <Box className={classes.rowHead}>
              <Typography variant="body2">
                <Link
                  to={`/catalog/${namespace}/endpoint/${entry.endpointName}`}
                >
                  <strong>{entry.endpointName}</strong>
                </Link>{' '}
                <Typography
                  component="span"
                  variant="body2"
                  color="textSecondary"
                >
                  · {entry.environment}
                </Typography>
              </Typography>
              <StatusBadge
                status={deriveEndpointBadgeStatus(entry.status)}
                label={ENDPOINT_BADGE_LABEL[entry.status]}
              />
            </Box>
            <Box
              className={classes.share}
              role="img"
              aria-label={`${entry.sharePercent}% of ${entry.endpointName} traffic in ${entry.environment}`}
            >
              <Box className={classes.shareBar}>
                <Box
                  className={classes.shareFill}
                  style={{ width: `${entry.sharePercent}%` }}
                />
              </Box>
              <Typography variant="caption" className={classes.pct}>
                {entry.sharePercent}% here
              </Typography>
            </Box>
            {entry.invokeURL && (
              <Box className={urlClasses.inlineUrlRow}>
                <Tooltip title={entry.invokeURL}>
                  <a
                    href={entry.invokeURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={urlClasses.inlineUrl}
                  >
                    {entry.invokeURL}
                  </a>
                </Tooltip>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Box className={cardClasses.actions}>
        <Link to={endpointsTab} style={{ textDecoration: 'none' }}>
          <Button variant="outlined" color="primary" size="small">
            All endpoints
          </Button>
        </Link>
      </Box>
    </Card>
  );
};
