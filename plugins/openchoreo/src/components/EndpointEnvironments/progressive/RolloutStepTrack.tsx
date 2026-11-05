import { Box, Tooltip } from '@material-ui/core';
import { alpha, makeStyles } from '@material-ui/core/styles';
import {
  nextRolloutStage,
  rolloutStages,
  type EndpointRollout,
  type RolloutPosition,
} from '@openchoreo/backstage-plugin-common';
import { stageName } from './rolloutCopy';

const useStyles = makeStyles(theme => ({
  track: {
    display: 'grid',
    gap: theme.spacing(1),
  },
  compact: {
    display: 'inline-flex',
    gap: theme.spacing(0.5),
    '& $pill': { padding: theme.spacing(0.5, 1) },
  },
  pill: {
    textAlign: 'center',
    padding: theme.spacing(0.5, 0),
    borderRadius: 16,
    fontSize: 12,
    lineHeight: '16px',
    fontVariantNumeric: 'tabular-nums',
    border: '1px solid transparent',
  },
  done: {
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
    color: theme.palette.primary.dark,
    fontWeight: 500,
  },
  current: {
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
    fontWeight: 700,
  },
  upcoming: {
    borderColor: theme.palette.divider,
    color: theme.palette.text.secondary,
  },
  dense: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  dotDone: {
    backgroundColor: alpha(theme.palette.primary.main, 0.4),
  },
  dotUpcoming: {
    border: `1.5px solid ${theme.palette.divider}`,
  },
  // As wide as a dot, so a dense track with one gap or two is equally wide.
  gap: {
    width: 8,
    justifySelf: 'center',
    display: 'inline-flex',
    justifyContent: 'center',
    color: theme.palette.text.secondary,
    fontSize: 12,
    lineHeight: '16px',
  },
  // A fixed width, so dense tracks in a list are all as wide whichever
  // stage is current.
  dotCurrent: {
    width: 44,
    textAlign: 'center',
    flexShrink: 0,
    borderRadius: 999,
    fontSize: 12,
    lineHeight: '18px',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
  },
}));

type StageState = 'done' | 'current' | 'upcoming';

function stageStates(
  rollout: EndpointRollout,
  position: RolloutPosition | undefined,
): { label: string; state: StageState }[] {
  const at = position ?? { index: 0, percent: 0, manual: false };
  return rolloutStages(rollout).map((stage, i) => {
    let state: StageState = 'upcoming';
    if (at.manual) {
      if (stage.percent <= at.percent) state = 'done';
    } else if (i < at.index) {
      state = 'done';
    } else if (i === at.index) {
      state = 'current';
    }
    return { label: stageName(rollout, stage.percent), state };
  });
}

/** Most stages a track draws; a longer plan shows a window of them. */
const MAX_SLOTS = 7;

type Slot = { label: string; state: StageState } | 'gap';

/**
 * The stages to draw: all of them, or for a long plan always seven slots,
 * the first and last stage with the ones around the environment's own and a
 * gap for the hidden ones, so tracks of one rollout are equally wide.
 */
export function visibleSlots(
  stages: { label: string; state: StageState }[],
): Slot[] {
  const n = stages.length;
  if (n <= MAX_SLOTS) return stages;
  const current = stages.findIndex(s => s.state === 'current');
  const focus =
    current >= 0
      ? current
      : Math.max(0, stages.map(s => s.state).lastIndexOf('done'));
  const pick = (from: number, to: number) => stages.slice(from, to + 1);
  if (focus <= 3) return [...pick(0, 4), 'gap', stages[n - 1]];
  if (focus >= n - 4) return [stages[0], 'gap', ...pick(n - 5, n - 1)];
  return [
    stages[0],
    'gap',
    ...pick(focus - 1, focus + 1),
    'gap',
    stages[n - 1],
  ];
}

/** Where an environment stands in a stepped rollout, read aloud. */
export function stepTrackLabel(
  rollout: EndpointRollout,
  position: RolloutPosition | undefined,
): string {
  const at = position ?? { index: 0, percent: 0, manual: false };
  if (at.manual) return `Set by hand: ${stageName(rollout, at.percent)}`;
  return `Step ${at.index} of ${rolloutStages(rollout).length - 1}: ${stageName(
    rollout,
    at.percent,
  )}`;
}

/** The line under a step track: the step, and the one after it. */
export function stepCaption(
  rollout: EndpointRollout,
  position: RolloutPosition | undefined,
): string {
  const at = position ?? { index: 0, percent: 0, manual: false };
  const next = nextRolloutStage(rollout, at);
  const where = at.manual
    ? 'Set by hand'
    : `Step ${at.index} of ${rolloutStages(rollout).length - 1}`;
  return next
    ? `${where} · next ${stageName(rollout, next.percent)}`
    : `${where} · last step`;
}

/**
 * The stages of a canary or mirror as a row of pills: the ones passed, the
 * one an environment is at, and the ones to come. Dense draws dots with only
 * the current stage labelled, for a row beside an environment's name;
 * compact sizes the pills to their labels, for a heading row.
 */
export const RolloutStepTrack = ({
  rollout,
  position,
  variant = 'full',
}: {
  rollout: EndpointRollout;
  position: RolloutPosition | undefined;
  variant?: 'full' | 'compact' | 'dense';
}) => {
  const classes = useStyles();
  const slots = visibleSlots(stageStates(rollout, position));
  const label = stepTrackLabel(rollout, position);

  if (variant === 'dense') {
    return (
      <Box className={classes.dense} role="img" aria-label={label}>
        {slots.map((s, i) => {
          if (s === 'gap') {
            return (
              <span key={i} className={classes.gap}>
                …
              </span>
            );
          }
          if (s.state === 'current') {
            return (
              <span key={i} className={classes.dotCurrent}>
                {s.label}
              </span>
            );
          }
          return (
            <Tooltip key={i} title={s.label}>
              <span
                className={`${classes.dot} ${
                  s.state === 'done' ? classes.dotDone : classes.dotUpcoming
                }`}
              />
            </Tooltip>
          );
        })}
      </Box>
    );
  }
  return (
    <Box
      className={variant === 'compact' ? classes.compact : classes.track}
      style={
        variant === 'full'
          ? {
              // Capped, so a short plan doesn't stretch across the panel.
              gridTemplateColumns: slots
                .map(s => (s === 'gap' ? '16px' : 'minmax(36px, 64px)'))
                .join(' '),
            }
          : undefined
      }
      role="img"
      aria-label={label}
    >
      {slots.map((s, i) =>
        s === 'gap' ? (
          <span key={i} className={classes.gap}>
            …
          </span>
        ) : (
          <span
            key={i}
            className={`${classes.pill} ${classes[s.state]}`}
            data-state={s.state}
          >
            {s.label}
          </span>
        ),
      )}
    </Box>
  );
};
