import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  TextField,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { useApi } from '@backstage/core-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import {
  shareProblem,
  withShare,
  type EndpointBackendWeight,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../../api/OpenChoreoClientApi';
import { getErrorMessage } from '../../../utils/errorUtils';
import { backendLabel, sharePercents } from './endpointUi';
import { TrafficSplitBar } from './TrafficSplitBar';

interface EditShareDialogProps {
  /** The backend whose share is edited; the dialog is closed without one. */
  backend: EndpointBackendWeight | null;
  /** All of the Endpoint's backends, for the split the share leaves. */
  backends: EndpointBackendWeight[];
  entity: Entity;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/**
 * Sets a backend's percentage of the shared requests. The other backends
 * keep their ratio, and the split it leaves shows before saving.
 */
export const EditShareDialog = ({
  backend,
  backends,
  entity,
  onClose,
  onSaved,
}: EditShareDialogProps) => {
  const client = useApi(openChoreoClientApiRef);
  const [percent, setPercent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = backend
    ? sharePercents(backends.map(b => b.weight))[backends.indexOf(backend)] ?? 0
    : 0;

  useEffect(() => {
    if (backend) {
      setPercent(current);
      setError(null);
    }
  }, [backend, current]);

  const problem = backend ? shareProblem(backends, backend, percent) : '';

  const save = async () => {
    if (!backend) return;
    setSaving(true);
    setError(null);
    try {
      const name = backend.name ?? backend.componentName;
      await client.setBackendShare(entity, name, percent);
      onSaved(`${backendLabel(backend)} gets ${percent}% of requests.`);
      onClose();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!backend}
      onClose={saving ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="edit-share-dialog-title"
    >
      <DialogTitle id="edit-share-dialog-title">Edit share</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {backend && backendLabel(backend)}’s share of the requests no match
          takes. The other backends keep their ratio.
        </DialogContentText>
        <TextField
          id="endpoint-backend-share"
          type="number"
          variant="outlined"
          size="small"
          label="Share"
          value={Number.isNaN(percent) ? '' : percent}
          onChange={e => setPercent(parseInt(e.target.value, 10))}
          inputProps={{ min: 0, max: 100, step: 1 }}
          InputProps={{
            endAdornment: <InputAdornment position="end">%</InputAdornment>,
          }}
          error={Boolean(problem)}
          helperText={problem || undefined}
          disabled={saving}
        />
        {backend && !problem && (
          <Box mt={2}>
            <TrafficSplitBar
              backends={withShare(backends, backend, percent)}
              showLegend
            />
          </Box>
        )}
        {error && (
          <Box mt={2}>
            <Alert severity="error">{error}</Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          color="primary"
          variant="contained"
          disabled={saving || Boolean(problem) || percent === current}
          onClick={save}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
