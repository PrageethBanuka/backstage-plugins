import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import AddIcon from '@material-ui/icons/Add';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';

const CANARY_PRESETS = [
  [5, 25, 50, 100],
  [10, 100],
  [1, 10, 50, 100],
];

const useStyles = makeStyles(theme => ({
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  empty: {
    minHeight: 52,
    padding: theme.spacing(0, 1, 0, 2),
    border: `1px dashed ${theme.palette.divider}`,
    borderRadius: 8,
  },
  spacer: { flex: 1 },
  input: { width: 120 },
}));

/** Steps in increasing order, each a share from 1 to 100, always ending at 100. */
export function normalizeSteps(steps: number[]): number[] {
  const kept = steps.filter(s => Number.isInteger(s) && s > 0 && s < 100);
  return [...new Set(kept)].sort((a, b) => a - b).concat(100);
}

/**
 * A canary's or a mirror's steps as chips: remove one, add one, or start
 * from a preset. The last step is always 100%, and steps stay in increasing
 * order.
 */
export const StepsField = ({
  value,
  onChange,
  presets = CANARY_PRESETS,
}: {
  value: number[];
  onChange: (steps: number[]) => void;
  presets?: number[][];
}) => {
  const classes = useStyles();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The share input opens on "Add step", ready to type.
  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);
  const share = Number(draft);
  let problem = '';
  if (draft && (!Number.isInteger(share) || share < 1 || share > 99)) {
    problem = 'Enter a share from 1 to 99.';
  } else if (draft && value.includes(share)) {
    problem = `${share}% is already a step.`;
  }
  const close = () => {
    setAdding(false);
    setDraft('');
  };
  const add = () => {
    if (!draft || problem) return;
    onChange(normalizeSteps([...value, share]));
    close();
  };

  return (
    <Box display="flex" flexDirection="column" gridGap={8}>
      <Box
        className={`${classes.row} ${value.length === 0 ? classes.empty : ''}`}
      >
        {value.length === 0 && (
          <Typography variant="body2" color="textSecondary">
            No steps yet.
          </Typography>
        )}
        {value.map(step => (
          <Chip
            key={step}
            color="primary"
            variant="outlined"
            label={`${step}%`}
            onDelete={
              step === 100
                ? undefined
                : () => onChange(normalizeSteps(value.filter(s => s !== step)))
            }
          />
        ))}
        {adding ? (
          <>
            <TextField
              id="rollout-step-add"
              size="small"
              variant="outlined"
              inputRef={input}
              placeholder="Share"
              value={draft}
              error={Boolean(problem)}
              className={classes.input}
              onChange={e => setDraft(e.target.value.trim())}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  close();
                }
              }}
              InputProps={{ endAdornment: '%' }}
              inputProps={{ 'aria-label': 'New step (%)' }}
            />
            <Button
              color="primary"
              disabled={!draft || Boolean(problem)}
              onClick={add}
            >
              Add
            </Button>
            <Button onClick={close}>Cancel</Button>
          </>
        ) : (
          <Button
            variant="outlined"
            color="primary"
            startIcon={<AddIcon fontSize="small" />}
            onClick={() => setAdding(true)}
          >
            Add step
          </Button>
        )}
        <span className={classes.spacer} />
        <Button
          color="primary"
          aria-haspopup="menu"
          endIcon={<ArrowDropDownIcon />}
          onClick={e => setMenu(e.currentTarget)}
        >
          Presets
        </Button>
        <Menu
          anchorEl={menu}
          open={Boolean(menu)}
          onClose={() => setMenu(null)}
          getContentAnchorEl={null}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {presets.map(preset => (
            <MenuItem
              key={preset.join()}
              onClick={() => {
                onChange(preset);
                setMenu(null);
              }}
            >
              {preset.map(p => `${p}%`).join(' → ')}
            </MenuItem>
          ))}
        </Menu>
      </Box>
      {problem && (
        <Typography variant="caption" color="error">
          {problem}
        </Typography>
      )}
    </Box>
  );
};
