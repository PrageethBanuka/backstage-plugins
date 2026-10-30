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
import TuneIcon from '@material-ui/icons/Tune';
import { StatusBadge } from '@openchoreo/backstage-design-system';
import {
  formatRelativeTime,
  useEndpointRolloutPermission,
} from '@openchoreo/backstage-plugin-react';
import SettingsOutlinedIcon from '@material-ui/icons/SettingsOutlined';
import DescriptionOutlinedIcon from '@material-ui/icons/DescriptionOutlined';
import type { EndpointEnvironment } from '@openchoreo/backstage-plugin-common';
import { useResourceEnvironmentDetailPanelStyles } from '../ResourceEnvironments/styles';
import {
  releaseBackends,
  useEndpointEnvironmentsContext,
} from './EndpointEnvironmentsContext';
import { deriveEndpointBadgeStatus, ENDPOINT_BADGE_LABEL } from './badgeStatus';
import { missingBackends, statusMessage } from './endpointUi';
import { inRollout, rolloutPromotion, servedSplit } from './endpointRolloutUi';
import { RolloutLine } from './RolloutLine';
import { TrafficSplitBar } from './TrafficSplitBar';

interface EndpointEnvironmentDetailPanelProps {
  env: EndpointEnvironment | null;
  onClose: () => void;
}

/**
 * Right pane for a selected environment, laid out like the Component and
 * Project panels: the release the environment runs, its traffic, and
 * Actions with Promote and Configure overrides. A running rollout takes
 * one line under the traffic bar; its steps open in the Manage rollout
 * dialog.
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
            Select an environment to view details, or click{' '}
            <strong>Set up</strong> to change the Endpoint.
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
  const { refetch } = useEndpointEnvironmentsContext();

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
        <ReleaseSection env={env} />
        <EnvironmentSections env={env} />
      </Box>
    </Box>
  );
}

/**
 * The release the environment runs, when it was deployed, its URL and its
 * rendered resources, in the order the Component and Resource panels use.
 */
function ReleaseSection({ env }: { env: EndpointEnvironment }) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const { endpoint, onViewArtifacts, onCopy } =
    useEndpointEnvironmentsContext();
  if (!env.bindingName) return null;
  const latest = env.latestRelease ?? endpoint.latestRelease;
  const isLatest = Boolean(latest) && env.endpointRelease === latest;
  return (
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
      {env.deployedAt && (
        <InfoRow label="Deployed" value={formatRelativeTime(env.deployedAt)} />
      )}
      {env.invokeURL && (
        <InfoRow
          label="URL"
          value={env.invokeURL}
          onCopy={() => onCopy(env.invokeURL!, 'URL')}
        />
      )}
      <Box mt={1}>
        <Button
          variant="outlined"
          size="small"
          color="primary"
          startIcon={<DescriptionOutlinedIcon fontSize="small" />}
          onClick={() => onViewArtifacts(env.name)}
        >
          View K8s Artifacts
        </Button>
      </Box>
    </Box>
  );
}

/**
 * Promote, as on the Component and Project panels: this environment's
 * release goes to the next one. While a rollout runs here and not there,
 * it brings the rollout with the new version at 0%.
 */
function usePromote(env: EndpointEnvironment) {
  const { endpoint, environments, pendingAction, onRollOut, onRolloutAction } =
    useEndpointEnvironmentsContext();
  const promotion = rolloutPromotion(env, endpoint, environments);
  const target =
    promotion?.to ??
    environments.find(e => e.name === env.promotionTargets?.[0]?.name);
  if (!target || !env.endpointRelease || env.status !== 'Routing') {
    return undefined;
  }
  const busy = pendingAction !== null;
  if (promotion) {
    return {
      target,
      done: false,
      busy,
      withRollout: true,
      run: () => onRolloutAction(target.name, promotion.action),
    };
  }
  const rollout = endpoint.rollout;
  return {
    target,
    done:
      target.endpointRelease === env.endpointRelease ||
      Boolean(rollout && inRollout(env, rollout) && inRollout(target, rollout)),
    busy,
    withRollout: false,
    run: () => void onRollOut(target.name, env.endpointRelease!),
  };
}

