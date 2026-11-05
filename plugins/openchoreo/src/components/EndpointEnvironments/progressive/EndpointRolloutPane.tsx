import { Box, Button, Tooltip, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { useResourceEnvironmentDetailPanelStyles } from '../../ResourceEnvironments/styles';
import { useEndpointEnvironmentsContext } from './ProgressiveDeliveryContext';
import {
  audienceText,
  inRollout,
  untouchedSummary,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { describeReach } from './endpointUi';
import { stageLabel } from './rolloutCopy';
import { RolloutStepTrack } from './RolloutStepTrack';

interface EndpointRolloutPaneProps {
  /** Opens the rollout's settings; absent once it is deployed. */
  onEdit?: () => void;
}

/**
 * The rollout card under the backends while a rollout runs: a read-only
 * summary of how the new version is reached and where each environment
 * stands. Each environment's Configure moves its traffic; the backends above
 * are tagged Current and New, and removing one of them finishes the rollout.
 */
export const EndpointRolloutPane = ({ onEdit }: EndpointRolloutPaneProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const {
    endpoint,
    environments,
    onConvert,
    changeBlocked = '',
  } = useEndpointEnvironmentsContext();
  const rollout = endpoint.rollout;
  if (!rollout) return null;

  const participants = environments.filter(e => e.bindingName);
  const candidate = endpoint.backends.find(
    b => (b.name ?? b.componentName) === rollout.candidate,
  );
  const candidateReach = candidate ? describeReach(candidate) : '';
  const mirror = rollout.strategy === 'mirror';
  const stepped = rollout.strategy === 'canary' || mirror;
  return (
    <Box
      border={1}
      borderColor="divider"
      borderRadius={12}
      mt={2}
      display="flex"
      flexDirection="column"
    >
      <Box p={2} display="flex" flexDirection="column" gridGap={4}>
        <Typography variant="subtitle2">
          {STRATEGY_COPY[rollout.strategy].name}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          {STRATEGY_COPY[rollout.strategy].pitch}
        </Typography>
        {(onEdit || (mirror && onConvert)) && (
          <Box className={classes.actionsRow} mt={1}>
            {onEdit && (
              <Button
                variant="outlined"
                color="primary"
                size="small"
                onClick={onEdit}
                style={{ whiteSpace: 'nowrap' }}
              >
                Edit
              </Button>
            )}
            {mirror && onConvert && (
              <Tooltip
                title={changeBlocked}
                disableHoverListener={!changeBlocked}
              >
                <span>
                  <Button
                    variant="outlined"
                    color="primary"
                    size="small"
                    disabled={Boolean(changeBlocked)}
                    onClick={onConvert}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Convert to canary
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
      <Box px={2} pb={2} display="flex" flexDirection="column" gridGap={8}>
        {candidate?.match && candidateReach && (
          <Row label="Reached by" value={candidateReach} code />
        )}
        {rollout.strategy === 'abTest' && (
          <Row label="Who" value={audienceText(rollout.preview)} />
        )}
        {untouchedSummary(rollout) && (
          <Row label="Unchanged" value={untouchedSummary(rollout)} />
        )}
      </Box>
      <Box
        p={2}
        borderTop={1}
        borderColor="divider"
        display="flex"
        flexDirection="column"
        gridGap={8}
      >
        <Typography className={classes.sectionHeading}>Progress</Typography>
        {participants.length === 0 && (
          <Typography variant="body2" color="textSecondary">
            Not deployed yet.
          </Typography>
        )}
        {participants.map(e => (
          <Box
            key={e.name}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            gridGap={8}
          >
            <Typography variant="body2">{e.displayName}</Typography>
            {stepped && inRollout(e, rollout) ? (
              <RolloutStepTrack
                rollout={rollout}
                position={e.rollout}
                variant="dense"
              />
            ) : (
              <Typography
                variant="caption"
                color={inRollout(e, rollout) ? 'primary' : 'textSecondary'}
              >
                {stageLabel(e, rollout)}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

const useRowStyles = makeStyles(theme => ({
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(0.5),
  },
  value: {
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  code: {
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    padding: theme.spacing(0, 0.5),
    borderRadius: 4,
    backgroundColor: theme.palette.action.hover,
  },
}));

/** A labelled line; code shows the value as the request carries it. */
function Row({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  const panel = useResourceEnvironmentDetailPanelStyles();
  const classes = useRowStyles();
  return (
    <Box className={classes.row}>
      <Typography variant="caption" className={panel.releaseNameLabel}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        className={`${classes.value} ${code ? classes.code : ''}`}
      >
        {value}
      </Typography>
    </Box>
  );
}
