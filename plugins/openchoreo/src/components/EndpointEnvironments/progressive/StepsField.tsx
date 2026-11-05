import { useState } from 'react';
import { Box, Button, Chip, TextField, Typography } from '@material-ui/core';

const CANARY_PRESETS = [
  [5, 25, 50, 100],
  [10, 100],
  [1, 10, 50, 100],
];

/** Steps in increasing order, each a share from 1 to 100, always ending at 100. */
export function normalizeSteps(steps: number[]): number[] {
  const kept = steps.filter(s => Number.isInteger(s) && s > 0 && s < 100);
  return [...new Set(kept)].sort((a, b) => a - b).concat(100);
}

/**
 * A canary's or a mirror's steps as chips: remove one, add one, or pick a
 * preset. The last step is always 100%, and steps stay in increasing order.
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
  const [draft, setDraft] = useState('');
  const share = Number(draft);
  let problem = '';
  if (draft && (!Number.isInteger(share) || share < 1 || share > 99)) {
    problem = 'Enter a share from 1 to 99.';
  } else if (draft && value.includes(share)) {
    problem = `${share}% is already a step.`;
  }
  const add = () => {
    if (!draft || problem) return;
    onChange(normalizeSteps([...value, share]));
    setDraft('');
  };

  return (
    <Box display="flex" flexDirection="column" gridGap={8}>
      <Box display="flex" flexWrap="wrap" alignItems="center" gridGap={6}>
        {value.map(step => (
          <Chip
            key={step}
            size="small"
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
        <TextField
          id="rollout-step-add"
          size="small"
          variant="outlined"
          placeholder="Share"
          value={draft}
          error={Boolean(problem)}
          onChange={e => setDraft(e.target.value.trim())}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          inputProps={{ 'aria-label': 'New step (%)', style: { width: 56 } }}
        />
        <Button
          size="small"
          color="primary"
          disabled={!draft || Boolean(problem)}
          onClick={add}
        >
          Add step
        </Button>
      </Box>
      {problem && (
        <Typography variant="caption" color="error">
          {problem}
        </Typography>
      )}
      <Box display="flex" flexWrap="wrap" alignItems="center" gridGap={6}>
        <Typography variant="caption" color="textSecondary">
          Presets
        </Typography>
        {presets.map(preset => (
          <Chip
            key={preset.join()}
            size="small"
            variant="outlined"
            clickable
            label={preset.join(' → ')}
            onClick={() => onChange(preset)}
          />
        ))}
      </Box>
    </Box>
  );
};
