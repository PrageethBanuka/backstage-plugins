import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import {
  formatRelativeTime,
  useEndpointRolloutPermission,
  useEndpointTrafficPermission,
} from '@openchoreo/backstage-plugin-react';
import { Alert } from '@material-ui/lab';
import { getErrorMessage } from '../../utils/errorUtils';
import type {
  EndpointEnvironment,
  EndpointReleaseSummary,
} from '@openchoreo/backstage-plugin-common';
import { missingBackends } from './endpointUi';
import { TrafficSplitBar } from './TrafficSplitBar';

// Same two-pane layout as ReleaseBrowserDialog.
const useStyles = makeStyles(theme => ({
  content: {
    display: 'flex',
    padding: 0,
    minHeight: 320,
  },
  listPane: {
    width: '45%',
    minWidth: 240,
    borderRight: `1px solid ${theme.palette.divider}`,
    overflow: 'auto',
  },
  detailPane: {
    flexGrow: 1,
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
  releaseName: {
    fontFamily: 'monospace',
    fontSize: 13,
  },
}));

export interface EndpointReleasesDialogProps {
  open: boolean;
  /** Environment to pin, or null when the dialog is closed. */
  environment: EndpointEnvironment | null;
  releases: EndpointReleaseSummary[];
  backendIndex: (componentName: string, endpoint: string) => number;
  isPinning: boolean;
  onClose: () => void;
  onPin: (releaseName: string) => void;
  /**
   * Environments (display names) each release is pinned in, across all
   * environments. A pinned release can't be deleted.
   */
  pinnedReleases?: Map<string, string[]>;
  /** Deletes an old release from the Endpoint's history. */
  onDelete?: (releaseName: string) => Promise<void>;
}

/**
 * Release history for one environment. Pinning an older release is a
 * rollback: instant, and it creates no new release.
 */
export const EndpointReleasesDialog = ({
  open,
  environment,
  releases,
  backendIndex,
  isPinning,
  onClose,
  onPin,
  pinnedReleases,
  onDelete,
}: EndpointReleasesDialogProps) => {
  const classes = useStyles();
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const trafficPerm = useEndpointTrafficPermission();

  useEffect(() => {
    if (open) {
      setSelected(prev =>
        prev && releases.some(r => r.name === prev)
          ? prev
          : environment?.endpointRelease ?? releases[0]?.name ?? null,
      );
      setDeleteError(null);
    }
  }, [open, environment, releases]);

  const perm = useEndpointRolloutPermission(
    environment?.name ?? '',
    Boolean(environment?.bindingName),
  );
  const release = releases.find(r => r.name === selected);
  const pinned = environment?.endpointRelease;
  const latest = environment?.latestRelease;
  // The latest release (the Endpoint's current split) leads the list, so
  // "latest" is never a surprise; the rest stay newest first.
  const ordered = [...releases].sort(
    (a, b) => Number(b.name === latest) - Number(a.name === latest),
  );
  const missing =
    environment && release
      ? missingBackends(environment, release.backends)
      : [];
  const pinnedIn = release ? pinnedReleases?.get(release.name) ?? [] : [];
  let deleteBlockedReason = '';
  if (release?.name === latest) {
    deleteBlockedReason =
      "This is the Endpoint's latest release (its current split).";
  } else if (pinnedIn.length > 0) {
    deleteBlockedReason = `Running in ${pinnedIn.join(
      ', ',
    )}; roll those environments to another release first.`;
  } else if (!trafficPerm.loading && !trafficPerm.canChangeTraffic) {
    deleteBlockedReason = trafficPerm.deniedTooltip;
  }

  const handleDelete = async () => {
    if (!release || !onDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(release.name);
      setSelected(null);
    } catch (err: unknown) {
      setDeleteError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!isPinning) onClose();
      }}
      maxWidth="md"
      fullWidth
      aria-labelledby="endpoint-releases-dialog-title"
    >
      <DialogTitle id="endpoint-releases-dialog-title">
        Version history · {environment?.displayName}
      </DialogTitle>
      <DialogContent dividers className={classes.content}>
        <Box className={classes.listPane}>
          <List dense disablePadding>
            {ordered.map(r => (
              <ListItem
                key={r.name}
                button
                selected={r.name === selected}
                onClick={() => setSelected(r.name)}
              >
                <ListItemText
                  primary={
                    <span className={classes.releaseName}>
                      {r.name}
                      {r.name === latest ? ' · latest' : ''}
                      {r.name === pinned ? ' · running here' : ''}
                    </span>
                  }
                  secondary={
                    r.createdAt ? formatRelativeTime(r.createdAt) : undefined
                  }
                />
              </ListItem>
            ))}
          </List>
          <Typography
            variant="caption"
            color="textSecondary"
            component="p"
            style={{ padding: '8px 16px' }}
          >
            Each saved change to the Endpoint's routing is a version here. A
            version is named by its contents, so saving the same routing again
            reuses it.
          </Typography>
        </Box>
        <Box className={classes.detailPane}>
          {release ? (
            <>
              <Typography variant="subtitle2">Split</Typography>
              <TrafficSplitBar
                backends={release.backends}
                colorIndex={b => backendIndex(b.componentName, b.endpoint)}
                showLegend
                height={12}
              />
              {missing.length > 0 && (
                <Typography variant="body2" color="error">
                  {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} not
                  deployed in {environment?.displayName}, so this version can't
                  run there.
                </Typography>
              )}
            </>
          ) : (
            <Typography variant="body2" color="textSecondary">
              Select a version.
            </Typography>
          )}
          {deleteError && <Alert severity="error">{deleteError}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        {onDelete && release && (
          <Tooltip
            title={deleteBlockedReason}
            disableHoverListener={!deleteBlockedReason}
          >
            <span style={{ marginRight: 'auto' }}>
              <Button
                color="secondary"
                disabled={
                  deleting ||
                  isPinning ||
                  trafficPerm.loading ||
                  deleteBlockedReason !== ''
                }
                onClick={handleDelete}
              >
                {deleting ? 'Deleting...' : 'Delete version'}
              </Button>
            </span>
          </Tooltip>
        )}
        <Button onClick={onClose} disabled={isPinning || deleting}>
          Close
        </Button>
        <Tooltip
          title={perm.rollOutDeniedTooltip}
          disableHoverListener={!perm.rollOutDeniedTooltip}
        >
          <span>
            <Button
              color="primary"
              variant="contained"
              disabled={
                !release ||
                release.name === pinned ||
                missing.length > 0 ||
                isPinning ||
                perm.loading ||
                !perm.canRollOut
              }
              onClick={() => release && onPin(release.name)}
            >
              {isPinning
                ? 'Going back...'
                : `Go back to this in ${
                    environment?.displayName ?? 'environment'
                  }`}
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
};
