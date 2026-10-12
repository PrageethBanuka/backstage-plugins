import { useCallback } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
} from '@material-ui/core';
import AllInboxOutlinedIcon from '@material-ui/icons/AllInboxOutlined';
import CloseIcon from '@material-ui/icons/Close';
import CloudIcon from '@material-ui/icons/Cloud';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import HistoryIcon from '@material-ui/icons/History';
import RefreshIcon from '@material-ui/icons/Refresh';
import ReportProblemOutlinedIcon from '@material-ui/icons/ReportProblemOutlined';
import CallMadeIcon from '@material-ui/icons/CallMade';
import { StatusBadge } from '@openchoreo/backstage-design-system';
import {
  useEndpointRolloutPermission,
  useEndpointTrafficPermission,
} from '@openchoreo/backstage-plugin-react';
import type { EndpointEnvironment } from '@openchoreo/backstage-plugin-common';
import { useNotification } from '../../hooks';
import { useResourceEnvironmentDetailPanelStyles } from '../ResourceEnvironments/styles';
import {
  releaseBackends,
  useEndpointEnvironmentsContext,
} from './EndpointEnvironmentsContext';
import { deriveEndpointBadgeStatus, ENDPOINT_BADGE_LABEL } from './badgeStatus';
import { missingBackends, statusMessage } from './endpointUi';
import { TrafficSplitBar } from './TrafficSplitBar';

interface EndpointEnvironmentDetailPanelProps {
  env: EndpointEnvironment | null;
  onClose: () => void;
}

/**
 * Right pane for a selected environment, built on the Resource detail panel
 * (ResourceEnvironmentDetailPanel) and its styles: what the environment is
 * serving, why it is not serving the latest split, and the actions that move
 * its traffic.
 */
export const EndpointEnvironmentDetailPanel = ({
  env,
  onClose,
}: EndpointEnvironmentDetailPanelProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();

  if (!env) {
    return (
      <Box className={classes.panel}>
        <Box className={classes.emptyState}>
          <AllInboxOutlinedIcon className={classes.emptyIcon} />
          <Typography variant="body2">
            Select an environment to view its traffic, or click{' '}
            <strong>Traffic</strong> to change the split.
          </Typography>
        </Box>
      </Box>
    );
  }

  return <EndpointEnvironmentDetailContent env={env} onClose={onClose} />;
};

interface ContentProps {
  env: EndpointEnvironment;
  onClose: () => void;
}

