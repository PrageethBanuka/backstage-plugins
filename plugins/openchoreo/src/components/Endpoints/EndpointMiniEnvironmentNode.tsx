import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import CloudIcon from '@material-ui/icons/Cloud';
import HistoryIcon from '@material-ui/icons/History';
import OpenInNewIcon from '@material-ui/icons/OpenInNew';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import RefreshIcon from '@material-ui/icons/Refresh';
import UndoIcon from '@material-ui/icons/Undo';
import TuneIcon from '@material-ui/icons/Tune';
import NewReleasesOutlinedIcon from '@material-ui/icons/NewReleasesOutlined';
import clsx from 'clsx';
import { StatusBadge } from '@openchoreo/backstage-design-system';
import { useEndpointRolloutPermission } from '@openchoreo/backstage-plugin-react';
import {
  stableLabel,
  untouchedSplit,
  type EndpointEnvironment,
} from '@openchoreo/backstage-plugin-common';
import { useResourceMiniEnvironmentNodeStyles } from '../ResourceEnvironments/styles';
import {
  releaseBackends,
  useEndpointEnvironmentsContext,
} from './EndpointEnvironmentsContext';
import { deriveEndpointBadgeStatus, ENDPOINT_BADGE_LABEL } from './badgeStatus';
import { missingBackends } from './endpointUi';
import {
  inRollout,
  rolloutAction,
  servedSplit,
  stageText,
} from './endpointRolloutUi';
import { TrafficSplitBar } from './TrafficSplitBar';

interface EndpointMiniEnvironmentNodeProps {
  env: EndpointEnvironment;
  selected: boolean;
  onSelect: () => void;
}

const ICON_STYLE = { marginRight: 8 };

/**
 * Environment tile on the Endpoint pipeline canvas, built on the Resource
 * tile (ResourceMiniEnvironmentNode) and its styles.
 *
 * On the Deploy tab it is the Resource tile: status, a "newer" badge and
 * Promote, plus a chip linking to the Rollout tab while a rollout runs
 * here. On the Rollout tab it shows the split the environment serves, its
 * stage, and the next step in the slot where Promote sits.
 */
