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
  },
  slot: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minWidth: 0,
  },
  dotRow: {
    alignSelf: 'stretch',
    height: 32,
    display: 'flex',
    alignItems: 'center',
  },
  half: {
    flex: 1,
    height: 2,
  },
  solid: { backgroundColor: theme.palette.primary.main },
  dashed: {
    backgroundImage: `repeating-linear-gradient(90deg, ${theme.palette.primary.main} 0 6px, transparent 6px 10px)`,
  },
  idle: { backgroundColor: theme.palette.divider },
  none: { backgroundColor: 'transparent' },
  dot: {
    flexShrink: 0,
    borderRadius: '50%',
    boxSizing: 'border-box',
  },
  dotDone: {
    width: 12,
    height: 12,
    backgroundColor: theme.palette.primary.main,
  },
  dotCurrent: {
    width: 16,
    height: 16,
    border: `2px solid ${theme.palette.primary.main}`,
    backgroundColor: theme.palette.background.paper,
  },
  dotTarget: {
    width: 24,
    height: 24,
    backgroundColor: theme.palette.primary.main,
    boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.16)}`,
  },
  dotUpcoming: {
    width: 12,
    height: 12,
    border: `1.5px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
  },
  label: {
    fontSize: 13,
    lineHeight: '18px',
    color: theme.palette.text.secondary,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  labelStrong: {
    color: theme.palette.text.primary,
  },
  labelTarget: {
    color: theme.palette.text.primary,
    fontWeight: 600,
  },
  gapMark: {
    fontSize: 13,
    lineHeight: '18px',
    color: theme.palette.text.secondary,
  },
  dense: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  },
  denseDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  denseDone: {
    backgroundColor: alpha(theme.palette.primary.main, 0.4),
  },
  denseUpcoming: {
    border: `1.5px solid ${theme.palette.divider}`,
  },
  // As wide as a dot, so a dense track with one gap or two is equally wide.
  denseGap: {
    width: 8,
    display: 'inline-flex',
    justifyContent: 'center',
    color: theme.palette.text.secondary,
    fontSize: 12,
    lineHeight: '16px',
  },
  // A fixed width, so dense tracks in a list are all as wide whichever
  // stage is current.
  denseCurrent: {
    width: 44,
    textAlign: 'center',
    flexShrink: 0,
    borderRadius: 10,
    fontSize: 12,
    lineHeight: '18px',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
  },
}));

type StageState = 'done' | 'current' | 'target' | 'upcoming';

function stageStates(
  rollout: EndpointRollout,
  position: RolloutPosition | undefined,
  target: number | undefined,
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
    if (
      target !== undefined &&
      stage.percent === target &&
      state !== 'current'
    ) {
      state = 'target';
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

/** How the line between two neighbouring slots is drawn. */
function segment(
  a: Slot | undefined,
  b: Slot | undefined,
  reached: (s: Slot) => boolean,
  beforeTarget: (s: Slot) => boolean,
): 'solid' | 'dashed' | 'idle' | 'none' {
  if (!a || !b) return 'none';
  if (reached(a) && reached(b)) return 'solid';
  if (beforeTarget(a) && beforeTarget(b)) return 'dashed';
  return 'idle';
}

/**
 * The stages of a rollout as a track. Full draws evenly spaced stops on a
 * line, solid up to where the environment is and dashed on to the target
 * being picked, for the Configure page. Dense draws dots with only the
 * current stage labelled, for a row in the side panel.
 */
export const RolloutStepTrack = ({
  rollout,
  position,
  target,
  variant = 'full',
}: {
  rollout: EndpointRollout;
  position: RolloutPosition | undefined;
  /** The share being picked, marked on a full track. */
  target?: number;
  variant?: 'full' | 'dense';
}) => {
  const classes = useStyles();
  const slots = visibleSlots(stageStates(rollout, position, target));
  const label = stepTrackLabel(rollout, position);

  if (variant === 'dense') {
    return (
      <Box className={classes.dense} role="img" aria-label={label}>
        {slots.map((s, i) => {
          if (s === 'gap') {
            return (
              <span key={i} className={classes.denseGap}>
                …
              </span>
            );
          }
          if (s.state === 'current') {
            return (
              <span key={i} className={classes.denseCurrent}>
                {s.label}
              </span>
            );
          }
          return (
            <Tooltip key={i} title={s.label}>
              <span
                className={`${classes.denseDot} ${
                  s.state === 'done' ? classes.denseDone : classes.denseUpcoming
                }`}
              />
            </Tooltip>
          );
        })}
      </Box>
    );
  }

  const states = slots.map(s => (s === 'gap' ? 'gap' : s.state));
  const lastReached = Math.max(
    states.lastIndexOf('current'),
    states.lastIndexOf('done'),
  );
  const targetAt = states.indexOf('target');
  const reached = (s: Slot) => slots.indexOf(s) <= lastReached;
  const beforeTarget = (s: Slot) => {
    const i = slots.indexOf(s);
    return targetAt >= 0 && i >= lastReached && i <= targetAt;
  };
  const dotClass: Record<StageState, string> = {
    done: classes.dotDone,
    current: classes.dotCurrent,
    target: classes.dotTarget,
    upcoming: classes.dotUpcoming,
  };
  const labelClass: Record<StageState, string> = {
    done: '',
    current: classes.labelStrong,
    target: classes.labelTarget,
    upcoming: '',
  };

  return (
    <Box
      className={classes.track}
      style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
      role="img"
      aria-label={label}
    >
      {slots.map((s, i) => {
        const left = segment(slots[i - 1], s, reached, beforeTarget);
        const right = segment(s, slots[i + 1], reached, beforeTarget);
        return (
          <Box key={i} className={classes.slot}>
            <Box className={classes.dotRow}>
              <span className={`${classes.half} ${classes[left]}`} />
              {s === 'gap' ? (
                <span className={classes.gapMark}>…</span>
              ) : (
                <span className={`${classes.dot} ${dotClass[s.state]}`} />
              )}
              <span className={`${classes.half} ${classes[right]}`} />
            </Box>
            {s !== 'gap' && (
              <span className={classes.label}>
                <span className={labelClass[s.state]} data-state={s.state}>
                  {s.label}
                </span>
                {s.state === 'current' && ' · now'}
              </span>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
