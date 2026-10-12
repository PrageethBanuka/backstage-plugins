import { Box, Tooltip, Typography } from '@material-ui/core';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import type { EndpointBackendWeight } from '@openchoreo/backstage-plugin-common';
import { backendColor, describeSplit, sharePercents } from './endpointUi';

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
  muted: {
    opacity: 0.3,
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
  /**
   * Position of each backend in the Endpoint's backendRefs, so colours match
   * across bars of different releases. Defaults to the array order.
   */
  colorIndex?: (backend: EndpointBackendWeight, i: number) => number;
  /** Highlight one component; the others render muted. */
  focusComponent?: string;
  /** Show a legend with each backend's percentage. */
  showLegend?: boolean;
  height?: number;
}

/**
 * A traffic split as a horizontal bar. Weights render as their share of the
 * total, and the bar carries a text description for assistive technology.
 */
export const TrafficSplitBar = ({
  backends,
  colorIndex = (_b, i) => i,
  focusComponent,
  showLegend = false,
  height,
}: TrafficSplitBarProps) => {
  const classes = useStyles();
  const theme = useTheme();
  const pct = sharePercents(backends.map(b => b.weight));

  return (
    <Box>
      <Box
        className={classes.bar}
        role="img"
        aria-label={`Traffic split: ${describeSplit(backends)}`}
        style={height ? { height, borderRadius: height / 2 } : undefined}
      >
        {backends.map((b, i) =>
          pct[i] > 0 ? (
            <Tooltip
              key={`${b.componentName}/${b.endpoint}`}
              title={`${b.componentName} /${b.endpoint}: ${pct[i]}%`}
            >
              <Box
                className={`${classes.segment} ${
                  focusComponent && b.componentName !== focusComponent
                    ? classes.muted
                    : ''
                }`}
                style={{
                  flexBasis: `${pct[i]}%`,
                  backgroundColor: backendColor(theme, colorIndex(b, i)),
                }}
                data-testid="split-segment"
              />
            </Tooltip>
          ) : null,
        )}
      </Box>
      {showLegend && (
        <Box className={classes.legend}>
          {backends.map((b, i) => (
            <Typography
              key={`${b.componentName}/${b.endpoint}`}
              variant="caption"
              color="textSecondary"
              className={classes.key}
            >
              <span
                className={classes.swatch}
                style={{
                  backgroundColor: backendColor(theme, colorIndex(b, i)),
                }}
              />
              {b.componentName} {pct[i]}%
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
};
