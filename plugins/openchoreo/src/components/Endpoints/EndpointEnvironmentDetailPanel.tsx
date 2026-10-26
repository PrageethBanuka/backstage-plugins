import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
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
import OpenInNewIcon from '@material-ui/icons/OpenInNew';
import RefreshIcon from '@material-ui/icons/Refresh';
import ReportProblemOutlinedIcon from '@material-ui/icons/ReportProblemOutlined';
import SettingsOutlinedIcon from '@material-ui/icons/SettingsOutlined';
import TuneIcon from '@material-ui/icons/Tune';
import UndoIcon from '@material-ui/icons/Undo';
import { StatusBadge } from '@openchoreo/backstage-design-system';
import {
  useEndpointRolloutPermission,
  useEndpointTrafficPermission,
} from '@openchoreo/backstage-plugin-react';
import {
  rolloutStages,
  type EndpointEnvironment,
} from '@openchoreo/backstage-plugin-common';
import { useResourceEnvironmentDetailPanelStyles } from '../ResourceEnvironments/styles';
import {
  releaseBackends,
  useEndpointEnvironmentsContext,
} from './EndpointEnvironmentsContext';
import { deriveEndpointBadgeStatus, ENDPOINT_BADGE_LABEL } from './badgeStatus';
import { missingBackends, statusMessage } from './endpointUi';
import {
  completionEnvironment,
  inRollout,
  previewCommand,
  rolloutAction,
  servedSplit,
  stageText,
} from './endpointRolloutUi';
import { TrafficSplitBar } from './TrafficSplitBar';

interface EndpointEnvironmentDetailPanelProps {
  env: EndpointEnvironment | null;
  onClose: () => void;
}

/**
 * Right pane for a selected environment, built on the Resource detail panel
 * (ResourceEnvironmentDetailPanel) and its styles. The Deploy tab shows the
 * version of the routing the environment runs and the Resource actions; the
 * Rollout tab shows its traffic, how to preview the new version and the
 * rollout steps.
 */
export const EndpointEnvironmentDetailPanel = ({
  env,
  onClose,
}: EndpointEnvironmentDetailPanelProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const { mode } = useEndpointEnvironmentsContext();

  if (!env) {
    return (
      <Box className={classes.panel}>
        <Box className={classes.emptyState}>
          <AllInboxOutlinedIcon className={classes.emptyIcon} />
          <Typography variant="body2">
            {mode === 'deploy' ? (
              <>
                Select an environment to view details, or click{' '}
                <strong>Set up</strong> to change the Endpoint.
              </>
            ) : (
              <>
                Select an environment to view its traffic, or click{' '}
                <strong>Rollout</strong> to see the rollout.
              </>
            )}
          </Typography>
        </Box>
      </Box>
    );
  }

  return <DetailContent env={env} onClose={onClose} />;
};

function DetailContent({
  env,
  onClose,
}: {
  env: EndpointEnvironment;
  onClose: () => void;
}) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const { mode, refetch } = useEndpointEnvironmentsContext();

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
        {mode === 'deploy' ? (
          <DeploySections env={env} />
        ) : (
          <RolloutSections env={env} />
        )}
      </Box>
    </Box>
  );
}

