import type { ReactNode } from 'react';
import { Box, Chip, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';
import {
  FormYamlToggle,
  type FormYamlMode,
} from '@openchoreo/backstage-design-system';

/**
 * Spacing and shapes of OpenChoreo's configure pages (Configure component,
 * environment overrides): one bordered card, a title row with the FORM |
 * YAML toggle, 24px padding, sections 32px apart with a heading and one
 * helper line.
 */
const useStyles = makeStyles(theme => ({
  card: {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    overflow: 'hidden',
  },
  titleRow: {
    minHeight: 48,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0, 1.5, 0, 2.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
  },
  spacer: { flex: 1 },
  body: {
    padding: theme.spacing(3),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(4),
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
  },
  heading: {
    fontSize: 15,
    fontWeight: 600,
  },
  helper: {
    marginTop: theme.spacing(0.5),
  },
  content: {
    marginTop: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
  pending: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    height: 32,
    padding: theme.spacing(0, 1.5),
    borderRadius: 16,
    backgroundColor: theme.palette.warning.light,
    color: theme.palette.warning.dark,
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  box: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    backgroundColor: theme.palette.background.default,
    padding: theme.spacing(2),
  },
}));

/** A configure card: title, an optional chip, the FORM | YAML toggle and the body. */
export const PdCard = ({
  title,
  chip,
  mode,
  onModeChange,
  children,
}: {
  title: string;
  chip?: string;
  mode?: FormYamlMode;
  onModeChange?: (mode: FormYamlMode) => void;
  children: ReactNode;
}) => {
  const classes = useStyles();
  return (
    <Box className={classes.card}>
      <Box className={classes.titleRow}>
        <Typography className={classes.title}>{title}</Typography>
        {chip && (
          <Chip size="small" variant="outlined" color="primary" label={chip} />
        )}
        <span className={classes.spacer} />
        {mode && onModeChange && (
          <FormYamlToggle value={mode} onChange={onModeChange} />
        )}
      </Box>
      <Box className={classes.body}>{children}</Box>
    </Box>
  );
};

/** One section of a configure card: a heading, one helper line, then content. */
export const PdSection = ({
  heading,
  helper,
  children,
}: {
  heading: string;
  helper?: ReactNode;
  children?: ReactNode;
}) => {
  const classes = useStyles();
  return (
    <Box className={classes.section} component="section" aria-label={heading}>
      <Typography className={classes.heading} component="h3">
        {heading}
      </Typography>
      {helper && (
        <Typography
          variant="body2"
          color="textSecondary"
          className={classes.helper}
        >
          {helper}
        </Typography>
      )}
      {children && <Box className={classes.content}>{children}</Box>}
    </Box>
  );
};

/** A change picked but not saved: "Unsaved: X → Y". */
export const PendingChip = ({ from, to }: { from: string; to: string }) => {
  const classes = useStyles();
  return (
    <span className={classes.pending} role="status">
      Unsaved: {from}
      <ArrowForwardIcon style={{ fontSize: 14 }} aria-hidden="true" />
      {to}
    </span>
  );
};

/** A bordered box inside a section, for a drawing or a placeholder. */
export const PdBox = ({ children }: { children: ReactNode }) => {
  const classes = useStyles();
  return <Box className={classes.box}>{children}</Box>;
};
