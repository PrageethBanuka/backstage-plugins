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
import type { RolloutStrategy } from '@openchoreo/backstage-plugin-common';
import { useResourceEnvironmentDetailPanelStyles } from '../ResourceEnvironments/styles';
import { useEndpointEnvironmentsContext } from './EndpointEnvironmentsContext';
import { EndpointSetupPane } from './EndpointSetupPane';
import {
  completionEnvironment,
  inRollout,
  restoredSummary,
  untouchedSummary,
  stageText,
  STRATEGY_COPY,
} from './endpointRolloutUi';

interface EndpointRolloutPaneProps {
  /** Why starting is blocked; empty when it is allowed. */
  startBlocked: string;
  onStart: () => void;
  /** Why changes are blocked (permission, a change in flight); empty if not. */
  changeBlocked: string;
  /** Asks to abandon the running rollout (opens the confirmation). */
  onAbandon: () => void;
  onClose: () => void;
}

/**
 * Right pane for the Rollout tile. With nothing running it explains the
 * three strategies and starts one. While a rollout runs it summarises it;
 * every step happens on the environment tiles, and abandoning it sits in
 * a Danger zone at the bottom, as Remove deployment does on the Component
 * and Resource panels.
 */
export const EndpointRolloutPane = ({
  startBlocked,
  onStart,
  changeBlocked,
  onAbandon,
  onClose,
}: EndpointRolloutPaneProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const { endpoint, environments } = useEndpointEnvironmentsContext();
  const rollout = endpoint.rollout;

  if (!rollout) {
    return (
      <EndpointSetupPane
        title="Rollout"
        onClose={onClose}
        action={{
          label: 'Start rollout',
          onClick: onStart,
          disabledReason: startBlocked,
        }}
      >
        <Box display="flex" flexDirection="column" gridGap={12}>
          <Typography variant="body2" color="textSecondary">
            Move traffic to a new version step by step, and roll back with one
            click.
          </Typography>
          {(Object.keys(STRATEGY_COPY) as RolloutStrategy[]).map(kind => (
            <Box key={kind}>
              <Typography variant="body2" style={{ fontWeight: 600 }}>
                {STRATEGY_COPY[kind].name}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {STRATEGY_COPY[kind].pitch}
              </Typography>
            </Box>
          ))}
        </Box>
      </EndpointSetupPane>
    );
  }

  const participants = environments.filter(e => e.bindingName);
  const completeFrom = completionEnvironment(environments);
  return (
    <EndpointSetupPane title="Rollout" onClose={onClose}>
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
          <Row label="From" value={rollout.stable} />
          <Row label="To" value={rollout.candidate} />
          {untouchedSummary(rollout) && (
            <Row label="Unchanged" value={untouchedSummary(rollout)} />
          )}
          {rollout.strategy === 'canary' && (
            <Row
              label="Steps"
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
            ? 'This rollout was worked out from the Endpoint’s versions and rules. '
            : ''}
          Each step runs from an environment tile. Once every environment sends
          all traffic to {rollout.candidate}, complete the rollout from{' '}
          {completeFrom?.displayName ?? 'the last environment'}.
        </Typography>
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
                    onClick={onAbandon}
                  >
                    Abandon rollout
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
