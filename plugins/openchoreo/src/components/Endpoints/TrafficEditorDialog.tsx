import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  DialogContent,
  DialogTitle,
  Slider,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@material-ui/core';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import RemoveCircleOutlineIcon from '@material-ui/icons/RemoveCircleOutline';
import { StatusBadge } from '@openchoreo/backstage-design-system';
import {
  formatRelativeTime,
  useEndpointRolloutPermission,
} from '@openchoreo/backstage-plugin-react';
import type {
  EndpointBackendWeight,
  EndpointEnvironment,
  EndpointReleaseSummary,
} from '@openchoreo/backstage-plugin-common';
import { getErrorMessage } from '../../utils/errorUtils';
import {
  backendColor,
  backendKey,
  missingBackends,
  sharePercents,
} from './endpointUi';
import { TrafficSplitBar } from './TrafficSplitBar';

const useStyles = makeStyles(theme => ({
  stepper: {
    padding: theme.spacing(0, 0, 2, 0),
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  },
  sliderRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr) 80px 36px',
    alignItems: 'center',
    gap: theme.spacing(2),
    [theme.breakpoints.down('xs')]: {
      gridTemplateColumns: 'minmax(0, 1fr) 80px',
      '& > :first-child': { gridColumn: '1 / -1' },
    },
  },
  compare: {
    display: 'grid',
    gridTemplateColumns: '64px minmax(0, 1fr)',
    alignItems: 'center',
    gap: theme.spacing(1, 2),
    marginTop: theme.spacing(2),
  },
  total: {
    fontVariantNumeric: 'tabular-nums',
  },
  addRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
    padding: theme.spacing(1.5),
    border: `1px dashed ${theme.palette.primary.main}`,
    borderRadius: 8,
    [theme.breakpoints.down('xs')]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
}));

const PRESETS: { label: string; split: [number, number] }[] = [
  { label: '100 / 0', split: [100, 0] },
  { label: '90 / 10 canary', split: [90, 10] },
  { label: '75 / 25', split: [75, 25] },
  { label: '50 / 50', split: [50, 50] },
  { label: '0 / 100 cut over', split: [0, 100] },
];

export interface TrafficEditorDialogProps {
  open: boolean;
  endpointName: string;
  /** The Endpoint's current backends and weights (latest release). */
  backends: EndpointBackendWeight[];
  environments: EndpointEnvironment[];
  releases: EndpointReleaseSummary[];
  /**
   * Components of the Endpoint's project that can be added as a backend.
   * A canary adds the new version here, at 0%, to the same Endpoint.
   */
  componentOptions?: string[];
  onClose: () => void;
  /**
   * Saves the full set of backends and weights (added and removed backends
   * included); resolves to the release the controller cut.
   */
  onSave: (
    backends: EndpointBackendWeight[],
  ) => Promise<{ latestRelease?: string; changed: boolean }>;
  /** Pins each environment to the release. */
  onRollOut: (environments: string[], releaseName: string) => Promise<void>;
}

/** Converts weights to percentages the sliders edit (always summing to 100). */
const toPercents = (backends: EndpointBackendWeight[]) =>
  sharePercents(backends.map(b => b.weight));

/**
 * Two-step traffic change, following how the controller works. Step 1 saves
 * the split as a new release without moving traffic; step 2 rolls that
 * release out to the environments the user picks, each checked first for
 * the permission and for every weighted backend being deployed there.
 */