export const EndpointMiniEnvironmentNode = ({
  env,
  selected,
  onSelect,
}: EndpointMiniEnvironmentNodeProps) => {
  const classes = useResourceMiniEnvironmentNodeStyles();
  const {
    mode,
    endpoint,
    pendingAction,
    refetch,
    onViewReleases,
    onViewArtifacts,
    onConfigureOverrides,
    onRollBack,
    onOpenRollout,
  } = useEndpointEnvironmentsContext();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const badgeStatus = deriveEndpointBadgeStatus(env.status);
  const rollout = endpoint.rollout;
  const running = Boolean(rollout && inRollout(env, rollout));
  const hasNewerRelease =
    Boolean(env.endpointRelease) &&
    Boolean(env.latestRelease) &&
    env.endpointRelease !== env.latestRelease;
  const split = servedSplit(env, endpoint);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };
  const stop = (e: ReactMouseEvent) => e.stopPropagation();
  const closeMenu = () => setMenuAnchor(null);
  const menuItem = (
    label: string,
    icon: JSX.Element,
    run: () => void,
    disabledReason = '',
  ) => (
    <Tooltip
      key={label}
      title={disabledReason}
      disableHoverListener={!disabledReason}
      placement="left"
      PopperProps={{ disablePortal: true }}
    >
      <span>
        <MenuItem
          disabled={Boolean(disabledReason)}
          onClick={() => {
            closeMenu();
            run();
          }}
        >
          {icon}
          {label}
        </MenuItem>
      </span>
    </Tooltip>
  );

  let rollBackBlock = '';
  if (rollout && (env.rollout?.percent ?? 0) === 0) {
    rollBackBlock = `${stableLabel(rollout)} already gets all ${
      untouchedSplit(rollout).length > 0 ? 'of its traffic' : 'traffic'
    } here`;
  } else if (pendingAction?.env === env.name) {
    rollBackBlock = 'Wait for the current change to finish';
  }

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Select environment ${env.displayName}`}
      className={clsx(classes.card, selected && classes.cardSelected)}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <Box display="flex" height="100%" minWidth={0}>
        <Box
          aria-hidden
          className={clsx(classes.statusStripe, {
            [classes.statusStripeActive]: badgeStatus === 'active',
            [classes.statusStripePending]:
              badgeStatus === 'pending' || badgeStatus === 'warning',
            [classes.statusStripeFailed]: badgeStatus === 'failed',
            [classes.statusStripeIdle]: badgeStatus === 'not-deployed',
          })}
        />
        <Box className={classes.body}>
          <Box className={classes.topRow}>
            <Box className={classes.nameWrap}>
              <CloudIcon
                aria-hidden
                className={classes.kindIcon}
                fontSize="small"
              />
              <Tooltip
                title={env.displayName}
                disableHoverListener={env.displayName.length < 20}
                PopperProps={{ disablePortal: true }}
              >
                <Typography className={classes.envName}>
                  {env.displayName}
                </Typography>
              </Tooltip>
            </Box>
            <Tooltip title="More actions" PopperProps={{ disablePortal: true }}>
              <IconButton
                size="small"
                className={classes.menuButton}
                onClick={e => {
                  e.stopPropagation();
                  setMenuAnchor(e.currentTarget);
                }}
                aria-label={`Actions for ${env.displayName}`}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          {mode === 'rollout' && env.bindingName ? (
            <Box className={classes.metaRow}>
              <Box flex="1 1 auto" minWidth={0}>
                <TrafficSplitBar backends={split} height={6} />
              </Box>
            </Box>
          ) : (
            <Box className={classes.metaRow}>
              <span className={classes.meta}>STATUS:</span>
              <StatusBadge
                status={badgeStatus}
                label={ENDPOINT_BADGE_LABEL[env.status]}
              />
              {mode === 'deploy' && hasNewerRelease && (
                <Tooltip
                  title="A newer version of the routing is not deployed here"
                  PopperProps={{ disablePortal: true }}
                >
                  <span
                    className={classes.driftBadge}
                    aria-label="newer version"
                  >
                    <NewReleasesOutlinedIcon fontSize="inherit" />
                    newer
                  </span>
                </Tooltip>
              )}
            </Box>
          )}

          {mode === 'deploy' && running && rollout && (
            <Box className={classes.metaRow}>
              <span className={classes.meta}>ROLLOUT:</span>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                clickable
                label={stageText(env, rollout)}
                onClick={e => {
                  e.stopPropagation();
                  onOpenRollout();
                }}
                aria-label={`Open the rollout, ${stageText(env, rollout)}`}
              />
            </Box>
          )}
          {mode === 'deploy' && !running && split.length > 1 && (
            <Box className={classes.metaRow}>
              <span className={classes.meta}>SPLIT:</span>
              <Box flex="1 1 auto" minWidth={0}>
                <TrafficSplitBar backends={split} height={6} />
              </Box>
            </Box>
          )}
          {mode === 'rollout' && rollout && env.bindingName && (
            <Box className={classes.metaRow}>
              <span className={classes.meta}>STAGE:</span>
              <Chip
                size="small"
                color={running ? 'primary' : 'default'}
                variant={env.rollout?.manual ? 'outlined' : 'default'}
                label={stageText(env, rollout)}
              />
            </Box>
          )}

          {mode === 'deploy' ? (
            <DeployPrimary env={env} />
          ) : (
            <RolloutPrimary env={env} />
          )}
        </Box>
      </Box>

      <Menu
        anchorEl={menuAnchor}
        keepMounted
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        onClick={stop}
      >
        {menuItem(
          'Refresh',
          <RefreshIcon fontSize="small" style={ICON_STYLE} />,
          () => void refetch(),
        )}
        {mode === 'rollout' &&
          rollout &&
          running &&
          menuItem(
            `Roll back to ${stableLabel(rollout)}`,
            <UndoIcon fontSize="small" style={ICON_STYLE} />,
            () => onRollBack(env.name),
            rollBackBlock,
          )}
        {mode === 'rollout' &&
          env.bindingName &&
          menuItem(
            'Set traffic by hand',
            <TuneIcon fontSize="small" style={ICON_STYLE} />,
            () => onConfigureOverrides(env.name),
            endpoint.backends.length < 2
              ? 'The Endpoint has one version, so there is nothing to split'
              : '',
          )}
        <Divider />
        {menuItem(
          'Version history',
          <HistoryIcon fontSize="small" style={ICON_STYLE} />,
          () => onViewReleases(env.name),
        )}
        {menuItem(
          'View K8s artifacts',
          <OpenInNewIcon fontSize="small" style={ICON_STYLE} />,
          () => onViewArtifacts(env.name),
          env.bindingName ? '' : 'Not routed in this environment yet.',
        )}
      </Menu>
    </Box>
  );
};

/**
 * The Resource tile's Promote: copies this environment's version of the
 * routing to the next environment. The terminal environment has no
 * targets, so the button never appears there.
 */
function DeployPrimary({ env }: { env: EndpointEnvironment }) {
  const classes = useResourceMiniEnvironmentNodeStyles();
  const { environments, pendingAction, onRollOut } =
    useEndpointEnvironmentsContext();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const promotionTargets = env.promotionTargets ?? [];
  const pinned = env.endpointRelease;
  if (!pinned || env.status !== 'Routing' || promotionTargets.length === 0) {
    return null;
  }
  const eligibleTargets = promotionTargets.filter(
    t => environments.find(e => e.name === t.name)?.endpointRelease !== pinned,
  );
  const isPromoting = promotionTargets.some(
    t => pendingAction?.kind === 'rollout' && pendingAction.env === t.name,
  );
  const promoteTo = (target: string) => {
    setAnchor(null);
    void onRollOut(target, pinned);
  };

  if (eligibleTargets.length === 0) {
    return (
      <Box className={classes.actionRow}>
        <Button
          size="small"
          variant="contained"
          disabled
          className={classes.primaryButton}
        >
          Promoted
        </Button>
      </Box>
    );
  }
  if (promotionTargets.length === 1) {
    return (
      <Box className={classes.actionRow}>
        <PromoteButton
          envName={env.displayName}
          target={eligibleTargets[0].name}
          releaseName={pinned}
          label={isPromoting ? 'Promoting...' : 'Promote'}
          disabled={isPromoting}
          onClick={() => promoteTo(eligibleTargets[0].name)}
        />
      </Box>
    );
  }
  return (
    <Box className={classes.actionRow}>
      <Button
        size="small"
        variant="contained"
        color="primary"
        className={classes.primaryButton}
        endIcon={<ArrowDropDownIcon fontSize="small" />}
        onClick={e => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        disabled={isPromoting}
        aria-haspopup="true"
        aria-label={`Promote ${env.displayName}`}
      >
        {isPromoting ? 'Promoting...' : 'Promote'}
      </Button>
      <Menu
        anchorEl={anchor}
        keepMounted
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={e => e.stopPropagation()}
      >
        {promotionTargets.map(target => (
          <PromoteMenuItemRow
            key={target.name}
            target={target.name}
            releaseName={pinned}
            promoted={!eligibleTargets.some(t => t.name === target.name)}
            inFlight={
              pendingAction?.kind === 'rollout' &&
              pendingAction.env === target.name
            }
            onClick={() => promoteTo(target.name)}
          />
        ))}
      </Menu>
    </Box>
  );
}

/** The Rollout tab's next step, in the slot where Promote sits. */
function RolloutPrimary({ env }: { env: EndpointEnvironment }) {
  const classes = useResourceMiniEnvironmentNodeStyles();
  const { endpoint, environments, pendingAction, onRolloutAction } =
    useEndpointEnvironmentsContext();
  const action = rolloutAction(env, endpoint, environments);
  if (!action) return null;
  const busy = pendingAction !== null;
  const run = () => onRolloutAction(env.name, action);

  return (
    <Box className={classes.actionRow}>
      {action.kind === 'promote' ? (
        <PromoteButton
          envName={action.from}
          target={env.name}
          label={action.label}
          disabled={busy}
          onClick={run}
        />
      ) : (
        <StepButton
          env={env}
          label={action.label}
          disabled={busy}
          onClick={run}
        />
      )}
    </Box>
  );
}

interface StepButtonProps {
  env: EndpointEnvironment;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

/** A rollout step in an environment; needs the binding permission there. */
function StepButton({ env, label, disabled, onClick }: StepButtonProps) {
  const classes = useResourceMiniEnvironmentNodeStyles();
  const perm = useEndpointRolloutPermission(env.name, Boolean(env.bindingName));
  const tooltip =
    !perm.loading && !perm.canRollOut ? perm.rollOutDeniedTooltip : '';
  return (
    <Tooltip
      title={tooltip}
      disableHoverListener={!tooltip}
      PopperProps={{ disablePortal: true }}
    >
      <span>
        <Button
          size="small"
          variant="contained"
          color="primary"
          className={classes.primaryButton}
          disabled={disabled || perm.loading || Boolean(tooltip)}
          onClick={e => {
            e.stopPropagation();
            onClick();
          }}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );
}

/**
 * Rolling out to a target needs the binding permission there, and every
 * backend the release weights above 0 deployed there. Returns the tooltip
 * explaining a block, if any.
 */
function usePromoteBlock(target: string, releaseName: string | undefined) {
  const { environments, releases, endpoint } = useEndpointEnvironmentsContext();
  const targetEnv = environments.find(e => e.name === target);
  const perm = useEndpointRolloutPermission(
    target,
    Boolean(targetEnv?.bindingName),
  );
  const backends = releaseBackends(releases, releaseName) ?? endpoint.backends;
  const missing = targetEnv ? missingBackends(targetEnv, backends) : [];
  let tooltip = '';
  if (!perm.loading && !perm.canRollOut) tooltip = perm.rollOutDeniedTooltip;
  else if (missing.length > 0)
    tooltip = `${missing.join(', ')} ${
      missing.length === 1 ? 'is' : 'are'
    } not deployed in ${targetEnv?.displayName ?? target}`;
  return { blocked: perm.loading || tooltip !== '', tooltip };
}

interface PromoteButtonProps {
  envName: string;
  target: string;
  releaseName?: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

function PromoteButton({
  envName,
  target,
  releaseName,
  label,
  disabled,
  onClick,
}: PromoteButtonProps) {
  const classes = useResourceMiniEnvironmentNodeStyles();
  const { blocked, tooltip } = usePromoteBlock(target, releaseName);
  return (
    <Tooltip
      title={tooltip}
      disableHoverListener={!tooltip}
      PopperProps={{ disablePortal: true }}
    >
      <span>
        <Button
          size="small"
          variant="contained"
          color="primary"
          className={classes.primaryButton}
          onClick={e => {
            e.stopPropagation();
            onClick();
          }}
          disabled={disabled || blocked}
          aria-label={`Promote ${envName} to ${target}`}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );
}

interface PromoteMenuItemRowProps {
  target: string;
  releaseName?: string;
  promoted: boolean;
  inFlight: boolean;
  onClick: () => void;
}

function PromoteMenuItemRow({
  target,
  releaseName,
  promoted,
  inFlight,
  onClick,
}: PromoteMenuItemRowProps) {
  const { blocked, tooltip } = usePromoteBlock(target, releaseName);
  let label = `Promote to ${target}`;
  if (promoted) label = `Promoted to ${target}`;
  else if (inFlight) label = `Promoting to ${target}...`;
  return (
    <Tooltip
      title={tooltip}
      disableHoverListener={!tooltip}
      placement="left"
      PopperProps={{ disablePortal: true }}
    >
      <span>
        <MenuItem disabled={promoted || inFlight || blocked} onClick={onClick}>
          {label}
        </MenuItem>
      </span>
    </Tooltip>
  );
}
