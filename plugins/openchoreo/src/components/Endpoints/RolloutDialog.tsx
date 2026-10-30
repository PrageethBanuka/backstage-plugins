import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import UndoIcon from '@material-ui/icons/Undo';
import {
  rolloutStages,
  stableLabel,
  type EndpointEnvironment,
} from '@openchoreo/backstage-plugin-common';
import { useEndpointRolloutPermission } from '@openchoreo/backstage-plugin-react';
import { useEndpointEnvironmentsContext } from './EndpointEnvironmentsContext';
import {
  inRollout,
  previewCommand,
  readyToComplete,
  rolloutAction,
  rolloutReachText,
  servedSplit,
  stageText,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { TrafficSplitBar } from './TrafficSplitBar';

const useStyles = makeStyles(theme => ({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    paddingBottom: theme.spacing(2),
    marginBottom: theme.spacing(2),
    borderBottom: `1px solid ${theme.palette.divider}`,
    '&:last-child': { borderBottom: 0, marginBottom: 0, paddingBottom: 0 },
  },
  heading: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  editor: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 88px',
    gap: theme.spacing(2),
    alignItems: 'center',
  },
  command: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12.5,
    padding: theme.spacing(1, 1.5),
    borderRadius: 6,
    background: theme.palette.action.hover,
    overflowX: 'auto',
    whiteSpace: 'pre',
    flex: '1 1 auto',
    minWidth: 0,
  },
  danger: {
    color: theme.palette.error.main,
    borderColor: theme.palette.error.main,
  },
  envRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
}));

export interface RolloutDialogProps {
  /** The environment the dialog was opened for; null when closed. */
  env: EndpointEnvironment | null;
  /** Why changes are blocked (permission, a change in flight); empty if not. */
  changeBlocked: string;
  onClose: () => void;
  /** Moves an environment to a share of the new version (asks first in production). */
  onSetStage: (
    env: EndpointEnvironment,
    percent: number,
    label: string,
  ) => void;
  /** Asks to keep only the new backend. */
  onKeep: () => void;
  /** Asks to turn a mirror into a canary. */
  onConvert: () => void;
  /** Asks to remove the new backend. */
  onRemove: () => void;
}

/**
 * Manage rollout: everything a running rollout lets you do, opened from an
 * environment's panel or tile. One short page: this environment's steps and
 * a traffic editor, the preview command, where each environment is, and
 * finishing the rollout. Promote stays on the panels and tiles.
 */
