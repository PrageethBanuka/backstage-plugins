import type { FC } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@material-ui/core';

export interface StopRoutingDialogProps {
  open: boolean;
  endpointName: string;
  environmentName: string;
  isStopping: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation for "Stop routing", following ResourceRemoveDeploymentDialog.
 * Deleting the EndpointReleaseBinding is not destructive for traffic: the
 * components' own routes take over before the Endpoint's routes are removed.
 */
export const StopRoutingDialog: FC<StopRoutingDialogProps> = ({
  open,
  endpointName,
  environmentName,
  isStopping,
  onCancel,
  onConfirm,
}) => (
  <Dialog
    open={open}
    onClose={() => {
      if (!isStopping) onCancel();
    }}
    disableEscapeKeyDown={isStopping}
    maxWidth="sm"
    fullWidth
    aria-labelledby="endpoint-stop-routing-dialog-title"
  >
    <DialogTitle id="endpoint-stop-routing-dialog-title">
      Stop routing {endpointName} in {environmentName}?
    </DialogTitle>

    <DialogContent dividers>
      <Typography variant="body2" color="textSecondary" paragraph>
        {endpointName} stops routing traffic in{' '}
        <strong>{environmentName}</strong>. As a result:
      </Typography>
      <ul style={{ marginTop: 0, paddingLeft: 20 }}>
        <li>
          <Typography variant="body2" color="textSecondary">
            The weighted split stops in {environmentName}; each component serves
            its own traffic again.
          </Typography>
        </li>
        <li>
          <Typography variant="body2" color="textSecondary">
            The components&apos; own routes come back first, so requests keep
            being served while the Endpoint&apos;s route is removed.
          </Typography>
        </li>
      </ul>
      <Typography variant="body2" color="textSecondary">
        You can route the Endpoint here again at any time.
      </Typography>
    </DialogContent>

    <DialogActions>
      <Button onClick={onCancel} disabled={isStopping}>
        Cancel
      </Button>
      <Button
        onClick={onConfirm}
        color="secondary"
        variant="contained"
        disabled={isStopping}
      >
        {isStopping ? 'Stopping...' : 'Stop routing'}
      </Button>
    </DialogActions>
  </Dialog>
);
