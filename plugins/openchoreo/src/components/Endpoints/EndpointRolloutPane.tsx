import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Tooltip,
  Typography,
} from '@material-ui/core';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ReportProblemOutlinedIcon from '@material-ui/icons/ReportProblemOutlined';
import { formatRelativeTime } from '@openchoreo/backstage-plugin-react';
import { useResourceEnvironmentDetailPanelStyles } from '../ResourceEnvironments/styles';
import { useEndpointEnvironmentsContext } from './EndpointEnvironmentsContext';
import { EndpointSetupPane } from './EndpointSetupPane';
import {
  audienceText,
  completionEnvironment,
  inRollout,
  readyToComplete,
  restoredSummary,
  untouchedSummary,
  stageText,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { describeReach } from './endpointUi';

interface EndpointRolloutPaneProps {
  /** Why changes are blocked (permission, a change in flight); empty if not. */
  changeBlocked: string;
  /** Asks to keep only the new backend (opens the confirmation). */
  onKeep: () => void;
  /** Asks to turn a mirror into a canary (opens the confirmation). */
  onConvert: () => void;
  /** Asks to remove the new backend (opens the confirmation). */
  onRemove: () => void;
  onClose: () => void;
}

/**
 * The Set up pane while a rollout runs. It summarises the rollout; every
 * step runs on the environment tiles. Keeping only the new backend (or, for
 * a mirror, turning it into a canary) sits at the bottom, and removing the
 * new backend in a Danger zone, as Remove deployment does on the Component
 * and Resource panels.
 */
export const EndpointRolloutPane = ({
  changeBlocked,
  onKeep,
  onConvert,
  onRemove,
  onClose,
}: EndpointRolloutPaneProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const { endpoint, environments } = useEndpointEnvironmentsContext();
  const rollout = endpoint.rollout;
  if (!rollout) return null;

  const participants = environments.filter(e => e.bindingName);
  const completeFrom = completionEnvironment(environments);
  const candidate = endpoint.backends.find(
    b => (b.name ?? b.componentName) === rollout.candidate,
  );
  const candidateReach = candidate ? describeReach(candidate) : '';
  let finishBlocked = changeBlocked;
  if (
    !finishBlocked &&
    rollout.strategy !== 'mirror' &&
    !readyToComplete(environments, rollout)
  ) {
    finishBlocked = `Send all traffic to ${rollout.candidate} in every environment first`;
  }
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
        <Typography variant="caption" color="textSecondary">
          {endpoint.rolloutSource === 'detected'
            ? 'This rollout was worked out from the Endpoint’s backends. '
            : ''}
          Each step runs from an environment tile.{' '}
          {rollout.strategy === 'mirror'
            ? `${rollout.candidate} only gets copies. Turn it into a canary to send it real traffic.`
            : `Once every environment sends all traffic to ${
                rollout.candidate
              }, keep only it, here or from ${
                completeFrom?.displayName ?? 'the last environment'
              }.`}
        </Typography>
        <Box display="flex" gridGap={8} flexWrap="wrap">
          <Tooltip title={finishBlocked} disableHoverListener={!finishBlocked}>
            <span>
              <Button
                variant="contained"
                color="primary"
                size="small"
                disabled={Boolean(finishBlocked)}
                onClick={rollout.strategy === 'mirror' ? onConvert : onKeep}
              >
                {rollout.strategy === 'mirror'
                  ? 'Turn into a canary'
                  : `Keep only ${rollout.candidate}`}
              </Button>
            </span>
          </Tooltip>
        </Box>
        <Accordion className={classes.dangerAccordion}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            className={classes.dangerAccordionSummary}
            aria-label="Danger zone"
          >
            <ReportProblemOutlinedIcon
              fontSize="small"
              className={classes.dangerAccordionIcon}
            />
            <Typography
              variant="body2"
              className={classes.dangerAccordionTitle}
            >
              Danger zone
            </Typography>
          </AccordionSummary>
          <AccordionDetails className={classes.dangerAccordionDetails}>
            <Box className={classes.dangerSubsection}>
              <Typography variant="caption" className={classes.dangerCaption}>
                Send all traffic back to {restoredSummary(rollout)} in every
                environment and remove {rollout.candidate} from the Endpoint.
              </Typography>
              <Tooltip
                title={changeBlocked}
                disableHoverListener={!changeBlocked}
              >
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    className={classes.dangerButton}
                    disabled={Boolean(changeBlocked)}
                    onClick={onRemove}
                  >
                    Remove {rollout.candidate}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </AccordionDetails>
        </Accordion>
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
