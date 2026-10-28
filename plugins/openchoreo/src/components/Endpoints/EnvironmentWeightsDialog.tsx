import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  TextField,
  Typography,
} from '@material-ui/core';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import {
  detectEndpointStrategy,
  rolloutStages,
  rolloutWeights,
  type EndpointBackendWeight,
  type EndpointEnvironment,
  type EndpointRollout,
  type EndpointWeightOverride,
} from '@openchoreo/backstage-plugin-common';
import { getErrorMessage } from '../../utils/errorUtils';
import { backendColor, sharePercents } from './endpointUi';
import { TrafficSplitBar } from './TrafficSplitBar';

const useStyles = makeStyles(theme => ({
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  sliderRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr) 90px',
    alignItems: 'center',
    gap: theme.spacing(2),
    [theme.breakpoints.down('xs')]: {
      gridTemplateColumns: 'minmax(0, 1fr) 90px',
      '& > :first-child': { gridColumn: '1 / -1' },
    },
  },
}));

const nameOf = (b: EndpointBackendWeight) => b.name ?? b.componentName;

/** A one-click weight setting, named for the strategy step it takes. */
export interface WeightPreset {
  label: string;
  /** Percent per backend name; backends not listed get 0. */
  weights: Record<string, number>;
}

/**
 * The steps that make sense for what the Endpoint is running: the running
 * rollout's stages (the stable backends keep their ratio), or else canary
 * steps and a rollback, an A/B ship, or nothing for a plain split. A mirror's
 * copy share has its own field, so it gets no weight presets.
 */
export function weightPresets(
  backends: EndpointBackendWeight[],
  rollout?: EndpointRollout,
): WeightPreset[] {
  if (rollout?.strategy === 'mirror') return [];
  if (rollout) {
    const names = backends.map(nameOf);
    return rolloutStages(rollout).map(stage => ({
      label: stage.action,
      weights: Object.fromEntries(
        rolloutWeights(rollout, names, stage.percent).map(w => [
          w.name,
          w.weight ?? 0,
        ]),
      ),
    }));
  }
  const strategy = detectEndpointStrategy(backends);
  const split = (
    a: string,
    b: string,
    pa: number,
  ): WeightPreset['weights'] => ({
    [a]: pa,
    [b]: 100 - pa,
  });
  switch (strategy.kind) {
    case 'canary':
      return [
        ...[5, 25, 50].map(p => ({
          label: `Canary ${p}%`,
          weights: split(strategy.canary, strategy.stable, p),
        })),
        {
          label: 'All traffic: 100%',
          weights: split(strategy.canary, strategy.stable, 100),
        },
        {
          label: 'Roll back: 0%',
          weights: split(strategy.canary, strategy.stable, 0),
        },
      ];
    case 'abTest':
      // The cookie decides the groups; weights cover everyone outside group
      // B. Sending them to the variant too ships the winner.
      return [
        {
          label: `Others on ${strategy.control}`,
          weights: split(strategy.control, strategy.variant, 100),
        },
        {
          label: `${strategy.variant} for everyone`,
          weights: split(strategy.variant, strategy.control, 100),
        },
      ];
    default:
      return [];
  }
}

export interface EnvironmentWeightsDialogProps {
  open: boolean;
  env: EndpointEnvironment | null;
  /**
   * The backends of the release this environment runs, in order (names and
   * colours, matches and mirrors).
   */
  backends: EndpointBackendWeight[];
  /** The running rollout, whose stages become the presets. */
  rollout?: EndpointRollout;
  onClose: () => void;
  /** Saves the environment's weights; an empty list clears them. */
  onSave: (
    environment: string,
    overrides: EndpointWeightOverride[],
  ) => Promise<{ applied: boolean }>;
}

/**
 * Moves one environment's traffic by setting weights, and mirror shares, on
 * its binding: no new release, and the change lands in seconds. This is how
 * a canary is stepped up or rolled back, how blue/green switches, and how
 * much a mirror copies.
 */