/** Release, traffic, configuration, actions and the danger zone. */
function DeploySections({ env }: { env: EndpointEnvironment }) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const {
    endpoint,
    environments,
    releases,
    pendingAction,
    onRollOut,
    onStopRoutingRequest,
    onViewReleases,
    onViewArtifacts,
    onConfigureOverrides,
    onOpenRollout,
    onCopy,
  } = useEndpointEnvironmentsContext();
  const hasBinding = Boolean(env.bindingName);
  const rolloutPerm = useEndpointRolloutPermission(env.name, hasBinding);
  const trafficPerm = useEndpointTrafficPermission();

  const latest = env.latestRelease ?? endpoint.latestRelease;
  const latestBackends = releaseBackends(releases, latest) ?? endpoint.backends;
  const missing = missingBackends(env, latestBackends);
  const isLatest = Boolean(latest) && env.endpointRelease === latest;
  const busy = pendingAction?.env === env.name;
  const message = statusMessage(env);
  const split = servedSplit(env, endpoint);
  const rollout = endpoint.rollout;
  const running = Boolean(rollout && inRollout(env, rollout));

  let deployTooltip = '';
  if (!rolloutPerm.loading && !rolloutPerm.canRollOut) {
    deployTooltip = rolloutPerm.rollOutDeniedTooltip;
  } else if (missing.length > 0) {
    deployTooltip = `${missing.join(', ')} ${
      missing.length === 1 ? 'is' : 'are'
    } not deployed in ${env.displayName} yet.`;
  }
  const canDeploy =
    Boolean(latest) &&
    !isLatest &&
    !busy &&
    !rolloutPerm.loading &&
    deployTooltip === '';

  const target = env.promotionTargets?.[0];
  const targetEnv = environments.find(e => e.name === target?.name);
  const canPromote =
    Boolean(target) &&
    Boolean(env.endpointRelease) &&
    env.status === 'Routing' &&
    targetEnv?.endpointRelease !== env.endpointRelease;

  let overridesTooltip = trafficPerm.deniedTooltip;
  if (!overridesTooltip && !hasBinding) {
    overridesTooltip = 'Deploy this environment first to configure overrides.';
  } else if (!overridesTooltip && endpoint.backends.length < 2) {
    overridesTooltip =
      'The Endpoint has one version, so there is nothing to override.';
  }

  return (
    <>
      {hasBinding && (
        <Box className={classes.section}>
          <InfoRow
            label="Release"
            value={`${env.endpointRelease || '(unset)'}${
              isLatest ? ' · latest' : ''
            }`}
            onCopy={
              env.endpointRelease
                ? () => onCopy(env.endpointRelease!, 'release name')
                : undefined
            }
          />
          {env.servingRelease && env.servingRelease !== env.endpointRelease && (
            <InfoRow label="Serving" value={env.servingRelease} />
          )}
          {!isLatest && latest && (
            <InfoRow label="Latest" value={`${latest} (not deployed here)`} />
          )}
          {env.invokeURL && (
            <InfoRow
              label="URL"
              value={env.invokeURL}
              onCopy={() => onCopy(env.invokeURL!, 'URL')}
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

      {hasBinding && (running || split.length > 1) && (
        <Box className={classes.section}>
          <Box className={classes.sectionTitleRow}>
            <Typography className={classes.sectionHeading}>Traffic</Typography>
            <Button
              size="small"
              color="primary"
              endIcon={<OpenInNewIcon fontSize="small" />}
              onClick={onOpenRollout}
            >
              Open rollout
            </Button>
          </Box>
          <TrafficSplitBar backends={split} showLegend height={12} />
        </Box>
      )}

      <UnresolvedBackends env={env} />

      <Box className={classes.section}>
        <Box className={classes.sectionTitleRow}>
          <Typography className={classes.sectionHeading}>
            Configuration
          </Typography>
          <Tooltip
            title={
              overridesTooltip ||
              'Set how this environment splits traffic between versions.'
            }
          >
            <span>
              <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={<SettingsOutlinedIcon fontSize="small" />}
                disabled={Boolean(overridesTooltip) || trafficPerm.loading}
                onClick={() => onConfigureOverrides(env.name)}
              >
                Configure overrides
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Box className={classes.section}>
        <Typography className={classes.sectionHeading}>Actions</Typography>
        <Box className={classes.actionsRow}>
          {latest && !isLatest && (
            <Tooltip
              title={deployTooltip}
              disableHoverListener={!deployTooltip}
            >
              <span>
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  disabled={!canDeploy}
                  onClick={() => void onRollOut(env.name, latest)}
                >
                  {busy && pendingAction?.kind === 'rollout'
                    ? 'Deploying...'
                    : 'Deploy latest version'}
                </Button>
              </span>
            </Tooltip>
          )}
          {canPromote && target && env.endpointRelease && (
            <Button
              variant="contained"
              color="primary"
              size="small"
              disabled={pendingAction !== null}
              onClick={() => void onRollOut(target.name, env.endpointRelease!)}
            >
              Promote to {targetEnv?.displayName ?? target.name}
            </Button>
          )}
          <Button
            variant="outlined"
            size="small"
            startIcon={<HistoryIcon fontSize="small" />}
            onClick={() => onViewReleases(env.name)}
          >
            Version history
          </Button>
          {hasBinding && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<OpenInNewIcon fontSize="small" />}
              onClick={() => onViewArtifacts(env.name)}
            >
              View K8s Artifacts
            </Button>
          )}
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
                <Typography variant="caption" className={classes.dangerCaption}>
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
    </>
  );
}

/** Traffic and steps, the preview command, and the rollout actions. */
function RolloutSections({ env }: { env: EndpointEnvironment }) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const {
    endpoint,
    environments,
    pendingAction,
    onRolloutAction,
    onRollBack,
    onConfigureOverrides,
    onViewReleases,
    onCopy,
  } = useEndpointEnvironmentsContext();
  const perm = useEndpointRolloutPermission(env.name, Boolean(env.bindingName));
  const rollout = endpoint.rollout;
  const split = servedSplit(env, endpoint);
  const running = Boolean(rollout && inRollout(env, rollout));
  const action = rolloutAction(env, endpoint, environments);
  const completeFrom = completionEnvironment(environments);
  const busy = pendingAction !== null;
  const denied = !perm.loading && !perm.canRollOut;
  const preview =
    rollout && running ? previewCommand(rollout, env.invokeURL) : undefined;

  return (
    <>
      {env.bindingName ? (
        <Box className={classes.section}>
          <Typography className={classes.sectionHeading}>Traffic</Typography>
          <TrafficSplitBar backends={split} showLegend height={12} />
          {rollout && running && env.rollout && (
            <Box display="flex" flexWrap="wrap" gridGap={4} mt={1}>
              {rolloutStages(rollout)
                .slice(1)
                .map((s, i) => {
                  const index = i + 1;
                  const now =
                    !env.rollout!.manual && env.rollout!.index === index;
                  const done = env.rollout!.percent > s.percent;
                  return (
                    <Chip
                      key={s.id}
                      size="small"
                      label={`${s.percent}%`}
                      color={now || done ? 'primary' : 'default'}
                      variant={now ? 'default' : 'outlined'}
                    />
                  );
                })}
            </Box>
          )}
          {rollout && (
            <Typography variant="caption" color="textSecondary">
              {stageText(env, rollout)}
            </Typography>
          )}
        </Box>
      ) : (
        <Box className={classes.section}>
          <Typography variant="body2" color="textSecondary">
            This Endpoint is not routed in {env.displayName} yet. Deploy it from
            the Deploy tab.
          </Typography>
        </Box>
      )}

      {rollout &&
        running &&
        env.rollout?.percent === 100 &&
        completeFrom &&
        completeFrom.name !== env.name && (
          <Box className={classes.section}>
            <Typography variant="body2" color="textSecondary">
              {env.displayName} sends all traffic to {rollout.candidate}.
              Complete the rollout from {completeFrom.displayName} once every
              environment is at 100%.
            </Typography>
          </Box>
        )}

      {rollout && env.bindingName && !running && (
        <Box className={classes.section}>
          <Typography variant="body2" color="textSecondary">
            The rollout has not reached {env.displayName}.
            {action?.kind === 'promote'
              ? ' Promote it here; the new version starts at 0%, so no traffic moves.'
              : ''}
          </Typography>
        </Box>
      )}

      {preview && (
        <Box className={classes.section}>
          <Box className={classes.sectionTitleRow}>
            <Typography className={classes.sectionHeading}>Preview</Typography>
            <Tooltip title="Copy command">
              <IconButton
                size="small"
                aria-label="Copy preview command"
                onClick={() => onCopy(preview, 'preview command')}
              >
                <FileCopyOutlinedIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          </Box>
          <Typography variant="caption" className={classes.statusMessage}>
            {preview}
          </Typography>
          <Typography variant="caption" color="textSecondary">
            Anyone who sends this reaches {rollout?.candidate}.
          </Typography>
        </Box>
      )}

      <UnresolvedBackends env={env} />

      {rollout && (
        <Box className={classes.section}>
          <Typography className={classes.sectionHeading}>Actions</Typography>
          <Box className={classes.actionsRow}>
            {running && (
              <Tooltip
                title={denied ? perm.rollOutDeniedTooltip : ''}
                disableHoverListener={!denied}
              >
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<UndoIcon fontSize="small" />}
                    disabled={
                      busy || denied || (env.rollout?.percent ?? 0) === 0
                    }
                    onClick={() => onRollBack(env.name)}
                  >
                    Roll back to {rollout.stable}
                  </Button>
                </span>
              </Tooltip>
            )}
            {action && (
              <Tooltip
                title={denied ? perm.rollOutDeniedTooltip : ''}
                disableHoverListener={!denied}
              >
                <span>
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    disabled={busy || denied || perm.loading}
                    onClick={() => onRolloutAction(env.name, action)}
                  >
                    {action.label}
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
        </Box>
      )}

      <Box className={classes.section}>
        <Typography className={classes.sectionHeading}>More</Typography>
        <Box className={classes.actionsRow}>
          {env.bindingName && endpoint.backends.length > 1 && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<TuneIcon fontSize="small" />}
              disabled={busy || denied}
              onClick={() => onConfigureOverrides(env.name)}
            >
              Set traffic by hand
            </Button>
          )}
          <Button
            variant="outlined"
            size="small"
            startIcon={<HistoryIcon fontSize="small" />}
            onClick={() => onViewReleases(env.name)}
          >
            Version history
          </Button>
        </Box>
      </Box>
    </>
  );
}

function UnresolvedBackends({ env }: { env: EndpointEnvironment }) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const unresolved = env.backends.filter(b => !b.resolved);
  if (unresolved.length === 0) return null;
  return (
    <Box className={classes.section}>
      <Typography className={classes.sectionHeading}>
        Unresolved backends
      </Typography>
      {unresolved.map(b => (
        <Typography
          key={`${b.componentName}/${b.endpoint}`}
          variant="caption"
          className={classes.statusMessage}
        >
          {b.componentName} /{b.endpoint}: {b.reason ?? 'not deployed'}
        </Typography>
      ))}
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
