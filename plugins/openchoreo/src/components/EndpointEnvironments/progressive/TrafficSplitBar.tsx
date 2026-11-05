import { Box, Tooltip, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import type { EndpointBackendWeight } from '@openchoreo/backstage-plugin-common';
import {
  backendColors,
  backendLabel,
  describeSplit,
  pairFirst,
  roleOf,
  sharePercents,
  type RolloutPair,
} from './endpointUi';
import { RoleTag } from './RoleTag';

const useStyles = makeStyles(theme => ({
  bar: {
    display: 'flex',
    width: '100%',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: theme.palette.action.hover,
  },
  segment: {
    height: '100%',
    '& + &': {
      borderLeft: `2px solid ${theme.palette.background.paper}`,
    },
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5, 1.5),
    marginTop: theme.spacing(0.5),
  },
  key: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontVariantNumeric: 'tabular-nums',
  },
  swatch: {
    width: 9,
    height: 9,
    borderRadius: 2,
    flexShrink: 0,
  },
}));

export interface TrafficSplitBarProps {
  backends: EndpointBackendWeight[];
  /** The running rollout's pair: shown first, in its role colours, tagged. */
  rollout?: RolloutPair;
  /** Show a legend with each backend's percentage. */
  showLegend?: boolean;
  height?: number;
}

const nameOf = (b: EndpointBackendWeight) => b.name ?? b.componentName;

/**
 * A traffic split as a horizontal bar. Weights render as their share of the
 * total, and the bar carries a text description for assistive technology.
 */
export const TrafficSplitBar = ({
  backends,
  rollout,
  showLegend = false,
  height,
}: TrafficSplitBarProps) => {
  const classes = useStyles();
  const ordered = pairFirst(backends, nameOf, rollout);
  const pct = sharePercents(ordered.map(b => b.weight));
  const colors = backendColors(ordered.map(nameOf), rollout);

  return (
    <Box>
      <Box
        className={classes.bar}
        role="img"
        aria-label={`Traffic split: ${describeSplit(ordered)}`}
        style={height ? { height, borderRadius: height / 2 } : undefined}
      >
        {ordered.map((b, i) =>
          pct[i] > 0 ? (
            <Tooltip key={nameOf(b)} title={`${backendLabel(b)}: ${pct[i]}%`}>
              <Box
                className={classes.segment}
                style={{
                  flexBasis: `${pct[i]}%`,
                  backgroundColor: colors.get(nameOf(b)),
                }}
                data-testid="split-segment"
              />
            </Tooltip>
          ) : null,
        )}
      </Box>
      {showLegend && (
        <Box className={classes.legend}>
          {ordered.map((b, i) => {
            const role = roleOf(nameOf(b), rollout);
            return (
              <Typography
                key={nameOf(b)}
                variant="caption"
                color="textSecondary"
                className={classes.key}
              >
                <span
                  className={classes.swatch}
                  style={{ backgroundColor: colors.get(nameOf(b)) }}
                />
                {backendLabel(b)}
                {role && <RoleTag role={role} />} {pct[i]}%
              </Typography>
            );
          })}
        </Box>
      )}
    </Box>
  );
};
