import type { ReactNode } from 'react';
import { Box, Typography } from '@material-ui/core';
import SettingsOutlinedIcon from '@material-ui/icons/SettingsOutlined';
import clsx from 'clsx';
import { useResourceSetupCardCompactStyles } from '../ResourceEnvironments/styles';

interface EndpointSetupCardProps {
  selected: boolean;
  title: string;
  hint: string;
  /** Rendered at the end of the title row, e.g. a ⋮ menu button. */
  action?: ReactNode;
}

/**
 * Leading tile on the Endpoint pipeline canvas: the Resource `Set up` tile
 * (ResourceSetupCard) with the Endpoint's own title, and what is rolling out
 * while a rollout runs.
 */
export const EndpointSetupCard = ({
  selected,
  title,
  hint,
  action,
}: EndpointSetupCardProps) => {
  const classes = useResourceSetupCardCompactStyles();
  return (
    <Box
      className={clsx(classes.setupCard, {
        [classes.cardSelected]: selected,
      })}
    >
      <Box className={classes.titleRow}>
        <SettingsOutlinedIcon className={classes.titleIcon} />
        <Typography className={classes.title}>{title}</Typography>
        {action && <Box ml="auto">{action}</Box>}
      </Box>
      <Typography className={classes.hint}>{hint}</Typography>
    </Box>
  );
};
