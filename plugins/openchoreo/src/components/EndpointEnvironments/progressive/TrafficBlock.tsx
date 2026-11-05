import { Box, Button, Typography } from '@material-ui/core';
import { useNavigate } from 'react-router-dom';
import { rolloutStages } from '@openchoreo/backstage-plugin-common';
import { makeStyles } from '@material-ui/core/styles';
import type { EndpointEnvironment as MentorEnvironment } from '../../../api/OpenChoreoClientApi';
import { useResourceEnvironmentDetailPanelStyles } from '../../ResourceEnvironments/styles';
import { envResourceName } from '../endpointEnvironmentUtils';
import {
  hasOwnSplit,
  inRollout,
  requestedPercent,
  servedSplit,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { describeReach } from './endpointUi';
import { useProgressiveDelivery } from './ProgressiveDeliveryContext';
import { shareMeaning, shareName } from './rolloutCopy';
import { RolloutStepTrack } from './RolloutStepTrack';
import { TrafficSplitBar } from './TrafficSplitBar';

const useStyles = makeStyles(theme => ({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  },
}));

/**
 * The environment's traffic on the detail panel, in three rows: the
 * heading with Configure, what it serves, and where the rollout is here.
 * Configure opens the Configure traffic page for this environment.
 */
export const TrafficBlock = ({ env }: { env: MentorEnvironment }) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const own = useStyles();
  const navigate = useNavigate();
  const pd = useProgressiveDelivery();
  if (!pd) return null;
  const pdEnv = pd.environments.find(e => e.name === envResourceName(env));
  if (!pdEnv?.bindingName) return null;
  const { endpoint } = pd;
  const rollout = endpoint.rollout;
  if (!rollout && !hasOwnSplit(pdEnv, endpoint)) return null;
  const split = servedSplit(pdEnv, endpoint);
  const here = rollout && inRollout(pdEnv, rollout);
  const candidate = rollout
    ? endpoint.backends.find(
        b => (b.name ?? b.componentName) === rollout.candidate,
      )
    : undefined;
  const percent = pdEnv.rollout?.percent ?? 0;
  const reach = candidate?.match ? describeReach(candidate) : '';
  const previous =
    pd.environments[pd.environments.findIndex(e => e.name === pdEnv.name) - 1];
  const requested = rollout ? requestedPercent(pdEnv, rollout) : undefined;

  let body = null;
  if (!rollout) {
    body = (
      <>
        <TrafficSplitBar backends={split} showLegend height={8} />
        <Typography variant="body2" color="textSecondary">
          Changed outside the portal, so it differs from the shares in Set up.
          The next deploy or promote here applies those shares.
        </Typography>
      </>
    );
  } else if (!here) {
    body = (
      <Typography variant="body2" color="textSecondary">
        Not deployed.{' '}
        {previous
          ? `Promote it from ${previous.displayName} first.`
          : 'Deploy the release from Set up first.'}
      </Typography>
    );
  } else {
    const strategy = rollout.strategy;
    const stepped = strategy === 'canary' || strategy === 'mirror';
    let where = shareName(rollout, percent);
    if (pdEnv.rollout?.manual) {
      where = stepped ? 'set by hand' : `${where} · set by hand`;
    } else if (stepped) {
      where = `step ${pdEnv.rollout?.index ?? 0} of ${
        rolloutStages(rollout).length - 1
      }`;
    }
    body = (
      <>
        {strategy === 'mirror' ? (
          <Row
            label="Copying"
            value={percent > 0 ? `${percent}% to the new version` : 'Off'}
          />
        ) : (
          <TrafficSplitBar
            backends={split}
            rollout={rollout}
            showLegend
            height={8}
          />
        )}
        {requested !== undefined && requested !== percent && (
          <Typography variant="caption" color="textSecondary">
            Progressing: {shareName(rollout, percent)} →{' '}
            {shareName(rollout, requested)}
          </Typography>
        )}
        <Box className={own.statusRow}>
          <Typography variant="body2" color="textSecondary">
            {STRATEGY_COPY[strategy].name} · {where}
          </Typography>
          {stepped && (
            <RolloutStepTrack
              rollout={rollout}
              position={pdEnv.rollout}
              variant="dense"
            />
          )}
        </Box>
        {strategy !== 'mirror' && (
          <Typography variant="body2" color="textSecondary">
            {shareMeaning(rollout, percent)}
          </Typography>
        )}
        {reach && strategy === 'blueGreen' && (
          <Row label="Preview" value={reach} code />
        )}
        {reach && strategy === 'abTest' && percent < 100 && (
          <Row label="Test group" value={reach} code />
        )}
      </>
    );
  }

  return (
    <Box className={classes.section}>
      <Box className={classes.sectionTitleRow}>
        <Typography className={classes.sectionHeading}>Traffic</Typography>
        {rollout && (
          <Button
            size="small"
            color="primary"
            onClick={() => navigate(`traffic/${pdEnv.name}`)}
          >
            Configure
          </Button>
        )}
      </Box>
      <Box className={own.body}>{body}</Box>
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
