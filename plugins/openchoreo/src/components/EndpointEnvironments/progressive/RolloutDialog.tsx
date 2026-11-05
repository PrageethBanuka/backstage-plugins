import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import { ToggleButton, ToggleButtonGroup } from '@material-ui/lab';
import {
  nextRolloutStage,
  rolloutStages,
  rolloutWeights,
  type RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment } from './pdTypes';
import { useEndpointReleaseBindingUpdatePermission } from '@openchoreo/backstage-plugin-react';
import { useEndpointEnvironmentsContext } from './ProgressiveDeliveryContext';
import {
  inRollout,
  previewCommand,
  requestedPercent,
  servedSplit,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { TrafficSplitBar } from './TrafficSplitBar';
import { backendColor } from './endpointUi';
import { StrategyFlow, toFlowVersion } from './StrategyFlow';
import { roleSplit, stageAction, stageName } from './rolloutCopy';
import { RolloutStepTrack } from './RolloutStepTrack';
import { useResourceEnvironmentDetailPanelStyles } from '../../ResourceEnvironments/styles';

const useStyles = makeStyles(theme => ({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    paddingBottom: theme.spacing(2.5),
    marginBottom: theme.spacing(2.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:last-child': { borderBottom: 0, marginBottom: 0, paddingBottom: 0 },
  },
  headingRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  },
  readout: {
    fontSize: '1.1rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  slider: {
    padding: theme.spacing(0, 1.5),
  },
  applying: {
    color: theme.palette.warning.dark,
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  command: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 0.5, 0.5, 1.5),
    borderRadius: 8,
    background: theme.palette.action.hover,
  },
  commandText: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12.5,
    overflowX: 'auto',
    whiteSpace: 'pre',
    flex: '1 1 auto',
    minWidth: 0,
  },
  commandRole: {
    flexShrink: 0,
    fontWeight: 500,
  },
}));

/** What the control in Configure sets, by strategy. */
const CONTROL_LABEL: Record<RolloutStrategy, string> = {
  canary: 'Share for the new version',
  blueGreen: 'Serving everyone',
  abTest: 'New version for',
  mirror: 'Copy of traffic',
};

const nameOf = (b: { name?: string; componentName: string }) =>
  b.name ?? b.componentName;

export interface RolloutDialogProps {
  /** The environment the dialog was opened for; null when closed. */
  env: EndpointEnvironment | null;
  /** Why changes are blocked (permission, a change in flight); empty if not. */
  changeBlocked: string;
  onClose: () => void;
  /** Moves an environment to a share of the new version. */
  onSetStage: (env: EndpointEnvironment, percent: number) => void;
}

/**
 * Configure: the traffic a running rollout sends to the new version in one
 * environment. Next step, Back to Current or the control picks a share,
 * previewed here and applied with Save. Controls name the backends by role,
 * Current and New version.
 */
export const RolloutDialog = ({
  env,
  changeBlocked,
  onClose,
  onSetStage,
}: RolloutDialogProps) => {
  const { endpoint } = useEndpointEnvironmentsContext();
  const rollout = endpoint.rollout;
  return (
    <Dialog
      open={Boolean(env && rollout)}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="rollout-dialog-title"
    >
      {env && rollout && (
        <RolloutDialogContent
          key={env.name}
          env={env}
          changeBlocked={changeBlocked}
          onClose={onClose}
          onSetStage={onSetStage}
        />
      )}
    </Dialog>
  );
};

