import { makeStyles } from '@material-ui/core/styles';
import { roleColor, type RolloutRole } from './endpointUi';

const useStyles = makeStyles(theme => ({
  tag: {
    padding: theme.spacing(0, 0.75),
    border: '1px solid',
    borderRadius: 10,
    fontSize: 11,
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
}));

/** "Current" or "New" in its role colour, next to a backend's name. */
export const RoleTag = ({ role }: { role: RolloutRole }) => {
  const classes = useStyles();
  return (
    <span className={classes.tag} style={{ color: roleColor(role) }}>
      {role}
    </span>
  );
};
