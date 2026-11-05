import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@material-ui/core';
import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from './pdTypes';
import { finishLabel, finishProblem, type FinishOutcome } from './rolloutCopy';

interface FinishRolloutDialogProps {
  open: boolean;
  rollout: EndpointRollout;
  environments: EndpointEnvironment[];
  onClose: () => void;
  onFinish: (outcome: FinishOutcome) => void;
}

/**
 * Ends the rollout, keeping the new version or the current one. Each choice
 * is open once every environment agrees, so finishing moves no traffic: it
 * cuts a release without the other backend, promoted as usual.
 */
export const FinishRolloutDialog = ({
  open,
  rollout,
  environments,
  onClose,
  onFinish,
}: FinishRolloutDialogProps) => {
  const problems: Record<FinishOutcome, string> = {
    complete: finishProblem(rollout, environments, 'complete'),
    abandon: finishProblem(rollout, environments, 'abandon'),
  };
  const [picked, setPicked] = useState<FinishOutcome | null>(null);
  const outcome: FinishOutcome =
    picked ?? (!problems.complete || problems.abandon ? 'complete' : 'abandon');

  const choice = (value: FinishOutcome, label: string, helper: string) => (
    <Box>
      <FormControlLabel
        value={value}
        disabled={Boolean(problems[value])}
        control={<Radio color="primary" />}
        label={
          <Box display="flex" flexDirection="column">
            <Typography variant="body1">{label}</Typography>
            <Typography variant="body2" color="textSecondary">
              {helper}
            </Typography>
          </Box>
        }
      />
      {problems[value] && (
        <Box ml={4}>
          <Typography variant="caption" color="error">
            {problems[value]}
          </Typography>
        </Box>
      )}
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{finishLabel(rollout)}</DialogTitle>
      <DialogContent>
        <RadioGroup
          value={outcome}
          onChange={e => setPicked(e.target.value as FinishOutcome)}
        >
          {choice(
            'complete',
            `Keep ${rollout.candidate}`,
            `${rollout.candidate} takes ${rollout.stable}’s place.`,
          )}
          {choice(
            'abandon',
            `Keep ${rollout.stable}`,
            `${rollout.candidate} is removed.`,
          )}
        </RadioGroup>
        <Box mt={2}>
          <Typography variant="caption" color="textSecondary">
            This changes the Endpoint, not the traffic: it cuts a release
            without the removed backend, and each environment gets it when you
            promote it.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="primary"
          variant="contained"
          disabled={Boolean(problems[outcome])}
          onClick={() => {
            onFinish(outcome);
            onClose();
          }}
        >
          Finish
        </Button>
      </DialogActions>
    </Dialog>
  );
};