export const TrafficEditorDialog = ({
  open,
  endpointName,
  backends,
  environments,
  releases,
  componentOptions = [],
  onClose,
  onSave,
  onRollOut,
}: TrafficEditorDialogProps) => {
  const classes = useStyles();
  const theme = useTheme();
  const [step, setStep] = useState<0 | 1>(0);
  // The backends being edited: the saved ones plus any added in this dialog.
  const [rows, setRows] = useState<EndpointBackendWeight[]>(backends);
  const [percents, setPercents] = useState<number[]>(() =>
    toPercents(backends),
  );
  const [newComponent, setNewComponent] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('http');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedRelease, setSavedRelease] = useState<string | undefined>();
  // True when the saved split matched a release that already existed.
  const [reusedRelease, setReusedRelease] = useState<{
    name: string;
    createdAt?: string;
  } | null>(null);
  const [selectedEnvs, setSelectedEnvs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setRows(backends);
    setPercents(toPercents(backends));
    setNewComponent('');
    setNewEndpoint('http');
    setBusy(false);
    setError(null);
    setSavedRelease(undefined);
    setReusedRelease(null);
    setSelectedEnvs(new Set());
  }, [open, backends]);

  const current = useMemo(() => toPercents(backends), [backends]);
  const total = percents.reduce((sum, p) => sum + p, 0);
  const unchanged =
    rows.length === backends.length &&
    rows.every((r, i) => backendKey(r) === backendKey(backends[i])) &&
    percents.every((p, i) => p === current[i]);
  const draft: EndpointBackendWeight[] = rows.map((b, i) => ({
    ...b,
    weight: percents[i] ?? 0,
  }));
  const savedWeight = new Map(backends.map(b => [backendKey(b), b.weight]));
  // A backend can be removed once it has no traffic in the saved split, so
  // removing it never moves traffic by itself. Added rows can always go.
  const canRemove = (b: EndpointBackendWeight) =>
    rows.length > 1 && (savedWeight.get(backendKey(b)) ?? 0) === 0;
  const newKey = backendKey({
    componentName: newComponent,
    endpoint: newEndpoint.trim(),
  });
  const canAdd =
    newComponent !== '' &&
    newEndpoint.trim() !== '' &&
    !rows.some(r => backendKey(r) === newKey);

  const addBackend = () => {
    if (!canAdd) return;
    setRows(prev => [
      ...prev,
      { componentName: newComponent, endpoint: newEndpoint.trim(), weight: 0 },
    ]);
    setPercents(prev => [...prev, 0]);
    setNewComponent('');
    setNewEndpoint('http');
  };

  const removeBackend = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index));
    setPercents(prev => prev.filter((_, i) => i !== index));
  };

  // With two backends, moving one adjusts the other so the total stays 100.
  const setPercent = (index: number, raw: number) => {
    const value = Math.max(0, Math.min(100, Math.round(raw || 0)));
    setPercents(prev => {
      const next = [...prev];
      next[index] = value;
      if (next.length === 2) next[1 - index] = 100 - value;
      return next;
    });
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      // Releases are named by their split, so saving a split that already
      // exists gives back that release instead of cutting a new one.
      const knownBefore = new Map(releases.map(r => [r.name, r]));
      const res = await onSave(draft);
      if (!res.latestRelease) {
        setError(
          'The split was saved, but the new release is not ready yet. Roll it out from an environment once it appears.',
        );
        return;
      }
      setSavedRelease(res.latestRelease);
      const existing = knownBefore.get(res.latestRelease);
      setReusedRelease(
        existing
          ? { name: existing.name, createdAt: existing.createdAt }
          : null,
      );
      const firstEnv = environments.find(
        e => missingBackends(e, draft).length === 0 && !e.isProduction,
      );
      setSelectedEnvs(new Set(firstEnv ? [firstEnv.name] : []));
      setStep(1);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRollOut = async () => {
    if (!savedRelease) return;
    setBusy(true);
    setError(null);
    try {
      await onRollOut([...selectedEnvs], savedRelease);
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnv = (name: string, checked: boolean) =>
    setSelectedEnvs(prev => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });

  const twoBackends = rows.length === 2;
  let totalHint = '';
  if (twoBackends) totalHint = ' · moving one slider adjusts the other';
  else if (total !== 100) totalHint = ' · the weights must add up to 100';

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      maxWidth="md"
      fullWidth
      aria-labelledby="traffic-editor-dialog-title"
    >
      <DialogTitle id="traffic-editor-dialog-title">
        Change traffic · {endpointName}
      </DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} alternativeLabel className={classes.stepper}>
          <Step>
            <StepLabel>Set the split</StepLabel>
          </Step>
          <Step>
            <StepLabel>Roll out</StepLabel>
          </Step>
        </Stepper>

        {error && (
          <Alert severity="error" style={{ marginBottom: 16 }}>
            {error}
          </Alert>
        )}

        {step === 0 ? (
          <>
            {twoBackends && (
              <Box className={classes.presets} aria-label="Presets">
                {PRESETS.map(p => (
                  <Button
                    key={p.label}
                    size="small"
                    variant="outlined"
                    onClick={() => setPercents([...p.split])}
                  >
                    {p.label}
                  </Button>
                ))}
              </Box>
            )}

            <Box display="flex" flexDirection="column" gridGap={12}>
              {rows.map((b, i) => {
                const id = `traffic-weight-${b.componentName}-${b.endpoint}`;
                const color = backendColor(theme, i);
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
                      style={{ color }}
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
                    {canRemove(b) ? (
                      <IconButton
                        size="small"
                        onClick={() => removeBackend(i)}
                        aria-label={`Remove ${b.componentName}`}
                      >
                        <RemoveCircleOutlineIcon fontSize="small" />
                      </IconButton>
                    ) : (
                      <span />
                    )}
                  </Box>
                );
              })}
            </Box>

            <Box className={classes.addRow}>
              <FormControl variant="outlined" size="small" fullWidth>
                <InputLabel id="add-backend-component-label">
                  Add backend
                </InputLabel>
                <Select
                  labelId="add-backend-component-label"
                  label="Add backend"
                  value={newComponent}
                  onChange={e => setNewComponent(e.target.value as string)}
                  inputProps={{ 'aria-label': 'Component to add' }}
                >
                  {componentOptions.length === 0 && (
                    <MenuItem value="" disabled>
                      No other components in this project
                    </MenuItem>
                  )}
                  {componentOptions.map(name => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Workload endpoint"
                size="small"
                variant="outlined"
                value={newEndpoint}
                onChange={e => setNewEndpoint(e.target.value)}
              />
              <Button
                variant="outlined"
                color="primary"
                onClick={addBackend}
                disabled={!canAdd}
              >
                Add at 0%
              </Button>
            </Box>

            <Box mt={1}>
              <Typography
                variant="caption"
                className={classes.total}
                color={total === 100 ? 'textSecondary' : 'error'}
              >
                Total {total}%{totalHint}
              </Typography>
            </Box>
            {draft.some(b => b.weight === 0) && (
              <Typography variant="caption" color="textSecondary" component="p">
                A backend at 0% is staged: it receives no traffic and does not
                need to be deployed.
              </Typography>
            )}

            <Box className={classes.compare}>
              <Typography variant="caption" color="textSecondary">
                Current
              </Typography>
              <TrafficSplitBar backends={backends} height={10} />
              <Typography variant="caption">
                <strong>New</strong>
              </Typography>
              <TrafficSplitBar backends={draft} height={10} showLegend />
            </Box>

            <Alert severity="info" style={{ marginTop: 16 }}>
              Saving creates a new release. No environment changes until you
              roll it out in step 2.
            </Alert>
          </>
        ) : (
          <>
            {reusedRelease ? (
              <Alert severity="info" style={{ marginBottom: 16 }}>
                These weights match release{' '}
                <strong>{reusedRelease.name}</strong>
                {reusedRelease.createdAt
                  ? `, created ${formatRelativeTime(reusedRelease.createdAt)}`
                  : ''}
                , so that release is reused. Nothing new was created.
              </Alert>
            ) : (
              <Typography variant="body2" color="textSecondary" paragraph>
                Release <strong>{savedRelease}</strong> is saved.
              </Typography>
            )}
            <Typography variant="body2" color="textSecondary" paragraph>
              Choose where to roll it out; you can also do this later from each
              environment.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Environment</TableCell>
                  <TableCell>Now serving</TableCell>
                  <TableCell>Pre-check</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {environments.map(env => (
                  <RolloutRow
                    key={env.name}
                    env={env}
                    draft={draft}
                    releases={releases}
                    checked={selectedEnvs.has(env.name)}
                    onToggle={checked => toggleEnv(env.name, checked)}
                  />
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </DialogContent>
      <DialogActions>
        {step === 0 ? (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              color="primary"
              variant="contained"
              onClick={handleSave}
              disabled={busy || total !== 100 || unchanged}
              startIcon={busy ? <CircularProgress size={16} /> : undefined}
            >
              Save as new release
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Later
            </Button>
            <Button
              color="primary"
              variant="contained"
              onClick={handleRollOut}
              disabled={busy || selectedEnvs.size === 0}
              startIcon={busy ? <CircularProgress size={16} /> : undefined}
            >
              Roll out to {selectedEnvs.size}{' '}
              {selectedEnvs.size === 1 ? 'environment' : 'environments'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

interface RolloutRowProps {
  env: EndpointEnvironment;
  draft: EndpointBackendWeight[];
  releases: EndpointReleaseSummary[];
  checked: boolean;
  onToggle: (checked: boolean) => void;
}

/** One environment in step 2, checked for permission and deployed backends. */
function RolloutRow({
  env,
  draft,
  releases,
  checked,
  onToggle,
}: RolloutRowProps) {
  const perm = useEndpointRolloutPermission(env.name, Boolean(env.bindingName));
  const missing = missingBackends(env, draft);
  const serving = releases.find(
    r => r.name === (env.servingRelease ?? env.endpointRelease),
  );
  let blockedReason = '';
  if (!perm.loading && !perm.canRollOut) {
    blockedReason = perm.rollOutDeniedTooltip;
  } else if (missing.length > 0) {
    blockedReason = `${missing.join(', ')} not deployed`;
  }
  const blocked = perm.loading || blockedReason !== '';

  useEffect(() => {
    if (blocked && checked) onToggle(false);
  }, [blocked, checked, onToggle]);

  return (
    <TableRow>
      <TableCell padding="checkbox">
        <Checkbox
          checked={checked}
          disabled={blocked}
          onChange={e => onToggle(e.target.checked)}
          inputProps={{ 'aria-label': env.displayName }}
        />
      </TableCell>
      <TableCell>{env.displayName}</TableCell>
      <TableCell>
        {serving ? (
          <Box minWidth={120}>
            <TrafficSplitBar backends={serving.backends} height={6} />
          </Box>
        ) : (
          <Typography variant="caption" color="textSecondary">
            Not routed
          </Typography>
        )}
      </TableCell>
      <TableCell>
        {perm.loading ? (
          <CircularProgress size={14} />
        ) : (
          <StatusBadge
            status={blockedReason ? 'error' : 'success'}
            label={blockedReason || 'All backends deployed'}
          />
        )}
      </TableCell>
    </TableRow>
  );
}
