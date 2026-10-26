import type { ReactNode } from 'react';
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
} from '@material-ui/core';
import SettingsOutlinedIcon from '@material-ui/icons/SettingsOutlined';
import CloseIcon from '@material-ui/icons/Close';
import { useResourceEnvironmentDetailPanelStyles } from '../ResourceEnvironments/styles';

export interface EndpointSetupPaneProps {
  title: string;
  /** The pane's body; a string renders as secondary text. */
  children: ReactNode;
  /** The primary button at the bottom; omitted for a read-only pane. */
  action?: {
    label: string;
    onClick: () => void;
    /** Why the button is disabled; empty when it is enabled. */
    disabledReason?: string;
  };
  onClose: () => void;
}

/**
 * Right pane for the leading tile, laid out like the Resource Set up pane
 * (ResourceSetupDetailPane): a title, a short body and one primary button.
 */
export const EndpointSetupPane = ({
  title,
  children,
  action,
  onClose,
}: EndpointSetupPaneProps) => {
  const classes = useResourceEnvironmentDetailPanelStyles();

  return (
    <Box className={classes.panel}>
      <Box className={classes.setupHeader}>
        <Box className={classes.headerTopRow}>
          <Box className={classes.headerNameRow}>
            <SettingsOutlinedIcon
              className={classes.headerKindIcon}
              fontSize="small"
              aria-hidden
            />
            <Typography className={classes.envName}>{title}</Typography>
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
        {typeof children === 'string' ? (
          <Typography variant="body2" color="textSecondary">
            {children}
          </Typography>
        ) : (
          children
        )}

        {action && (
          <Box mt="auto" pt={2} display="flex" justifyContent="flex-end">
            <Tooltip
              title={action.disabledReason ?? ''}
              disableHoverListener={!action.disabledReason}
            >
              <span>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={Boolean(action.disabledReason)}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              </span>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
};
