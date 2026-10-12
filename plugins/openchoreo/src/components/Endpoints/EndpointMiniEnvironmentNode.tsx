import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import CloudIcon from '@material-ui/icons/Cloud';
import HistoryIcon from '@material-ui/icons/History';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import RefreshIcon from '@material-ui/icons/Refresh';
import NewReleasesOutlinedIcon from '@material-ui/icons/NewReleasesOutlined';
import clsx from 'clsx';
import { StatusBadge } from '@openchoreo/backstage-design-system';
import { useEndpointRolloutPermission } from '@openchoreo/backstage-plugin-react';
import type { EndpointEnvironment } from '@openchoreo/backstage-plugin-common';
import { useResourceMiniEnvironmentNodeStyles } from '../ResourceEnvironments/styles';
import {
  releaseBackends,
  useEndpointEnvironmentsContext,
} from './EndpointEnvironmentsContext';
import { deriveEndpointBadgeStatus, ENDPOINT_BADGE_LABEL } from './badgeStatus';
import { missingBackends } from './endpointUi';
import { TrafficSplitBar } from './TrafficSplitBar';

interface EndpointMiniEnvironmentNodeProps {
  env: EndpointEnvironment;
  selected: boolean;
  onSelect: () => void;
}

/**
 * Environment tile on the Endpoint pipeline canvas. The Resource tile
 * (ResourceMiniEnvironmentNode) with the split the environment is serving in
 * place of the deployed time, and Promote copying this environment's release
 * pin to the next environment.
 */
export const EndpointMiniEnvironmentNode = ({
  env,
  selected,
  onSelect,
}: EndpointMiniEnvironmentNodeProps) => {
  const classes = useResourceMiniEnvironmentNodeStyles();
  const {
    environments,
    releases,
    pendingAction,
    refetch,
    onRollOut,
    onViewReleases,
  } = useEndpointEnvironmentsContext();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [promoteAnchor, setPromoteAnchor] = useState<HTMLElement | null>(null);

  const badgeStatus = deriveEndpointBadgeStatus(env.status);
  const liveRelease = env.servingRelease ?? env.endpointRelease;
  const liveBackends = releaseBackends(releases, liveRelease);
  const hasNewerRelease =
    Boolean(env.endpointRelease) &&
    Boolean(env.latestRelease) &&
    env.endpointRelease !== env.latestRelease;

  // Promote copies this environment's pin forward along the pipeline, like
  // the Resource tile. The terminal environment has no targets, so the
  // button never appears there.
  const promotionTargets = env.promotionTargets ?? [];
  const pinned = env.endpointRelease;
  const eligibleTargets = pinned
    ? promotionTargets.filter(
        t =>
          environments.find(e => e.name === t.name)?.endpointRelease !== pinned,
      )
    : [];
  const showPromote =
    Boolean(pinned) && env.status === 'Routing' && promotionTargets.length > 0;
  const allTargetsInSync =
    promotionTargets.length > 0 && eligibleTargets.length === 0;
  const isPromoting = promotionTargets.some(
    t => pendingAction?.kind === 'rollout' && pendingAction.env === t.name,
  );

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  const stop = (e: ReactMouseEvent) => e.stopPropagation();
  const closeMenu = () => setMenuAnchor(null);
  const closePromoteMenu = () => setPromoteAnchor(null);

  const promoteTo = (target: string) => {
    closePromoteMenu();
    if (pinned) void onRollOut(target, pinned);
  };

  const renderPromoteButton = () => {
    if (allTargetsInSync) {
      return (
        <Button
          size="small"
          variant="contained"
          disabled
          className={classes.primaryButton}
        >
          Promoted
        </Button>
      );
    }
    if (promotionTargets.length === 1) {
      return (
        <PromoteButton
          envName={env.name}
          target={eligibleTargets[0].name}
          releaseName={pinned}
          isPromoting={isPromoting}
          className={classes.primaryButton}
          onClick={e => {
            e.stopPropagation();
            promoteTo(eligibleTargets[0].name);
          }}
        />
      );
    }
    return (
      <Button
        size="small"
        variant="contained"
        color="primary"
        className={classes.primaryButton}
        endIcon={<ArrowDropDownIcon fontSize="small" />}
        onClick={e => {
          e.stopPropagation();
          setPromoteAnchor(e.currentTarget);
        }}
        disabled={isPromoting}
        aria-haspopup="true"
        aria-label={`Promote ${env.name}`}
      >
        {isPromoting ? 'Promoting...' : 'Promote'}
      </Button>
    );
  };

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

          <Box className={classes.metaRow}>
            <span className={classes.meta}>STATUS:</span>
            <StatusBadge
              status={badgeStatus}
              label={ENDPOINT_BADGE_LABEL[env.status]}
            />
            {hasNewerRelease && (
              <Tooltip
                title={`Newer release ${env.latestRelease} is not rolled out here`}
                PopperProps={{ disablePortal: true }}
              >
                <span className={classes.driftBadge} aria-label="newer release">
                  <NewReleasesOutlinedIcon fontSize="inherit" />
                  newer
                </span>
              </Tooltip>
            )}
          </Box>

          {liveBackends && (
            <Box className={classes.metaRow}>
              <span className={classes.meta}>SPLIT:</span>
              <Box flex="1 1 auto" minWidth={0}>
                <TrafficSplitBar backends={liveBackends} height={6} />
              </Box>
            </Box>
          )}

          {showPromote && (
            <Box className={classes.actionRow}>{renderPromoteButton()}</Box>
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
        <MenuItem
          onClick={() => {
            closeMenu();
            void refetch();
          }}
        >
          <RefreshIcon fontSize="small" style={{ marginRight: 8 }} />
          Refresh
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onViewReleases(env.name);
          }}
        >
          <HistoryIcon fontSize="small" style={{ marginRight: 8 }} />
          Releases
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={promoteAnchor}
        keepMounted
        open={Boolean(promoteAnchor)}
        onClose={closePromoteMenu}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={stop}
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
};

/**
 * Rolling out to a target needs the binding permission there, and every
 * backend the release weights above 0 deployed there (the same pre-check
 * as the traffic editor). Returns the tooltip explaining a block, if any.
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
    } not deployed in ${target}`;
  return { blocked: perm.loading || tooltip !== '', tooltip };
}

interface PromoteButtonProps {
  envName: string;
  target: string;
  releaseName?: string;
  isPromoting: boolean;
  className?: string;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

function PromoteButton({
  envName,
  target,
  releaseName,
  isPromoting,
  className,
  onClick,
}: PromoteButtonProps) {
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
          className={className}
          onClick={onClick}
          disabled={isPromoting || blocked}
          aria-label={`Promote ${envName} to ${target}`}
        >
          {isPromoting ? 'Promoting...' : 'Promote'}
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