export const RolloutDialog = ({
  env,
  changeBlocked,
  onClose,
  onSetStage,
  onKeep,
  onConvert,
  onRemove,
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
          env={env}
          changeBlocked={changeBlocked}
          onClose={onClose}
          onSetStage={onSetStage}
          onKeep={onKeep}
          onConvert={onConvert}
          onRemove={onRemove}
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
  onKeep,
  onConvert,
  onRemove,
}: RolloutDialogProps & { env: EndpointEnvironment }) {
  const classes = useStyles();
  const { endpoint, environments, onRollBack, onCopy } =
    useEndpointEnvironmentsContext();
  const perm = useEndpointRolloutPermission(env.name, Boolean(env.bindingName));
  const rollout = endpoint.rollout!;
  const here = inRollout(env, rollout);
  const percent = env.rollout?.percent ?? 0;
  const [share, setShare] = useState(percent);
  useEffect(() => setShare(percent), [percent, env.name]);

  const mirror = rollout.strategy === 'mirror';
  const stepBlocked =
    changeBlocked ||
    (!perm.loading && !perm.canRollOut ? perm.rollOutDeniedTooltip : '');
  const stepDisabled = Boolean(stepBlocked) || perm.loading;
  const next = rolloutAction(env, endpoint, environments);
  const stages = rolloutStages(rollout);
  const preview = here ? previewCommand(rollout, env.invokeURL) : undefined;
  const reach = rolloutReachText(rollout, endpoint, env);
  const previous = environments[environments.indexOf(env) - 1];

  let finishBlocked = changeBlocked;
  if (!finishBlocked && !mirror && !readyToComplete(environments, rollout)) {
    finishBlocked = `Send all traffic to ${rollout.candidate} in every environment first`;
  }
  const finish = (run: () => void) => {
    onClose();
    run();
  };

  return (
    <>
      <DialogTitle id="rollout-dialog-title" disableTypography>
        <Typography variant="h6">
          {STRATEGY_COPY[rollout.strategy].name} · {rollout.candidate}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {stableLabel(rollout)} → {rollout.candidate}
          {reach ? ` · ${reach}` : ''}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box className={classes.section}>
          <Typography className={classes.heading}>{env.displayName}</Typography>
          {here ? (
            <>
              <Box className={classes.row} role="group" aria-label="Stages">
                {stages.map((s, index) => {
                  const now =
                    !env.rollout?.manual && env.rollout?.index === index;
                  return (
                    <Chip
                      key={s.id}
                      size="small"
                      label={s.label}
                      color={now ? 'primary' : 'default'}
                      variant={now ? 'default' : 'outlined'}
                      clickable={!now && !stepDisabled}
                      disabled={!now && stepDisabled}
                      aria-current={now ? 'step' : undefined}
                      onClick={
                        now || stepDisabled
                          ? undefined
                          : () => onSetStage(env, s.percent, s.action)
                      }
                    />
                  );
                })}
              </Box>
              <Tooltip title={stepBlocked} disableHoverListener={!stepBlocked}>
                <Box className={classes.row}>
                  {next && (
                    <Button
                      variant="contained"
                      color="primary"
                      size="small"
                      disabled={stepDisabled}
                      onClick={() =>
                        next.kind === 'stage'
                          ? onSetStage(env, next.percent, next.label)
                          : finish(onKeep)
                      }
                    >
                      {next.label}
                    </Button>
                  )}
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<UndoIcon fontSize="small" />}
                    disabled={stepDisabled || percent === 0}
                    onClick={() => onRollBack(env.name)}
                  >
                    {mirror
                      ? 'Stop copying'
                      : `Roll back to ${stableLabel(rollout)}`}
                  </Button>
                </Box>
              </Tooltip>
            </>
          ) : (
            <Typography variant="body2" color="textSecondary">
              {rollout.candidate} is not in {env.displayName} yet.
              {previous
                ? ` Use Promote on ${previous.displayName} to bring it here at 0%.`
                : ''}
            </Typography>
          )}
        </Box>

        {here && (
          <Box className={classes.section}>
            <Typography className={classes.heading}>Traffic</Typography>
            {!mirror && (
              <TrafficSplitBar
                backends={servedSplit(env, endpoint)}
                showLegend
                height={10}
              />
            )}
            <Box className={classes.editor}>
              <Slider
                value={share}
                min={0}
                max={100}
                step={1}
                disabled={stepDisabled}
                onChange={(_, v) => setShare(v as number)}
                aria-label={
                  mirror
                    ? `Share of requests copied to ${rollout.candidate}`
                    : `Share of traffic for ${rollout.candidate}`
                }
              />
              <TextField
                size="small"
                variant="outlined"
                type="number"
                value={share}
                disabled={stepDisabled}
                inputProps={{
                  min: 0,
                  max: 100,
                  'aria-label': mirror ? 'Copy share' : 'Traffic share',
                }}
                InputProps={{ endAdornment: '%' }}
                onChange={e =>
                  setShare(
                    Math.max(
                      0,
                      Math.min(100, Math.round(Number(e.target.value) || 0)),
                    ),
                  )
                }
              />
            </Box>
            <Typography variant="caption" color="textSecondary">
              {mirror
                ? `${
                    rollout.candidate
                  } gets a copy of ${share}% of requests; ${stableLabel(
                    rollout,
                  )} keeps answering all of them.`
                : `${rollout.candidate} ${share}% · ${stableLabel(rollout)} ${
                    100 - share
                  }%. A share between steps shows as set by hand.`}
            </Typography>
            <Box className={classes.row}>
              <Button
                variant="outlined"
                color="primary"
                size="small"
                disabled={stepDisabled || share === percent}
                onClick={() =>
                  onSetStage(
                    env,
                    share,
                    mirror
                      ? `Copy ${share}%`
                      : `Send ${share}% to ${rollout.candidate}`,
                  )
                }
              >
                Apply
              </Button>
            </Box>
          </Box>
        )}

        {preview && (
          <Box className={classes.section}>
            <Typography className={classes.heading}>Preview</Typography>
            <Box className={classes.row}>
              <Box className={classes.command}>{preview}</Box>
              <Tooltip title="Copy command">
                <IconButton
                  size="small"
                  aria-label="Copy preview command"
                  onClick={() => onCopy(preview, 'preview command')}
                >
                  <FileCopyOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Typography variant="caption" color="textSecondary">
              Anyone who sends this reaches {rollout.candidate}, at every step.
            </Typography>
          </Box>
        )}

        <Box className={classes.section}>
          <Typography className={classes.heading}>Environments</Typography>
          {environments
            .filter(e => e.bindingName)
            .map(e => (
              <Box key={e.name} className={classes.envRow}>
                <Typography variant="body2">{e.displayName}</Typography>
                <Typography variant="body2" color="textSecondary">
                  {inRollout(e, rollout)
                    ? stageText(e, rollout)
                    : 'Not reached'}
                </Typography>
              </Box>
            ))}
        </Box>

        <Box className={classes.section}>
          <Typography className={classes.heading}>Finish</Typography>
          <Box className={classes.row}>
            <Tooltip
              title={finishBlocked}
              disableHoverListener={!finishBlocked}
            >
              <span>
                <Button
                  variant="outlined"
                  color="primary"
                  size="small"
                  disabled={Boolean(finishBlocked)}
                  onClick={() => finish(mirror ? onConvert : onKeep)}
                >
                  {mirror
                    ? 'Turn into a canary'
                    : `Keep only ${rollout.candidate}`}
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              title={changeBlocked}
              disableHoverListener={!changeBlocked}
            >
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  className={classes.danger}
                  disabled={Boolean(changeBlocked)}
                  onClick={() => finish(onRemove)}
                >
                  Remove {rollout.candidate}
                </Button>
              </span>
            </Tooltip>
          </Box>
          {finishBlocked && !changeBlocked && (
            <Typography variant="caption" color="textSecondary">
              {finishBlocked}.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Box flex="1 1 auto" pl={1}>
          <Typography variant="caption" color="textSecondary">
            Steps change {env.displayName}&apos;s traffic only; no new release
            is cut.
          </Typography>
        </Box>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </>
  );
}
