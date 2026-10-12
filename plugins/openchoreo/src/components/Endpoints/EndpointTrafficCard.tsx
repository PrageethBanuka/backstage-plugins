import { Box, Typography } from '@material-ui/core';
import CallSplitIcon from '@material-ui/icons/CallSplit';
import clsx from 'clsx';
import { useResourceSetupCardCompactStyles } from '../ResourceEnvironments/styles';
import { useEndpointEnvironmentsContext } from './EndpointEnvironmentsContext';
import { TrafficSplitBar } from './TrafficSplitBar';

interface EndpointTrafficCardProps {
  selected: boolean;
}

/**
 * Leading tile on the Endpoint pipeline canvas, in the place of the
 * Resource `Set up` tile (ResourceSetupCard). Shows the Endpoint's latest
 * split; selecting it opens EndpointTrafficDetailPane, where the split is
 * changed. The tile itself stays passive so the canvas remains action-free.
 */
export const EndpointTrafficCard = ({ selected }: EndpointTrafficCardProps) => {
  const classes = useResourceSetupCardCompactStyles();
  const { endpoint } = useEndpointEnvironmentsContext();
  return (
    <Box
      className={clsx(classes.setupCard, {
        [classes.cardSelected]: selected,
      })}
    >
      <Box className={classes.titleRow}>
        <CallSplitIcon className={classes.titleIcon} />
        <Typography className={classes.title}>Traffic</Typography>
      </Box>
      <Box mt={0.5} width="100%">
        <TrafficSplitBar backends={endpoint.backends} height={6} />
      </Box>
    </Box>
  );
};
