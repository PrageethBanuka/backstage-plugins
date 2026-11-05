import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import { getErrorMessage } from '../../../utils/errorUtils';

type Header = { name: string; value: string };

const useStyles = makeStyles(theme => ({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: theme.spacing(2),
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
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
  /**
   * When set, offers a testers' header prefilled with this one, on by
   * default; run gets it only while it is on.
   */
  header?: Header;
  run: (header?: Header) => Promise<void>;
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
  const [header, setHeader] = useState<Header>({ name: '', value: '' });
  const [useHeader, setUseHeader] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHeader(confirmation?.header ?? { name: '', value: '' });
    setUseHeader(true);
    setError(null);
  }, [confirmation]);

  const confirm = async () => {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      await confirmation.run(
        confirmation.header && useHeader ? header : undefined,
      );
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const asksHeader = Boolean(confirmation?.header);
  const missingHeader =
    asksHeader && useHeader && (!header.name.trim() || !header.value.trim());
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
        {asksHeader && (
          <Box display="flex" flexDirection="column" gridGap={8}>
            <FormControlLabel
              control={
                <Checkbox
                  color="primary"
                  checked={useHeader}
                  onChange={e => setUseHeader(e.target.checked)}
                />
              }
              label="Requests with a header reach the new version before any step"
            />
            {useHeader && (
              <Box className={classes.pair}>
                <TextField
                  id="confirm-traffic-header-name"
                  size="small"
                  variant="outlined"
                  label="Header"
                  value={header.name}
                  error={!header.name.trim()}
                  onChange={e =>
                    setHeader(h => ({ ...h, name: e.target.value }))
                  }
                />
                <TextField
                  id="confirm-traffic-header-value"
                  size="small"
                  variant="outlined"
                  label="Value"
                  value={header.value}
                  error={!header.value.trim()}
                  onChange={e =>
                    setHeader(h => ({ ...h, value: e.target.value }))
                  }
                />
              </Box>
            )}
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={busy || missingHeader}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={() => void confirm()}
        >
          {confirmation?.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
