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
} from '@openchoreo/backstage-plugin-react';
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
}: EndpointReleasesDialogProps) => {
  const classes = useStyles();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (open)
      setSelected(environment?.endpointRelease ?? releases[0]?.name ?? null);
  }, [open, environment, releases]);

  const perm = useEndpointRolloutPermission(
    environment?.name ?? '',
    Boolean(environment?.bindingName),
  );
  const release = releases.find(r => r.name === selected);
  const pinned = environment?.endpointRelease;
  const missing =
    environment && release
      ? missingBackends(environment, release.backends)
      : [];

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
        Releases · {environment?.displayName}
      </DialogTitle>
      <DialogContent dividers className={classes.content}>
        <Box className={classes.listPane}>
          <List dense disablePadding>
            {releases.map(r => (
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
                      {r.name === pinned ? ' · pinned' : ''}
                    </span>
                  }
                  secondary={
                    r.createdAt ? formatRelativeTime(r.createdAt) : undefined
                  }
                />
              </ListItem>
            ))}
          </List>
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
                  deployed in {environment?.displayName}, so this release cannot
                  route there.
                </Typography>
              )}
            </>
          ) : (
            <Typography variant="body2" color="textSecondary">
              Select a release.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isPinning}>
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
                ? 'Pinning...'
                : `Pin to ${environment?.displayName ?? 'environment'}`}
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
};