function EndpointEnvironmentDetailContent({ env, onClose }: ContentProps) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const notification = useNotification();
  const {
    endpoint,
    releases,
    pendingAction,
    refetch,
    onRollOut,
    onStopRoutingRequest,
    onChangeTraffic,
    onViewReleases,
  } = useEndpointEnvironmentsContext();

  const hasBinding = Boolean(env.bindingName);
  const rolloutPerm = useEndpointRolloutPermission(env.name, hasBinding);
  const trafficPerm = useEndpointTrafficPermission();

  const latest = env.latestRelease ?? endpoint.latestRelease;
  const latestBackends = releaseBackends(releases, latest) ?? endpoint.backends;
  const liveRelease = env.servingRelease ?? env.endpointRelease;
  const liveBackends = releaseBackends(releases, liveRelease);
  const missing = missingBackends(env, latestBackends);
  const isLatest = Boolean(latest) && env.endpointRelease === latest;
  const busy = pendingAction?.env === env.name;
  const message = statusMessage(env);

  const copyToClipboard = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notification.showSuccess(`Copied ${label}`);
      } catch {
        notification.showError('Failed to copy to clipboard');
      }
    },
    [notification],
  );

  let rollOutTooltip = '';
  if (!rolloutPerm.loading && !rolloutPerm.canRollOut) {
    rollOutTooltip = rolloutPerm.rollOutDeniedTooltip;
  } else if (missing.length > 0) {
    rollOutTooltip = `${missing.join(', ')} ${
      missing.length === 1 ? 'is' : 'are'
    } not deployed in ${env.displayName}. Deploy ${
      missing.length === 1 ? 'it' : 'them'
    } first, or set ${missing.length === 1 ? 'its' : 'their'} weight to 0.`;
  }
  const canRollOut =
    Boolean(latest) &&
    !isLatest &&
    !busy &&
    !rolloutPerm.loading &&
    rollOutTooltip === '';

  const rollOutLabel = hasBinding ? 'Roll out latest' : 'Route traffic here';

  return (
    <Box className={classes.panel}>
      <Box className={classes.header}>
        <Box className={classes.headerTopRow}>
          <Box className={classes.headerNameRow}>
            <CloudIcon
              className={classes.headerKindIcon}
              fontSize="small"
              aria-hidden
            />
            <Typography className={classes.envName}>
              {env.displayName}
            </Typography>
          </Box>
          <Box>
            <IconButton
              size="small"
              onClick={() => void refetch()}
              aria-label="Refresh environment status"
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onClose}
              aria-label="Close detail panel"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
        <Box className={classes.headerStatusRow}>
          <StatusBadge
            status={deriveEndpointBadgeStatus(env.status)}
            label={ENDPOINT_BADGE_LABEL[env.status]}
          />
        </Box>
      </Box>

      <Box className={classes.body}>
        {hasBinding && (
          <Box className={classes.section}>
            <InfoRow
              label="Release"
              value={env.endpointRelease || '(unset)'}
              onCopy={
                env.endpointRelease
                  ? () => copyToClipboard(env.endpointRelease!, 'release name')
                  : undefined
              }
            />
            {env.servingRelease &&
              env.servingRelease !== env.endpointRelease && (
                <InfoRow label="Serving" value={env.servingRelease} />
              )}
            {!isLatest && latest && (
              <InfoRow label="Latest" value={`${latest} (not rolled out)`} />
            )}
            {env.invokeURL && (
              <InfoRow
                label="URL"
                value={env.invokeURL}
                onCopy={() => copyToClipboard(env.invokeURL!, 'URL')}
              />
            )}
          </Box>
        )}

        {message && (
          <Box className={classes.section}>
            <Typography
              variant="body2"
              color={env.status === 'Failed' ? 'error' : 'textSecondary'}
            >
              {message}
            </Typography>
          </Box>
        )}

        {liveBackends && (
          <Box className={classes.section}>
            <Typography className={classes.sectionHeading}>
              Serving split
            </Typography>
            <TrafficSplitBar backends={liveBackends} showLegend height={12} />
          </Box>
        )}

        {env.backends.some(b => !b.resolved) && (
          <Box className={classes.section}>
            <Typography className={classes.sectionHeading}>
              Unresolved backends
            </Typography>
            {env.backends
              .filter(b => !b.resolved)
              .map(b => (
                <Typography
                  key={`${b.componentName}/${b.endpoint}`}
                  variant="caption"
                  className={classes.statusMessage}
                >
                  {b.componentName} /{b.endpoint}: {b.reason ?? 'not deployed'}
                </Typography>
              ))}
          </Box>
        )}

        <Box className={classes.section}>
          <Box className={classes.sectionTitleRow}>
            <Typography className={classes.sectionHeading}>Actions</Typography>
            <Box className={classes.actionsRow}>
              <Tooltip
                title={rollOutTooltip}
                disableHoverListener={!rollOutTooltip}
              >
                <span>
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    startIcon={<CallMadeIcon fontSize="small" />}
                    disabled={!canRollOut}
                    onClick={() => latest && void onRollOut(env.name, latest)}
                  >
                    {busy && pendingAction?.kind === 'rollout'
                      ? 'Rolling out...'
                      : rollOutLabel}
                  </Button>
                </span>
              </Tooltip>
              <Tooltip
                title={trafficPerm.deniedTooltip}
                disableHoverListener={!trafficPerm.deniedTooltip}
              >
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={
                      trafficPerm.loading || !trafficPerm.canChangeTraffic
                    }
                    onClick={onChangeTraffic}
                  >
                    Change traffic
                  </Button>
                </span>
              </Tooltip>
              <Button
                variant="outlined"
                size="small"
                startIcon={<HistoryIcon fontSize="small" />}
                onClick={() => onViewReleases(env.name)}
              >
                Releases
              </Button>
            </Box>
          </Box>
        </Box>

        {hasBinding && (
          <Box className={classes.section}>
            <Accordion className={classes.dangerAccordion}>
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                className={classes.dangerAccordionSummary}
                aria-label="Danger zone"
              >
                <ReportProblemOutlinedIcon
                  fontSize="small"
                  className={classes.dangerAccordionIcon}
                />
                <Typography
                  variant="body2"
                  className={classes.dangerAccordionTitle}
                >
                  Danger zone
                </Typography>
              </AccordionSummary>
              <AccordionDetails className={classes.dangerAccordionDetails}>
                <Box className={classes.dangerSubsection}>
                  <Typography
                    variant="caption"
                    className={classes.dangerCaption}
                  >
                    Stop routing this Endpoint in {env.displayName}. The
                    components&apos; own routes take the traffic back first.
                  </Typography>
                  <Tooltip
                    title={rolloutPerm.stopRoutingDeniedTooltip}
                    disableHoverListener={!rolloutPerm.stopRoutingDeniedTooltip}
                  >
                    <span>
                      <Button
                        variant="outlined"
                        size="small"
                        className={classes.dangerButton}
                        disabled={
                          busy ||
                          rolloutPerm.loading ||
                          !rolloutPerm.canStopRouting
                        }
                        onClick={() => onStopRoutingRequest(env.name)}
                      >
                        {busy && pendingAction?.kind === 'stop'
                          ? 'Stopping...'
                          : 'Stop routing'}
                      </Button>
                    </span>
                  </Tooltip>
                </Box>
              </AccordionDetails>
            </Accordion>
          </Box>
        )}
      </Box>
    </Box>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
  onCopy?: () => void;
}

/** A label/value row in the Resource detail panel's release-row style. */
function InfoRow({ label, value, onCopy }: InfoRowProps) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  return (
    <Box className={classes.releaseNameRow}>
      <Typography variant="caption" className={classes.releaseNameLabel}>
        {label}
      </Typography>
      <Tooltip title={value}>
        <Typography variant="caption" className={classes.releaseName}>
          {value}
        </Typography>
      </Tooltip>
      {onCopy && (
        <Tooltip
          title={`Copy ${label.toLowerCase()}`}
          PopperProps={{ disablePortal: true }}
        >
          <IconButton
            size="small"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={onCopy}
          >
            <FileCopyOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
