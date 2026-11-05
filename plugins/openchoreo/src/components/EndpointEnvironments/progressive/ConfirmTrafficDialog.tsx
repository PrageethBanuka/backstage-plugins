import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import { getErrorMessage } from '../../../utils/errorUtils';

const useStyles = makeStyles(theme => ({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
}));

/** A pending traffic change that needs a confirmation first. */
export interface TrafficConfirmation {
  title: string;
  /** What the change does, in a sentence or two. */
  body: string;
  /** A consequence to know about, shown under the body. */
  note?: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

/** Confirms a rollout change, saying exactly what moves. */
export const ConfirmTrafficDialog = ({
  confirmation,
  onClose,
}: {
  confirmation: TrafficConfirmation | null;
  onClose: () => void;
}) => {
  const classes = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [confirmation]);

  const confirm = async () => {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      await confirmation.run();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={confirmation !== null}
      onClose={() => !busy && onClose()}
      maxWidth="sm"
      fullWidth
      aria-labelledby="confirm-traffic-title"
    >
      <DialogTitle id="confirm-traffic-title">
        {confirmation?.title}
      </DialogTitle>
      <DialogContent dividers className={classes.content}>
        <Box display="flex" flexDirection="column" gridGap={4}>
          <Typography variant="body2">{confirmation?.body}</Typography>
          {confirmation?.note && (
            <Typography variant="caption" color="textSecondary">
              {confirmation.note}
            </Typography>
          )}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={() => void confirm()}
        >
          {confirmation?.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