/** Traffic, actions, version history and the danger zone. */
function EnvironmentSections({ env }: { env: EndpointEnvironment }) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const {
    endpoint,
    releases,
    pendingAction,
    onRollOut,
    onStopRoutingRequest,
    onViewReleases,
    onConfigureEnvironment,
    onConfigureOverrides,
  } = useEndpointEnvironmentsContext();
  const hasBinding = Boolean(env.bindingName);
  const rolloutPerm = useEndpointRolloutPermission(env.name, hasBinding);
  const promote = usePromote(env);

  const latest = env.latestRelease ?? endpoint.latestRelease;
  const latestBackends = releaseBackends(releases, latest) ?? endpoint.backends;
  const missing = missingBackends(env, latestBackends);
  const isLatest = Boolean(latest) && env.endpointRelease === latest;
  const busy = pendingAction?.env === env.name;
  const denied = !rolloutPerm.loading && !rolloutPerm.canRollOut;
  const message = statusMessage(env);
  const split = servedSplit(env, endpoint);
  const rollout = endpoint.rollout;
  const configs = Object.entries(env.environmentConfigs ?? {});

  let deployTooltip = '';
  if (denied) {
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

  return (
    <>
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

      {hasBinding && (rollout || split.length > 1) && (
        <Box className={classes.section}>
          <Typography className={classes.sectionHeading}>Traffic</Typography>
          <TrafficSplitBar backends={split} showLegend height={12} />
          <RolloutLine env={env} />
        </Box>
      )}

      {!hasBinding && rollout && (
        <Box className={classes.section}>
          <RolloutLine env={env} />
        </Box>
      )}

      <UnresolvedBackends env={env} />

      <Box className={classes.section}>
        <Box className={classes.sectionTitleRow}>
          <Typography className={classes.sectionHeading}>Actions</Typography>
          <Box className={classes.actionsRow}>
            {promote &&
              (promote.done ? (
                <Button size="small" variant="contained" disabled>
                  Promoted
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  disabled={promote.busy}
                  onClick={promote.run}
                >
                  Promote
                </Button>
              ))}
            {hasBinding && (
              <Tooltip
                title={denied ? rolloutPerm.rollOutDeniedTooltip : ''}
                disableHoverListener={!denied}
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    startIcon={<SettingsOutlinedIcon fontSize="small" />}
                    disabled={busy || denied}
                    onClick={() => onConfigureEnvironment(env.name)}
                    style={{ textTransform: 'none' }}
                  >
                    Configure overrides
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
        </Box>
        {((latest && !isLatest) ||
          (hasBinding && endpoint.backends.length > 1)) && (
          <Box className={classes.actionsRow}>
            {latest && !isLatest && (
              <Tooltip
                title={deployTooltip}
                disableHoverListener={!deployTooltip}
              >
                <span>
                  <Button
                    variant="outlined"
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
            {hasBinding && endpoint.backends.length > 1 && (
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
          </Box>
        )}
        {promote && !promote.done && (
          <Typography variant="caption" color="textSecondary">
            Promote sends {env.endpointRelease} to {promote.target.displayName}
            {promote.withRollout && rollout
              ? `, with ${rollout.candidate} at 0%`
              : ''}
            .
          </Typography>
        )}
        {configs.length > 0 && (
          <Typography variant="caption" color="textSecondary">
            Overrides:{' '}
            {configs
              .map(
                ([k, v]) =>
                  `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`,
              )
              .join(', ')}
          </Typography>
        )}
      </Box>

      <Box className={classes.section}>
        <Typography className={classes.sectionHeading}>More</Typography>
        <Box className={classes.actionsRow}>
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
