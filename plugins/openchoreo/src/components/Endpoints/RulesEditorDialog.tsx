import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import AddIcon from '@material-ui/icons/Add';
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward';
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward';
import DeleteOutlineIcon from '@material-ui/icons/DeleteOutline';
import {
  endpointRuleProblems,
  MAX_ENDPOINT_RULES,
  type EndpointBackendWeight,
  type EndpointMatch,
  type EndpointRule,
} from '@openchoreo/backstage-plugin-common';
import { getErrorMessage } from '../../utils/errorUtils';

const useStyles = makeStyles(theme => ({
  rule: {
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '160px minmax(0, 1fr) minmax(0, 1fr) 36px',
    gap: theme.spacing(1),
    alignItems: 'center',
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    },
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 120px 36px',
    gap: theme.spacing(1),
    alignItems: 'center',
  },
  match: {
    borderLeft: `3px solid ${theme.palette.divider}`,
    paddingLeft: theme.spacing(1.5),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
}));

/** One condition of a match, flattened for editing. */
interface Condition {
  kind: 'header' | 'headerRegex' | 'cookie' | 'query';
  name: string;
  value: string;
}

/** A rule as the editor holds it: matches as condition lists. */
interface DraftRule {
  name: string;
  /** Each entry is one match: all its conditions must hold. */
  matches: Condition[][];
  backends: { name: string; weight: number }[];
  mirrors: { backend: string; percent: number }[];
}

const toConditions = (m: EndpointMatch): Condition[] => [
  ...(m.headers ?? []).map(h => ({
    kind: (h.type === 'RegularExpression' ? 'headerRegex' : 'header') as
      | 'header'
      | 'headerRegex',
    name: h.name,
    value: h.value,
  })),
  ...(m.cookies ?? []).map(c => ({ kind: 'cookie' as const, ...c })),
  ...(m.queryParams ?? []).map(q => ({ kind: 'query' as const, ...q })),
];

const toMatch = (conditions: Condition[]): EndpointMatch => {
  const headers = conditions
    .filter(c => c.kind === 'header' || c.kind === 'headerRegex')
    .map(c => ({
      name: c.name,
      value: c.value,
      type: (c.kind === 'headerRegex' ? 'RegularExpression' : 'Exact') as
        | 'Exact'
        | 'RegularExpression',
    }));
  const cookies = conditions
    .filter(c => c.kind === 'cookie')
    .map(({ name, value }) => ({ name, value }));
  const queryParams = conditions
    .filter(c => c.kind === 'query')
    .map(({ name, value }) => ({ name, value }));
  return {
    ...(headers.length && { headers }),
    ...(cookies.length && { cookies }),
    ...(queryParams.length && { queryParams }),
  };
};

const toDraft = (r: EndpointRule): DraftRule => ({
  name: r.name,
  matches: (r.matches ?? []).map(toConditions),
  backends: r.backends.map(b => ({ name: b.name, weight: b.weight ?? 1 })),
  mirrors: (r.mirrors ?? []).map(m => ({ ...m })),
});

const fromDraft = (r: DraftRule): EndpointRule => ({
  name: r.name.trim(),
  ...(r.matches.length && { matches: r.matches.map(toMatch) }),
  backends: r.backends,
  ...(r.mirrors.length && { mirrors: r.mirrors }),
});

const CONDITION_LABELS: Record<Condition['kind'], string> = {
  header: 'Header is',
  headerRegex: 'Header matches',
  cookie: 'Cookie is',
  query: 'Query param is',
};

export interface RulesEditorDialogProps {
  open: boolean;
  endpointName: string;
  backends: EndpointBackendWeight[];
  rules: EndpointRule[];
  onClose: () => void;
  /** Saves the rules; resolves to the release the controller cut. */
  onSave: (
    rules: EndpointRule[],
  ) => Promise<{ latestRelease?: string; changed: boolean }>;
}

/**
 * Edits an Endpoint's routing rules: ordered, first match wins. A rule
 * matches on headers, a cookie or query parameters (all conditions of one
 * match must hold; separate matches are alternatives), sends to backends by
 * weight and can mirror a share of its requests. A rule without matches is
 * the catch-all and stays last. Saving cuts a new release.
 */
