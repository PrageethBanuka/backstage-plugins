import { Box, Button, Chip, Typography } from '@material-ui/core';
import { formatRelativeTime } from '@openchoreo/backstage-plugin-react';
import { useResourceEnvironmentDetailPanelStyles } from '../ResourceEnvironments/styles';
import { useEndpointEnvironmentsContext } from './EndpointEnvironmentsContext';
import { EndpointSetupPane } from './EndpointSetupPane';
import {
  audienceText,
  inRollout,
  untouchedSummary,
  stageText,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { describeReach } from './endpointUi';

interface EndpointRolloutPaneProps {
  /** Opens the Manage rollout dialog. */
  onManage: () => void;
  onClose: () => void;
}

/**
 * The Set up pane while a rollout runs: a short summary of the rollout and
 * where each environment is. Steps, the preview and finishing the rollout
 * are in the Manage rollout dialog.
 */
export const EndpointRolloutPane = ({
  onManage,
  onClose,
}: EndpointRolloutPaneProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const { endpoint, environments } = useEndpointEnvironmentsContext();
  const rollout = endpoint.rollout;
  if (!rollout) return null;

  const participants = environments.filter(e => e.bindingName);
  const candidate = endpoint.backends.find(
    b => (b.name ?? b.componentName) === rollout.candidate,
  );
  const candidateReach = candidate ? describeReach(candidate) : '';
  return (
    <EndpointSetupPane title="Set up" onClose={onClose}>
      <Box display="flex" flexDirection="column" gridGap={16}>
        <Box display="flex" alignItems="center" flexWrap="wrap" gridGap={8}>
          <Chip
            size="small"
            color="primary"
            label={STRATEGY_COPY[rollout.strategy].name}
          />
          {endpoint.rolloutSource === 'detected' && (
            <Chip size="small" variant="outlined" label="detected" />
          )}
          {rollout.startedAt && (
            <Typography variant="caption" color="textSecondary">
              started {formatRelativeTime(rollout.startedAt)}
              {rollout.startedBy ? ` by ${rollout.startedBy}` : ''}
            </Typography>
          )}
        </Box>
        <Box>
          <Row label="Current" value={rollout.stable} />
          <Row label="New backend" value={rollout.candidate} />
          {candidateReach && <Row label="Reached by" value={candidateReach} />}
          {rollout.strategy === 'abTest' && (
            <Row label="Who" value={audienceText(rollout.preview)} />
          )}
          {untouchedSummary(rollout) && (
            <Row label="Unchanged" value={untouchedSummary(rollout)} />
          )}
          {(rollout.strategy === 'canary' || rollout.strategy === 'mirror') && (
            <Row
              label={rollout.strategy === 'mirror' ? 'Copy shares' : 'Steps'}
              value={rollout.steps.map(s => `${s}%`).join(' → ')}
            />
          )}
        </Box>
        <Box display="flex" flexDirection="column" gridGap={6}>
          <Typography className={classes.sectionHeading}>Progress</Typography>
          {participants.map(e => (
            <Box
              key={e.name}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gridGap={8}
            >
              <Typography variant="body2">{e.displayName}</Typography>
              <Chip
                size="small"
                color={inRollout(e, rollout) ? 'primary' : 'default'}
                variant="outlined"
                label={stageText(e, rollout)}
              />
            </Box>
          ))}
        </Box>
        {endpoint.rolloutSource === 'detected' && (
          <Typography variant="caption" color="textSecondary">
            This rollout was worked out from the Endpoint’s backends.
          </Typography>
        )}
        <Box>
          <Button
            variant="outlined"
            color="primary"
            size="small"
            onClick={onManage}
          >
            Manage rollout
          </Button>
        </Box>
      </Box>
    </EndpointSetupPane>
  );
};

function Row({ label, value }: { label: string; value: string }) {
  const classes = useResourceEnvironmentDetailPanelStyles();
  return (
    <Box className={classes.releaseNameRow}>
      <Typography variant="caption" className={classes.releaseNameLabel}>
        {label}
      </Typography>
      <Typography variant="caption" className={classes.releaseName}>
        {value}
      </Typography>
    </Box>
  );
}
