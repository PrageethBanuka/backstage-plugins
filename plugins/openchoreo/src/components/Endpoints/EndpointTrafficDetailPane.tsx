import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
} from '@material-ui/core';
import CallSplitIcon from '@material-ui/icons/CallSplit';
import CloseIcon from '@material-ui/icons/Close';
import { useEndpointTrafficPermission } from '@openchoreo/backstage-plugin-react';
import { useResourceEnvironmentDetailPanelStyles } from '../ResourceEnvironments/styles';
import { useEndpointEnvironmentsContext } from './EndpointEnvironmentsContext';
import { TrafficSplitBar } from './TrafficSplitBar';

export interface EndpointTrafficDetailPaneProps {
  onClose: () => void;
}

/**
 * Right-pane body shown when the Traffic tile is selected. The Endpoint
 * counterpart of ResourceSetupDetailPane: shows the latest split and opens
 * the traffic editor.
 */
export const EndpointTrafficDetailPane = ({
  onClose,
}: EndpointTrafficDetailPaneProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();
  const { endpoint, onChangeTraffic } = useEndpointEnvironmentsContext();
  const { canChangeTraffic, loading, deniedTooltip } =
    useEndpointTrafficPermission();

  return (
    <Box className={classes.panel}>
      <Box className={classes.setupHeader}>
        <Box className={classes.headerTopRow}>
          <Box className={classes.headerNameRow}>
            <CallSplitIcon
              className={classes.headerKindIcon}
              fontSize="small"
              aria-hidden
            />
            <Typography className={classes.envName}>Traffic</Typography>
          </Box>
          <Box>
            <IconButton
              size="small"
              onClick={onClose}
              aria-label="Close detail panel"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </Box>

      <Box className={classes.setupBody}>
        <Box className={classes.section}>
          <Typography className={classes.sectionHeading}>
            Latest split
          </Typography>
          <TrafficSplitBar backends={endpoint.backends} showLegend />
          <Box className={classes.releaseNameRow}>
            <Typography variant="caption" className={classes.releaseNameLabel}>
              Release
            </Typography>
            <Typography variant="caption" className={classes.releaseName}>
              {endpoint.latestRelease ?? '(not cut yet)'}
            </Typography>
          </Box>
        </Box>

        <Typography variant="body2" color="textSecondary">
          Changing the split saves a new release. No environment's traffic moves
          until you roll it out.
        </Typography>

        <Box mt="auto" pt={2} display="flex" justifyContent="flex-end">
          <Tooltip title={deniedTooltip} disableHoverListener={!deniedTooltip}>
            <span>
              <Button
                variant="contained"
                color="primary"
                onClick={onChangeTraffic}
                disabled={loading || !canChangeTraffic}
              >
                Change traffic
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );
};
