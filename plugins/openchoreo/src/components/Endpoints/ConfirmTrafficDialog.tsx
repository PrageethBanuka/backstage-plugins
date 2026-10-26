import { useEffect, useState } from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { getErrorMessage } from '../../utils/errorUtils';

/** A pending traffic change that needs a confirmation first. */
export interface TrafficConfirmation {
  title: string;
  body: string;
  confirmLabel: string;
  /** When set, the user types this to confirm (production completion). */
  typeToConfirm?: string;
  run: () => Promise<void>;
}

/**
 * Confirms a traffic change in production, saying exactly what moves. The
 * button names the action; typing the name is kept for completing a rollout
 * in production, where the old version is removed.
 */
export const ConfirmTrafficDialog = ({
  confirmation,
  onClose,
}: {
  confirmation: TrafficConfirmation | null;
  onClose: () => void;
}) => {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTyped('');
    setError(null);
  }, [confirmation]);

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

  const needsTyping = Boolean(confirmation?.typeToConfirm);
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
      <DialogContent dividers>
        <Typography variant="body2" paragraph>
          {confirmation?.body}
        </Typography>
        {needsTyping && (
          <TextField
            fullWidth
            size="small"
            variant="outlined"
            label={`Type ${confirmation?.typeToConfirm} to confirm`}
            value={typed}
            onChange={e => setTyped(e.target.value)}
          />
        )}
        {error && (
          <Alert severity="error" style={{ marginTop: 16 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={
            busy || (needsTyping && typed !== confirmation?.typeToConfirm)
          }
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={() => void confirm()}
        >
          {confirmation?.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
