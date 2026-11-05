import { Box, Button, Chip, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import type { EndpointEnvironment as MentorEnvironment } from '../../../api/OpenChoreoClientApi';
import { useResourceEnvironmentDetailPanelStyles } from '../../ResourceEnvironments/styles';
import { envResourceName } from '../endpointEnvironmentUtils';
import {
  inRollout,
  requestedPercent,
  servedSplit,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { backendLabel, describeReach } from './endpointUi';
import { useProgressiveDelivery } from './ProgressiveDeliveryContext';
import { roleSplit, stageName } from './rolloutCopy';
import { RolloutStepTrack, stepCaption } from './RolloutStepTrack';
import { TrafficSplitBar } from './TrafficSplitBar';

/**
 * The environment's traffic on the detail panel, with Configure to run the
 * rollout here. A canary or a split shows its weights; blue/green and A/B
 * show who the new version serves, and a mirror how much it copies.
 */
export const TrafficBlock = ({ env }: { env: MentorEnvironment }) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const pd = useProgressiveDelivery();
  if (!pd) return null;
  const pdEnv = pd.environments.find(e => e.name === envResourceName(env));
  if (!pdEnv?.bindingName) return null;
  const { endpoint } = pd;
  const rollout = endpoint.rollout;
  if (!rollout && pdEnv.overrides.length === 0) return null;
  const split = servedSplit(pdEnv, endpoint);
  const here = rollout && inRollout(pdEnv, rollout);
  const candidate = rollout
    ? endpoint.backends.find(
        b => (b.name ?? b.componentName) === rollout.candidate,
      )
    : undefined;
  const name = candidate ? backendLabel(candidate, endpoint.backends) : '';
  const percent = pdEnv.rollout?.percent ?? 0;
  const reach = candidate?.match ? describeReach(candidate) : '';
  const previous =
    pd.environments[pd.environments.findIndex(e => e.name === pdEnv.name) - 1];
  const steps =
    rollout &&
    here &&
    (rollout.strategy === 'canary' || rollout.strategy === 'mirror') ? (
      <Box display="flex" flexDirection="column" gridGap={8}>
        <RolloutStepTrack rollout={rollout} position={pdEnv.rollout} />
        <Typography variant="caption" color="textSecondary">
          {stepCaption(rollout, pdEnv.rollout)}
        </Typography>
      </Box>
    ) : null;

  let summary = null;
  if (rollout && !here) {
    summary = (
      <Typography variant="body2" color="textSecondary">
        The new version is not here yet.{' '}
        {previous
          ? `Promote it from ${previous.displayName} to start.`
          : 'Deploy the release from Set up to start.'}
      </Typography>
    );
  } else if (rollout?.strategy === 'mirror') {
    summary = (
      <>
        <Row
          label="Copying"
          value={percent > 0 ? `${percent}% to ${name}` : 'Off'}
        />
        {steps}
      </>
    );
  } else if (rollout?.strategy === 'blueGreen') {
    summary = (
      <>
        <Row label="Serving everyone" value={stageName(rollout, percent)} />
        {reach && <Row label="Preview" value={reach} code />}
      </>
    );
  } else if (rollout?.strategy === 'abTest') {
    summary = (
      <>
        <Row label="New version for" value={stageName(rollout, percent)} />
        {reach && percent < 100 && (
          <Row label="Test group" value={reach} code />
        )}
      </>
    );
  } else if (split.length > 0) {
    const requested = rollout ? requestedPercent(pdEnv, rollout) : undefined;
    summary = (
      <>
        <TrafficSplitBar
          backends={rollout ? roleSplit(split, rollout) : split}
          showLegend
          height={10}
        />
        {requested !== undefined && requested !== percent && (
          <Typography variant="caption" color="textSecondary">
            Set {requested}% · Actual {percent}%, applying
          </Typography>
        )}
        {steps}
      </>
    );
  }

  return (
    <Box className={classes.section}>
      <Box className={classes.sectionTitleRow}>
        <Box display="flex" alignItems="center" gridGap={8}>
          <Typography className={classes.sectionHeading}>Traffic</Typography>
          {rollout && (
            <Chip
              size="small"
              variant="outlined"
              color="primary"
              label={STRATEGY_COPY[rollout.strategy].name}
            />
          )}
        </Box>
        {rollout && (
          <Button
            size="small"
            color="primary"
            onClick={() => pd.onOpenRolloutDialog(pdEnv.name)}
          >
            Configure
          </Button>
        )}
      </Box>
      {summary}
    </Box>
  );
};

const useRowStyles = makeStyles(theme => ({
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(0.5),
  },
  value: { minWidth: 0, overflowWrap: 'anywhere' },
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