export const RulesEditorDialog = ({
  open,
  endpointName,
  backends,
  rules,
  onClose,
  onSave,
}: RulesEditorDialogProps) => {
  const classes = useStyles();
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backendNames = useMemo(
    () => backends.map(b => b.name ?? b.componentName),
    [backends],
  );

  useEffect(() => {
    if (open) {
      setDraft(rules.map(toDraft));
      setError(null);
    }
  }, [open, rules]);

  const problems = useMemo(
    () => endpointRuleProblems(draft.map(fromDraft), backendNames),
    [draft, backendNames],
  );

  const update = (i: number, next: Partial<DraftRule>) =>
    setDraft(prev => prev.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const move = (i: number, by: number) =>
    setDraft(prev => {
      const next = [...prev];
      const [r] = next.splice(i, 1);
      next.splice(i + by, 0, r);
      return next;
    });

  const addRule = () =>
    setDraft(prev => {
      const rule: DraftRule = {
        name: `rule-${prev.length + 1}`,
        matches: [[{ kind: 'header', name: '', value: '' }]],
        backends: [{ name: backendNames[backendNames.length - 1], weight: 1 }],
        mirrors: [],
      };
      // New rules go before a catch-all, which must stay last.
      const last = prev[prev.length - 1];
      return last && last.matches.length === 0
        ? [...prev.slice(0, -1), rule, last]
        : [...prev, rule];
    });

  const hasCatchAll =
    draft.length > 0 && draft[draft.length - 1].matches.length === 0;
  const addCatchAll = () =>
    setDraft(prev => [
      ...prev,
      {
        name: 'default',
        matches: [],
        backends: backends.map(b => ({
          name: b.name ?? b.componentName,
          weight: b.weight,
        })),
        mirrors: [],
      },
    ]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft.map(fromDraft));
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      maxWidth="md"
      fullWidth
      aria-labelledby="rules-editor-title"
    >
      <DialogTitle id="rules-editor-title">
        Routing rules · {endpointName}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="textSecondary" paragraph>
          Rules are checked in order and the first match wins. Requests no rule
          matches follow{' '}
          {hasCatchAll ? 'the catch-all rule' : "the backends' weights"}. The
          same rules apply to gateway and in-cluster callers. Saving cuts a new
          release; roll it out to move an environment.
        </Typography>
        {error && (
          <Alert severity="error" style={{ marginBottom: 16 }}>
            {error}
          </Alert>
        )}

        <Box display="flex" flexDirection="column" gridGap={16}>
          {draft.map((rule, i) => {
            const catchAll = rule.matches.length === 0;
            return (
              <Paper key={i} variant="outlined" className={classes.rule}>
                <Box display="flex" alignItems="center" gridGap={8}>
                  <TextField
                    label="Rule name"
                    size="small"
                    variant="outlined"
                    value={rule.name}
                    onChange={e => update(i, { name: e.target.value })}
                  />
                  <Typography variant="caption" color="textSecondary">
                    {catchAll
                      ? 'Catch-all: every other request'
                      : `Rule ${i + 1}`}
                  </Typography>
                  <Box flex={1} />
                  <IconButton
                    size="small"
                    aria-label={`Move ${rule.name} up`}
                    disabled={i === 0 || catchAll}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={`Move ${rule.name} down`}
                    disabled={
                      catchAll ||
                      i === draft.length - 1 ||
                      (i === draft.length - 2 && hasCatchAll)
                    }
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={`Delete ${rule.name}`}
                    onClick={() =>
                      setDraft(prev => prev.filter((_, j) => j !== i))
                    }
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>

                {!catchAll && (
                  <>
                    <Typography variant="subtitle2">When</Typography>
                    {rule.matches.map((conditions, mi) => (
                      <Box key={mi} className={classes.match}>
                        {mi > 0 && (
                          <Typography variant="caption" color="textSecondary">
                            or
                          </Typography>
                        )}
                        {conditions.map((c, ci) => {
                          const setCondition = (next: Partial<Condition>) =>
                            update(i, {
                              matches: rule.matches.map((m, x) =>
                                x === mi
                                  ? m.map((y, z) =>
                                      z === ci ? { ...y, ...next } : y,
                                    )
                                  : m,
                              ),
                            });
                          return (
                            <Box key={ci} className={classes.row}>
                              <TextField
                                select
                                size="small"
                                variant="outlined"
                                value={c.kind}
                                onChange={e =>
                                  setCondition({
                                    kind: e.target.value as Condition['kind'],
                                  })
                                }
                                inputProps={{ 'aria-label': 'Condition' }}
                              >
                                {Object.entries(CONDITION_LABELS).map(
                                  ([k, label]) => (
                                    <MenuItem key={k} value={k}>
                                      {label}
                                    </MenuItem>
                                  ),
                                )}
                              </TextField>
                              <TextField
                                size="small"
                                variant="outlined"
                                label="Name"
                                value={c.name}
                                onChange={e =>
                                  setCondition({ name: e.target.value })
                                }
                              />
                              <TextField
                                size="small"
                                variant="outlined"
                                label={
                                  c.kind === 'headerRegex' ? 'Pattern' : 'Value'
                                }
                                value={c.value}
                                onChange={e =>
                                  setCondition({ value: e.target.value })
                                }
                              />
                              <IconButton
                                size="small"
                                aria-label="Remove condition"
                                onClick={() =>
                                  update(i, {
                                    matches: rule.matches
                                      .map((m, x) =>
                                        x === mi
                                          ? m.filter((_, z) => z !== ci)
                                          : m,
                                      )
                                      .filter(m => m.length > 0),
                                  })
                                }
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          );
                        })}
                        <Box>
                          <Button
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={() =>
                              update(i, {
                                matches: rule.matches.map((m, x) =>
                                  x === mi
                                    ? [
                                        ...m,
                                        { kind: 'header', name: '', value: '' },
                                      ]
                                    : m,
                                ),
                              })
                            }
                          >
                            and
                          </Button>
                        </Box>
                      </Box>
                    ))}
                    <Box>
                      <Button
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() =>
                          update(i, {
                            matches: [
                              ...rule.matches,
                              [{ kind: 'header', name: '', value: '' }],
                            ],
                          })
                        }
                      >
                        or another match
                      </Button>
                    </Box>
                  </>
                )}

                <Typography variant="subtitle2">Send to</Typography>
                {rule.backends.map((b, bi) => (
                  <Box key={bi} className={classes.pair}>
                    <TextField
                      select
                      size="small"
                      variant="outlined"
                      value={b.name}
                      onChange={e =>
                        update(i, {
                          backends: rule.backends.map((x, y) =>
                            y === bi ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                      inputProps={{ 'aria-label': 'Backend' }}
                    >
                      {backendNames.map(n => (
                        <MenuItem key={n} value={n}>
                          {n}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      type="number"
                      size="small"
                      variant="outlined"
                      label="Weight"
                      value={b.weight}
                      onChange={e =>
                        update(i, {
                          backends: rule.backends.map((x, y) =>
                            y === bi
                              ? {
                                  ...x,
                                  weight: Math.max(
                                    0,
                                    Number(e.target.value) || 0,
                                  ),
                                }
                              : x,
                          ),
                        })
                      }
                      inputProps={{ min: 0, step: 1 }}
                    />
                    <IconButton
                      size="small"
                      aria-label="Remove backend"
                      disabled={rule.backends.length <= 1}
                      onClick={() =>
                        update(i, {
                          backends: rule.backends.filter((_, y) => y !== bi),
                        })
                      }
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
                <Box display="flex" gridGap={8}>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() =>
                      update(i, {
                        backends: [
                          ...rule.backends,
                          { name: backendNames[0], weight: 1 },
                        ],
                      })
                    }
                  >
                    Split with another backend
                  </Button>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() =>
                      update(i, {
                        mirrors: [
                          ...rule.mirrors,
                          {
                            backend: backendNames[backendNames.length - 1],
                            percent: 10,
                          },
                        ],
                      })
                    }
                  >
                    Mirror to a backend
                  </Button>
                </Box>
                {rule.mirrors.map((m, mi) => (
                  <Box key={mi} className={classes.pair}>
                    <TextField
                      select
                      size="small"
                      variant="outlined"
                      label="Mirror to"
                      value={m.backend}
                      onChange={e =>
                        update(i, {
                          mirrors: rule.mirrors.map((x, y) =>
                            y === mi ? { ...x, backend: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      {backendNames.map(n => (
                        <MenuItem key={n} value={n}>
                          {n}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      type="number"
                      size="small"
                      variant="outlined"
                      label="Percent"
                      value={m.percent}
                      onChange={e =>
                        update(i, {
                          mirrors: rule.mirrors.map((x, y) =>
                            y === mi
                              ? { ...x, percent: Number(e.target.value) || 0 }
                              : x,
                          ),
                        })
                      }
                      inputProps={{ min: 1, max: 100, step: 1 }}
                      InputProps={{ endAdornment: '%' }}
                    />
                    <IconButton
                      size="small"
                      aria-label="Remove mirror"
                      onClick={() =>
                        update(i, {
                          mirrors: rule.mirrors.filter((_, y) => y !== mi),
                        })
                      }
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Paper>
            );
          })}
        </Box>

        <Box display="flex" gridGap={8} mt={2}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={draft.length >= MAX_ENDPOINT_RULES}
            onClick={addRule}
          >
            Add rule
          </Button>
          {!hasCatchAll && (
            <Tooltip title="A catch-all decides where requests no rule matches go, with its own weights and mirrors">
              <span>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  disabled={draft.length >= MAX_ENDPOINT_RULES}
                  onClick={addCatchAll}
                >
                  Add catch-all
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>

        {problems.length > 0 && (
          <Alert severity="warning" style={{ marginTop: 16 }}>
            {problems.map(p => (
              <div key={p}>{p}</div>
            ))}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={busy || problems.length > 0}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={() => void save()}
        >
          {busy ? 'Saving...' : 'Save rules'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