export const EnvironmentWeightsDialog = ({
  open,
  env,
  backends: allBackends,
  rollout,
  onClose,
  onSave,
}: EnvironmentWeightsDialogProps) => {
  // A mirror backend stays at weight 0; it only has a copy share.
  const backends = useMemo(
    () => allBackends.filter(b => !b.mirror),
    [allBackends],
  );
  const mirrors = useMemo(
    () => allBackends.filter(b => b.mirror),
    [allBackends],
  );
  const classes = useStyles();
  const theme = useTheme();
  const [percents, setPercents] = useState<number[]>([]);
  const [shares, setShares] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from what the environment serves now: its effective weights.
  const current = useMemo(() => {
    const live = new Map(
      (env?.backends ?? []).map(b => [b.name ?? b.componentName, b.weight]),
    );
    return backends.map(b => live.get(nameOf(b)) ?? 0);
  }, [env, backends]);

  useEffect(() => {
    if (open) {
      setPercents(sharePercents(current));
      const live = new Map(
        (env?.backends ?? []).map(b => [b.name ?? b.componentName, b.mirror]),
      );
      setShares(
        Object.fromEntries(
          mirrors.map(b => [
            nameOf(b),
            live.get(nameOf(b))?.percent ?? b.mirror!.percent,
          ]),
        ),
      );
      setError(null);
    }
  }, [open, current, env, mirrors]);

  const presets = useMemo(
    () => weightPresets(backends, rollout),
    [backends, rollout],
  );
  const total = percents.reduce((sum, p) => sum + p, 0);
  const two = backends.length === 2;

  const setPercent = (i: number, value: number) => {
    const v = Math.max(0, Math.min(100, Math.round(value) || 0));
    setPercents(prev =>
      two
        ? [i === 0 ? v : 100 - v, i === 1 ? v : 100 - v]
        : prev.map((p, j) => (j === i ? v : p)),
    );
  };

  const applyPreset = (preset: WeightPreset) =>
    setPercents(backends.map(b => preset.weights[nameOf(b)] ?? 0));

  const save = async (overrides: EndpointWeightOverride[]) => {
    if (!env) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(env.name, overrides);
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const draft = backends.map((b, i) => ({ ...b, weight: percents[i] ?? 0 }));
  const valid = total === 100;

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      maxWidth="sm"
      fullWidth
      aria-labelledby="environment-weights-title"
    >
      <DialogTitle id="environment-weights-title">
        Set traffic by hand in {env?.displayName ?? ''}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="textSecondary" paragraph>
          Moves this environment's traffic in seconds. Other environments keep
          their own split. Weights split the requests no backend's match takes;
          a match, such as a preview header, keeps working whatever the weights.
        </Typography>
        {error && (
          <Alert severity="error" style={{ marginBottom: 16 }}>
            {error}
          </Alert>
        )}
        {presets.length > 0 && (
          <Box className={classes.presets} aria-label="Presets">
            {presets.map(p => (
              <Button
                key={p.label}
                size="small"
                variant="outlined"
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </Button>
            ))}
          </Box>
        )}
        <Box display="flex" flexDirection="column" gridGap={12}>
          {backends.map((b, i) => {
            const id = `env-weight-${nameOf(b)}`;
            return (
              <Box key={id} className={classes.sliderRow}>
                <Typography variant="body2" component="label" htmlFor={id}>
                  <strong>{b.componentName}</strong>{' '}
                  <Typography
                    component="span"
                    variant="caption"
                    color="textSecondary"
                  >
                    /{b.endpoint}
                  </Typography>
                </Typography>
                <Slider
                  value={percents[i] ?? 0}
                  min={0}
                  max={100}
                  onChange={(_e, v) => setPercent(i, v as number)}
                  aria-label={`${b.componentName} percent`}
                  style={{ color: backendColor(theme, i) }}
                />
                <TextField
                  id={id}
                  type="number"
                  size="small"
                  variant="outlined"
                  value={percents[i] ?? 0}
                  onChange={e => setPercent(i, Number(e.target.value))}
                  inputProps={{ min: 0, max: 100, step: 1 }}
                  InputProps={{ endAdornment: '%' }}
                />
              </Box>
            );
          })}
        </Box>
        {mirrors.map(b => {
          const id = `env-mirror-${nameOf(b)}`;
          return (
            <Box
              key={id}
              mt={2}
              display="flex"
              alignItems="center"
              gridGap={16}
            >
              <Typography variant="body2" component="label" htmlFor={id}>
                <strong>{b.componentName}</strong> gets a copy of
              </Typography>
              <TextField
                id={id}
                type="number"
                size="small"
                variant="outlined"
                value={shares[nameOf(b)] ?? 0}
                onChange={e =>
                  setShares(prev => ({
                    ...prev,
                    [nameOf(b)]: Math.max(
                      0,
                      Math.min(100, Math.round(Number(e.target.value)) || 0),
                    ),
                  }))
                }
                inputProps={{ min: 0, max: 100, step: 1 }}
                InputProps={{ endAdornment: '%' }}
                style={{ width: 110 }}
              />
              <Typography variant="body2" color="textSecondary">
                of traffic
              </Typography>
            </Box>
          );
        })}
        <Box mt={2}>
          <TrafficSplitBar backends={draft} showLegend height={10} />
          <Typography
            variant="caption"
            color={valid ? 'textSecondary' : 'error'}
          >
            Total {total}%{valid ? '' : ' · the weights must add up to 100'}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        {(env?.overrides.length ?? 0) > 0 && (
          <Button
            onClick={() => void save([])}
            disabled={busy}
            style={{ marginRight: 'auto' }}
          >
            Reset to the Endpoint's weights
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={busy || !valid || !env?.bindingName}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={() =>
            void save([
              ...draft.map(b => ({ name: nameOf(b), weight: b.weight })),
              ...mirrors.map(b => ({
                name: nameOf(b),
                mirror: { percent: shares[nameOf(b)] ?? 0 },
              })),
            ])
          }
        >
          {busy ? 'Applying...' : 'Apply here'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