function RolloutDialogContent({
  env,
  changeBlocked,
  onClose,
  onSetStage,
}: RolloutDialogProps & { env: EndpointEnvironment }) {
  const classes = useStyles();
  const panel = useResourceEnvironmentDetailPanelStyles();
  const theme = useTheme();
  const { endpoint, environments, onCopy } = useEndpointEnvironmentsContext();
  const perm = useEndpointReleaseBindingUpdatePermission(env.name);
  const rollout = endpoint.rollout!;
  const here = inRollout(env, rollout);
  const stages = rolloutStages(rollout);
  const percent = env.rollout?.percent ?? 0;
  const [target, setTarget] = useState(percent);
  useEffect(() => setTarget(percent), [percent]);
  const preview = here ? previewCommand(rollout, env.invokeURL) : undefined;
  const previous = environments[environments.indexOf(env) - 1];
  const stepped =
    rollout.strategy === 'canary' || rollout.strategy === 'mirror';
  const next = nextRolloutStage(
    rollout,
    env.rollout ?? { index: 0, percent: 0, manual: false },
  );
  const requested = requestedPercent(env, rollout);

  const live = servedSplit(env, endpoint);
  const weights = new Map(
    rolloutWeights(rollout, live.map(nameOf), target).map(o => [
      o.name,
      o.weight ?? 0,
    ]),
  );
  const planned =
    rollout.strategy === 'mirror'
      ? live
      : live.map(b => ({ ...b, weight: weights.get(nameOf(b)) ?? b.weight }));
  const flowVersion = (name: string, otherName: string) => {
    const byName = (n: string) => endpoint.backends.find(b => nameOf(b) === n);
    const index = live.findIndex(b => nameOf(b) === name);
    return toFlowVersion(
      byName(name) ?? { componentName: name },
      byName(otherName),
      backendColor(theme, index < 0 ? 0 : index),
    );
  };

  let blocked =
    changeBlocked ||
    (!perm.loading && !perm.canUpdate ? perm.deniedTooltip : '');
  const changeDisabled = Boolean(blocked) || perm.loading;
  if (!blocked && target === percent) blocked = 'Pick another share';

  const save = () => {
    onSetStage(env, target);
    onClose();
  };

  return (
    <>
      <DialogTitle id="rollout-dialog-title" disableTypography>
        <Typography variant="h6">
          {STRATEGY_COPY[rollout.strategy].name} in {env.displayName}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {STRATEGY_COPY[rollout.strategy].pitch}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {here ? (
          <>
            <Box className={classes.section}>
              <StrategyFlow
                strategy={rollout.strategy}
                preview={rollout.preview}
                percent={target}
                current={flowVersion(rollout.stable, rollout.candidate)}
                next={flowVersion(rollout.candidate, rollout.stable)}
              />
              {rollout.strategy !== 'mirror' && (
                <TrafficSplitBar
                  backends={roleSplit(planned, rollout)}
                  showLegend
                  height={10}
                />
              )}
              {requested !== undefined && requested !== percent && (
                <Typography variant="caption" className={classes.applying}>
                  Set {requested}% · Actual {percent}%, applying
                </Typography>
              )}
            </Box>

            {stepped && (next || percent > 0) && (
              <Box className={classes.section}>
                <Box className={classes.headingRow}>
                  <Typography className={panel.sectionHeading}>
                    Next step
                  </Typography>
                  <RolloutStepTrack
                    rollout={rollout}
                    position={env.rollout}
                    variant="compact"
                  />
                </Box>
                <Box className={classes.row}>
                  {next && (
                    <Button
                      variant="outlined"
                      color="primary"
                      size="small"
                      disabled={changeDisabled || target === next.percent}
                      onClick={() => setTarget(next.percent)}
                    >
                      {rollout.strategy === 'mirror'
                        ? stageAction(rollout, next.percent)
                        : `Next step · ${next.percent}%`}
                    </Button>
                  )}
                  {percent > 0 && (
                    <Button
                      color="primary"
                      size="small"
                      disabled={changeDisabled || target === 0}
                      onClick={() => setTarget(0)}
                    >
                      {stageAction(rollout, 0)}
                    </Button>
                  )}
                </Box>
              </Box>
            )}

            <Box className={classes.section}>
              <Box className={classes.headingRow}>
                <Typography className={panel.sectionHeading}>
                  {CONTROL_LABEL[rollout.strategy]}
                </Typography>
                <Typography className={classes.readout}>
                  {stageName(rollout, target)}
                </Typography>
              </Box>
              <TrafficControl
                strategy={rollout.strategy}
                stages={stages.map(st => st.percent)}
                value={target}
                onChange={setTarget}
                sliderClass={classes.slider}
              />
              <Typography variant="caption" color="textSecondary">
                {target === percent
                  ? `This is what ${env.displayName} serves now.`
                  : `${env.displayName} serves ${stageName(
                      rollout,
                      percent,
                    )} now. Save to change it.`}
              </Typography>
            </Box>

            {preview && (
              <Box className={classes.section}>
                <Typography className={panel.sectionHeading}>
                  Test it
                </Typography>
                <Command
                  text={preview}
                  reaches="New version"
                  label="Copy test command"
                  onCopy={() => onCopy(preview, 'test command')}
                />
                {env.invokeURL && (
                  <Command
                    text={`curl ${env.invokeURL}`}
                    reaches="Current"
                    label="Copy command for Current"
                    onCopy={() =>
                      onCopy(`curl ${env.invokeURL}`, 'command for Current')
                    }
                  />
                )}
                <Typography variant="caption" color="textSecondary">
                  Anyone who sends this reaches the new version. It is not
                  access control.
                </Typography>
              </Box>
            )}
          </>
        ) : (
          <Typography variant="body2" color="textSecondary">
            The new version is not in {env.displayName} yet.{' '}
            {previous
              ? `Promote the release from ${previous.displayName} to start it here.`
              : 'Deploy the release from Set up to start it here.'}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{here ? 'Cancel' : 'Close'}</Button>
        {here && (
          <Tooltip title={blocked} disableHoverListener={!blocked}>
            <span>
              <Button
                variant="contained"
                color="primary"
                disabled={Boolean(blocked) || perm.loading}
                onClick={save}
              >
                Save
              </Button>
            </span>
          </Tooltip>
        )}
      </DialogActions>
    </>
  );
}

/** A one-line command with whom it reaches and a copy button inside it. */
function Command({
  text,
  reaches,
  label,
  onCopy,
}: {
  text: string;
  reaches: string;
  label: string;
  onCopy: () => void;
}) {
  const classes = useStyles();
  return (
    <Box className={classes.command}>
      <span className={classes.commandText}>{text}</span>
      <Typography
        variant="caption"
        color={reaches === 'Current' ? 'textSecondary' : 'primary'}
        className={classes.commandRole}
      >
        {reaches}
      </Typography>
      <Tooltip title="Copy command">
        <IconButton size="small" aria-label={label} onClick={onCopy}>
          <FileCopyOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/**
 * The control that sets the new version's traffic, shaped by the strategy:
 * a share on a slider for a canary or a mirror, with the steps marked, and
 * a choice of two for blue/green and A/B, as the Resource retain policy is.
 */
function TrafficControl({
  strategy,
  stages,
  value,
  onChange,
  sliderClass,
}: {
  strategy: RolloutStrategy;
  stages: number[];
  value: number;
  onChange: (percent: number) => void;
  sliderClass: string;
}) {
  if (strategy === 'blueGreen' || strategy === 'abTest') {
    const [off, on] =
      strategy === 'blueGreen'
        ? ['Current', 'New version']
        : ['Test group', 'Everyone'];
    return (
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value >= 100 ? 100 : 0}
        onChange={(_e, next) => {
          if (next !== null) onChange(next as number);
        }}
        aria-label={CONTROL_LABEL[strategy]}
      >
        <ToggleButton value={0}>{off}</ToggleButton>
        <ToggleButton value={100}>{on}</ToggleButton>
      </ToggleButtonGroup>
    );
  }
  return (
    <Box className={sliderClass}>
      <Slider
        value={value}
        min={0}
        max={100}
        step={1}
        marks={stages.map((p, i) => {
          // A step within 8% of the one before it goes unlabelled, so labels
          // never overlap.
          const labelled = i === 0 || p - stages[i - 1] >= 8 || p === 100;
          const text = p === 0 && strategy === 'mirror' ? 'Off' : `${p}%`;
          return { value: p, label: labelled ? text : undefined };
        })}
        onChange={(_e, v) => onChange(v as number)}
        aria-label={CONTROL_LABEL[strategy]}
      />
    </Box>
  );
}
