import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  FormControlLabel,
  Link,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { alpha, makeStyles, useTheme } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import CallSplitIcon from '@material-ui/icons/CallSplit';
import SwapHorizIcon from '@material-ui/icons/SwapHoriz';
import GroupWorkIcon from '@material-ui/icons/GroupWork';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { useAsyncEntity, useEntity } from '@backstage/plugin-catalog-react';
import { Skeleton } from '@openchoreo/backstage-design-system';
import {
  DetailPageLayout,
  ForbiddenState,
} from '@openchoreo/backstage-plugin-react';
import {
  abAudience,
  backendMatchProblems,
  CHOREO_ANNOTATIONS,
  convertToCanary,
  isSameBackend,
  uniqueBackendName,
  planRollout,
  strategyUnsupported,
  type EndpointBackendWeight,
  type RolloutPlan,
  type RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';
import type { EndpointSummary } from './pdTypes';
import { envResourceName } from '../endpointEnvironmentUtils';
import { StrategyFlow, toFlowVersion } from './StrategyFlow';
import { normalizeSteps } from './StepsField';
import {
  defaultRolloutOptions,
  RolloutOptionsFields,
  SectionLabel,
  rolloutOptionsPlan,
  rolloutOptionsProblem,
  withStrategyDefaults,
  type RolloutOptions,
  type RolloutTypeSupport,
} from './RolloutOptionsFields';
import { useProjectWorkloadEndpoints } from '../../../scaffolder/EndpointBackendsField/useProjectWorkloadEndpoints';
import { openChoreoClientApiRef } from '../../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../../utils/errorUtils';
import { backendColor } from './endpointUi';
import { audienceText, STRATEGY_COPY } from './endpointRolloutUi';

const useStyles = makeStyles(theme => ({
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    padding: theme.spacing(4),
  },
  formCard: {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 12,
    padding: theme.spacing(3),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },
  label: { fontWeight: 600 },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 360px',
    gap: theme.spacing(3),
    alignItems: 'start',
    [theme.breakpoints.down('sm')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  preview: {
    fontFamily: 'monospace',
    fontSize: 12,
    whiteSpace: 'pre',
    overflowX: 'auto',
    margin: 0,
    padding: theme.spacing(1.5),
    borderRadius: 8,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.default,
  },
  summary: {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 12,
    padding: theme.spacing(3),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    position: 'sticky',
    top: theme.spacing(2),
  },
  flowBox: {
    borderRadius: 8,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.default,
    padding: theme.spacing(2),
    minHeight: 120,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: theme.spacing(1.5),
    [theme.breakpoints.down('md')]: {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  card: {
    textAlign: 'left',
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    background: 'none',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    color: theme.palette.text.primary,
    font: 'inherit',
    '&:hover': { borderColor: theme.palette.primary.main },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
    '&:disabled': {
      cursor: 'not-allowed',
      opacity: 0.6,
      borderColor: theme.palette.divider,
    },
  },
  selected: {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: theme.spacing(2),
    maxWidth: 640,
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
}));

const ICONS: Record<RolloutStrategy, JSX.Element> = {
  canary: <CallSplitIcon color="primary" />,
  blueGreen: <SwapHorizIcon color="primary" />,
  abTest: <GroupWorkIcon color="primary" />,
  mirror: <FileCopyOutlinedIcon color="primary" />,
};

/** What Save sets up, in a few labelled lines. */
function planSummary(
  plan: RolloutPlan,
  deploysTo: string | undefined,
): { label: string; value: string }[] {
  const c = plan.candidate;
  const name =
    c.name ??
    (c.releaseLine ? `${c.componentName} · ${c.releaseLine}` : c.componentName);
  const rows = [
    {
      label: 'New version',
      value:
        plan.strategy === 'mirror' ? `${name}, copies only` : `${name}, at 0%`,
    },
  ];
  const p = plan.preview;
  if (plan.strategy === 'mirror' && plan.steps?.length) {
    rows.push({ label: 'Copy steps', value: `${plan.steps.join(' → ')}%` });
  } else if (plan.strategy === 'abTest') {
    if (p) rows.push({ label: 'Group', value: `${p.name}=${p.value}` });
    if (p?.audience) rows.push({ label: 'Who', value: audienceText(p) });
  } else if (p?.kind === 'path') {
    rows.push({ label: 'Preview', value: p.value });
  } else if (p?.kind === 'header') {
    rows.push({ label: 'Testers', value: `${p.name}: ${p.value}` });
  }
  if (plan.strategy === 'canary' && plan.steps?.length) {
    rows.push({ label: 'Steps', value: `${plan.steps.join(' → ')}%` });
  }
  if (deploysTo) rows.push({ label: 'Deploys to', value: deploysTo });
  return rows;
}

const candidateKeyOf = (
  component: string,
  endpoint: string,
  releaseLine?: string,
) => `${component}@${releaseLine ?? ''}/${endpoint}`;

/** The backendRefs the page will save, as the Endpoint spec shows them. */
function backendsYaml(backends: EndpointBackendWeight[]): string {
  const lines = ['backendRefs:'];
  for (const b of backends) {
    lines.push(`- name: ${b.name ?? b.componentName}`);
    lines.push(
      `  component: {name: ${b.componentName}, endpoint: ${b.endpoint}${
        b.releaseLine ? `, releaseLine: ${b.releaseLine}` : ''
      }}`,
    );
    lines.push(`  weight: ${b.weight}`);
    if (b.match) {
      lines.push('  match:');
      if (b.match.path) {
        lines.push(
          `    path: {type: ${b.match.path.type ?? 'PathPrefix'}, value: ${
            b.match.path.value
          }}`,
        );
      }
      if (b.match.headers?.length) {
        lines.push('    headers:');
        for (const h of b.match.headers) {
          lines.push(
            `    - {name: ${h.name}, type: ${h.type ?? 'Exact'}, value: "${
              h.value
            }"}`,
          );
        }
      }
      if (b.match.cookies?.length) {
        lines.push('    cookies:');
        for (const c of b.match.cookies) {
          lines.push(`    - {name: ${c.name}, value: ${c.value}}`);
        }
      }
    }
    if (b.mirror) lines.push(`  mirror: {percent: ${b.mirror.percent}}`);
  }
  return lines.join('\n');
}

/** The testers' header a plan sends early traffic by, if any. */
function testerHeader(
  plan: RolloutPlan,
): { name: string; value: string } | undefined {
  const p = plan.preview;
  return p?.kind === 'header' ? { name: p.name, value: p.value } : undefined;
}

function pageTitle(editing: boolean, convert: boolean): string {
  if (convert) return 'Convert to a canary';
  return editing ? 'Rollout settings' : 'Add a backend';
}

function pageSubtitle(
  editing: boolean,
  convert: boolean,
  firstEnvironment = 'the first environment',
): string {
  if (convert) {
    return 'The new version stops getting copies and joins as a canary at 0%. Step it up from Configure.';
  }
  if (editing) {
    return 'Change how people reach the new version and its steps before the rollout is deployed.';
  }
  return `The new backend joins at 0% and the release is deployed to ${firstEnvironment}. Promote it onward and step each environment from Configure.`;
}

/** What saving does to releases, under the saved YAML. */
function savedCaption(
  editing: boolean,
  convert: boolean,
  firstEnvironment = 'the first environment',
): string {
  if (convert) {
    return 'One update to the Endpoint, so one new release. Deploy and promote it as usual.';
  }
  if (editing) {
    return 'A new header, cookie, path or copy share cuts a new release, deployed to the first environment. New steps alone cut none.';
  }
  return `One update to the Endpoint, so one new release, deployed to ${firstEnvironment} with the new backend at 0%.`;
}

function convertLabel(convert: boolean, busy: boolean): string {
  if (convert) return busy ? 'Converting' : 'Convert';
  return busy ? 'Deploying' : 'Save & Deploy';
}

/**
 * Adds a backend to the Endpoint and chooses how it gets traffic, from the
 * Deploy tab's Set up pane, on the Configure Resource page's layout: one
 * page with a section per decision (strategy, new backend, how people reach
 * it), and what will be saved next to it. Saving cuts a release with the
 * new backend at 0%, deployed and promoted like any other, so nothing moves
 * until an environment is stepped. With `editing`, the same page changes
 * the rollout's settings before it is deployed; with `convert` as well, it
 * turns a running mirror into a canary on the same backend, with the steps
 * chosen here.
 */
export const StartRolloutPage = ({
  editing = false,
  convert = false,
}: { editing?: boolean; convert?: boolean } = {}) => {
  const classes = useStyles();
  const theme = useTheme();
  const navigate = useNavigate();
  const { entity } = useEntity();
  const { refresh: refreshEntity } = useAsyncEntity();
  const client = useApi(openChoreoClientApiRef);
  const project = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.PROJECT];
  const namespace = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE];

  const [endpoint, setEndpoint] = useState<EndpointSummary | null>(null);
  const [firstEnvironment, setFirstEnvironment] = useState<{
    name: string;
    label: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [strategy, setStrategy] = useState<RolloutStrategy>('canary');
  const [candidateKey, setCandidateKey] = useState('');
  const [rolloutOptions, setRolloutOptions] = useState<RolloutOptions>(() =>
    defaultRolloutOptions('canary', entity.metadata.name),
  );
  // The new backend's name in the Endpoint, when changed from the suggestion.
  const [candidateName, setCandidateName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [replaces, setReplaces] = useState('');
  const [busy, setBusy] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = useCallback(
    () => navigate('..', { relative: 'path' }),
    [navigate],
  );

  useEffect(() => {
    let ignore = false;
    Promise.all([
      client.fetchEndpointRollout(entity),
      client.fetchEndpointEnvironmentInfo(entity),
    ])
      .then(([summary, envInfo]) => {
        if (ignore) return;
        setEndpoint(summary);
        const first = envInfo?.[0];
        setFirstEnvironment(
          first ? { name: envResourceName(first), label: first.name } : null,
        );
        const running = summary?.rollout;
        if (convert && running) {
          setStrategy('canary');
          setReplaces(running.stable);
          setRolloutOptions(o =>
            withStrategyDefaults({ ...o, steps: [] }, 'canary', {
              typeName: summary?.typeName,
              capabilities: summary?.capabilities,
            }),
          );
        } else if (editing && running) {
          const p = running.preview;
          const audienceHeader = abAudience(p);
          setStrategy(running.strategy);
          setReplaces(running.stable);
          setRolloutOptions(o => ({
            ...o,
            steps: normalizeSteps(running.steps),
            useHeader: p?.kind === 'header',
            previewBy: p?.kind === 'path' ? 'path' : 'header',
            ...(p?.kind === 'header' && {
              headerName: p.name,
              headerValue: p.value,
            }),
            ...(p?.kind === 'path' && { previewPath: p.value }),
            ...(p?.kind === 'cookie' && {
              cookieName: p.name,
              cookieValue: p.value,
            }),
            audienceOn: Boolean(audienceHeader),
            ...(audienceHeader && { audience: audienceHeader }),
          }));
        }
      })
      .catch(err => !ignore && setLoadError(err));
    return () => {
      ignore = true;
    };
  }, [client, entity, editing, convert]);

  const { options: workloadEndpoints } = useProjectWorkloadEndpoints(
    namespace,
    project,
    { includeReleaseLines: true },
  );

  const support = useMemo<RolloutTypeSupport>(
    () => ({
      typeName: endpoint?.typeName,
      capabilities: endpoint?.capabilities,
    }),
    [endpoint?.typeName, endpoint?.capabilities],
  );

  useEffect(() => {
    if (editing) return;
    setRolloutOptions(o => withStrategyDefaults(o, strategy, support));
  }, [strategy, editing, support]);

  // Any workload endpoint but the backends serving now, on a component's
  // main line or a release line; one left at 0% by an earlier rollout can be
  // added again.
  const current = new Set(
    endpoint?.backends
      .filter(b => b.weight > 0)
      .map(b => candidateKeyOf(b.componentName, b.endpoint, b.releaseLine)) ??
      [],
  );
  const options = workloadEndpoints
    .map(o => ({
      key: candidateKeyOf(o.component, o.endpoint, o.releaseLine),
      ...o,
    }))
    .filter(o => !current.has(o.key));
  const picked = options.find(o => o.key === candidateKey);
  const running = editing
    ? endpoint?.backends.find(
        b => (b.name ?? b.componentName) === endpoint.rollout?.candidate,
      )
    : undefined;
  const component = running?.componentName ?? picked?.component ?? '';
  const endpointKey = running?.endpoint ?? picked?.endpoint ?? '';
  const releaseLine = running ? running.releaseLine : picked?.releaseLine;
  const owner = (entity.spec as { managedByComponent?: string } | undefined)
    ?.managedByComponent;
  const movesToProject = Boolean(owner && component && component !== owner);
  // The new backend replaces one serving backend, by default the busiest;
  // the others keep their traffic, as on an Argo Rollouts or Flagger route.
  const serving = endpoint?.backends.filter(b => b.weight > 0) ?? [];
  const servingTotal = serving.reduce((sum, b) => sum + b.weight, 0);
  const nameOf = (b: { name?: string; componentName: string }) =>
    b.name ?? b.componentName;
  const busiest = [...serving].sort((a, b) => b.weight - a.weight)[0];
  const replaced =
    serving.find(b => nameOf(b) === replaces) ?? busiest ?? undefined;
  const replacedName = replaced ? nameOf(replaced) : undefined;
  const stable = replacedName ?? 'the current backend';

  // The new backend's name: unique on the Endpoint (component, release
  // line, then endpoint), and changed only when asked.
  const suggestedName =
    !editing && component && endpointKey
      ? uniqueBackendName(endpoint?.backends ?? [], {
          componentName: component,
          endpoint: endpointKey,
          ...(releaseLine && { releaseLine }),
        })
      : '';
  const backendName = candidateName || suggestedName;
  let nameProblem = '';
  if (
    backendName &&
    !/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(backendName)
  ) {
    nameProblem = 'Use lowercase letters, digits and -, up to 63 characters.';
  } else if (
    candidateName &&
    (endpoint?.backends ?? []).some(
      b => (b.name ?? b.componentName) === candidateName,
    )
  ) {
    nameProblem = 'The Endpoint already has a backend with this name.';
  }

  const plan = useMemo((): RolloutPlan | null => {
    if (!component || !endpointKey || nameProblem) return null;
    const candidate = {
      componentName: component,
      endpoint: endpointKey,
      ...(releaseLine && { releaseLine }),
      ...(backendName && { name: backendName }),
    };
    const part = rolloutOptionsPlan(strategy, rolloutOptions);
    return part
      ? {
          strategy,
          candidate,
          ...(replacedName && { replaces: replacedName }),
          ...part,
        }
      : null;
  }, [
    strategy,
    component,
    releaseLine,
    endpointKey,
    rolloutOptions,
    replacedName,
    backendName,
    nameProblem,
  ]);

  const saved = useMemo(() => {
    if (!endpoint || !plan) return [];
    if (convert && endpoint.rollout) {
      return convertToCanary(
        endpoint.backends,
        endpoint.rollout,
        testerHeader(plan),
        plan.steps,
      ).backends;
    }
    return planRollout(endpoint.backends, plan).backends;
  }, [endpoint, plan, convert]);
  const savedCandidate = saved.find(b =>
    isSameBackend(b, {
      componentName: component,
      endpoint: endpointKey,
      releaseLine,
    }),
  );
  const matchProblem = savedCandidate?.match
    ? backendMatchProblems(savedCandidate.match)[0]
    : undefined;

  const start = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      if (convert) {
        await client.convertRollout(entity, testerHeader(plan), plan.steps);
        [0, 3000, 8000].forEach(ms => setTimeout(() => refreshEntity?.(), ms));
        back();
        return;
      }
      const { latestRelease } = editing
        ? await client.updateRolloutSettings(entity, {
            steps: plan.steps,
            preview: plan.preview,
            mirrorPercent: plan.mirrorPercent,
          })
        : await client.startRollout(entity, plan);
      if (latestRelease && firstEnvironment) {
        await client.deployEndpointRelease(
          entity,
          firstEnvironment.name,
          latestRelease,
        );
      }
      [0, 3000, 8000].forEach(ms => setTimeout(() => refreshEntity?.(), ms));
      back();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (isForbiddenError(loadError)) {
    return (
      <ForbiddenState
        message="You do not have permission to change this endpoint."
        minHeight="400px"
      />
    );
  }

  const strategyProblem = strategyUnsupported(
    strategy,
    support.capabilities,
    support.typeName,
  );
  const optionsProblem = rolloutOptionsProblem(
    strategy,
    rolloutOptions,
    support,
  );
  let blocked = '';
  if (editing && endpoint && !endpoint.rollout)
    blocked = 'No rollout is running';
  else if (convert && endpoint?.rollout?.strategy !== 'mirror')
    blocked = 'Only a mirror converts to a canary';
  else if (!editing && endpoint?.rollout)
    blocked = 'A rollout is already running';
  else if (!component) blocked = 'Pick the new backend';
  else if (nameProblem) blocked = nameProblem;
  else if (strategyProblem) blocked = strategyProblem;
  else if (optionsProblem) blocked = optionsProblem;
  else if (matchProblem) blocked = matchProblem;

  const actions = endpoint && (
    <Tooltip title={blocked}>
      <span>
        <Button
          variant="contained"
          color="primary"
          disabled={busy || Boolean(blocked)}
          startIcon={
            busy ? <CircularProgress size={20} color="inherit" /> : undefined
          }
          onClick={() => void start()}
        >
          {convertLabel(convert, busy)}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <DetailPageLayout
      title={pageTitle(editing, convert)}
      subtitle={pageSubtitle(editing, convert, firstEnvironment?.label)}
      onBack={back}
      actions={actions}
    >
      {!endpoint && !loadError && (
        <Box className={classes.loadingContainer}>
          <Skeleton variant="rect" width="100%" height={96} />
          <Skeleton variant="rect" width="100%" height={120} />
        </Box>
      )}
      {loadError && (
        <Alert severity="error">
          Failed to load the endpoint: {getErrorMessage(loadError)}
        </Alert>
      )}
      {error && (
        <Box mb={2}>
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        </Box>
      )}
      {!editing && endpoint?.rollout && (
        <Box mb={2}>
          <Alert severity="info">
            A rollout is already running on this Endpoint. Finish it first by
            removing the Current or New backend on the Set up pane.
          </Alert>
        </Box>
      )}

      {endpoint && (
        <Box className={classes.layout}>
          <Box className={classes.formCard}>
            {editing && (
              <Box className={classes.field}>
                <Typography variant="body2" className={classes.label}>
                  {convert
                    ? `${STRATEGY_COPY.canary.name} (was a mirror)`
                    : STRATEGY_COPY[strategy].name}
                </Typography>
                <Typography variant="body2">
                  {releaseLine ? `${component} · ${releaseLine}` : component}{' '}
                  next to {stable}
                </Typography>
                {!convert && (
                  <Typography variant="caption" color="textSecondary">
                    To use another strategy or backend, remove the new version
                    from the Set up card first.
                  </Typography>
                )}
              </Box>
            )}
            <Box className={classes.field}>
              {!editing && (
                <>
                  <SectionLabel number={1}>New version</SectionLabel>
                  <Box className={classes.pair}>
                    <TextField
                      id="rollout-candidate"
                      select
                      size="small"
                      variant="outlined"
                      label="Component and endpoint"
                      value={candidateKey}
                      onChange={e => setCandidateKey(e.target.value)}
                      helperText={`Joins next to ${stable} at 0%.`}
                    >
                      {options.length === 0 && (
                        <MenuItem value="" disabled>
                          No other workload endpoints in this project
                        </MenuItem>
                      )}
                      {options.map(o => (
                        <MenuItem key={o.key} value={o.key}>
                          {o.releaseLine
                            ? `${o.component} (release line ${o.releaseLine})`
                            : o.component}{' '}
                          · {o.endpoint}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  {backendName && !editingName && (
                    <Typography variant="caption" color="textSecondary">
                      Backend name: <strong>{backendName}</strong> ·{' '}
                      <Link
                        component="button"
                        variant="caption"
                        onClick={() => {
                          setCandidateName(backendName);
                          setEditingName(true);
                        }}
                      >
                        Change
                      </Link>
                    </Typography>
                  )}
                  {editingName && (
                    <TextField
                      id="rollout-candidate-name"
                      size="small"
                      variant="outlined"
                      label="Backend name"
                      value={candidateName}
                      error={Boolean(nameProblem)}
                      helperText={
                        nameProblem ||
                        `Its name in the Endpoint. Empty uses ${suggestedName}.`
                      }
                      onChange={e => setCandidateName(e.target.value)}
                    />
                  )}
                  {movesToProject && (
                    <Alert severity="info">
                      This Endpoint belongs to {owner}. Routing to {component}{' '}
                      moves it to the project. A release line of {owner} keeps
                      it with the component.
                    </Alert>
                  )}
                </>
              )}
            </Box>

            {!editing && serving.length > 1 && (
              <Box className={classes.field}>
                <Typography variant="body2" color="textSecondary">
                  Replaces
                </Typography>
                <RadioGroup
                  aria-label="Version to replace"
                  value={stable}
                  onChange={e => setReplaces(e.target.value)}
                >
                  {serving.map(b => (
                    <FormControlLabel
                      key={nameOf(b)}
                      value={nameOf(b)}
                      control={<Radio color="primary" size="small" />}
                      label={`${nameOf(b)} · ${Math.round(
                        (b.weight / servingTotal) * 100,
                      )}% of traffic`}
                    />
                  ))}
                </RadioGroup>
                <Typography variant="caption" color="textSecondary">
                  The new version takes traffic only from this one. Other
                  versions keep their traffic and stay after the rollout
                  completes.
                </Typography>
              </Box>
            )}

            {!editing && (
              <Box className={classes.field}>
                <SectionLabel number={2}>Strategy</SectionLabel>
                <Box className={classes.cards} role="radiogroup">
                  {(Object.keys(STRATEGY_COPY) as RolloutStrategy[]).map(
                    kind => {
                      const unsupported = strategyUnsupported(
                        kind,
                        support.capabilities,
                        support.typeName,
                      );
                      return (
                        <button
                          type="button"
                          key={kind}
                          role="radio"
                          aria-checked={strategy === kind}
                          disabled={Boolean(unsupported)}
                          title={unsupported}
                          className={`${classes.card} ${
                            strategy === kind ? classes.selected : ''
                          }`}
                          onClick={() => setStrategy(kind)}
                        >
                          {ICONS[kind]}
                          <Typography variant="subtitle2">
                            {STRATEGY_COPY[kind].name}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            {unsupported ?? STRATEGY_COPY[kind].question}
                          </Typography>
                        </button>
                      );
                    },
                  )}
                </Box>
                <Typography variant="caption" color="textSecondary">
                  {STRATEGY_COPY[strategy].pitch}
                </Typography>
              </Box>
            )}

            <RolloutOptionsFields
              strategy={strategy}
              value={rolloutOptions}
              onChange={setRolloutOptions}
              stableName={stable}
              matchProblem={matchProblem}
              support={support}
              firstNumber={editing ? undefined : 3}
            />
          </Box>
          <Box className={classes.summary}>
            <Typography variant="body2" className={classes.label}>
              Summary
            </Typography>
            <Box className={classes.flowBox}>
              {plan ? (
                <StrategyFlow
                  strategy={plan.strategy}
                  preview={plan.preview}
                  current={toFlowVersion(
                    replaced ?? { componentName: stable },
                    plan.candidate,
                    backendColor(theme, 0),
                  )}
                  next={toFlowVersion(
                    plan.candidate,
                    replaced,
                    backendColor(theme, 1),
                  )}
                />
              ) : (
                <Typography variant="caption" color="textSecondary">
                  Pick the new version to see how requests flow.
                </Typography>
              )}
            </Box>
            {plan && (
              <Box display="flex" flexDirection="column" gridGap={8}>
                {planSummary(
                  plan,
                  editing ? undefined : firstEnvironment?.label,
                ).map(row => (
                  <Box key={row.label} className={classes.summaryRow}>
                    <Typography variant="body2" color="textSecondary">
                      {row.label}
                    </Typography>
                    <Typography variant="body2" align="right">
                      {row.value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
            <Box
              borderTop={1}
              borderColor="divider"
              pt={1.5}
              display="flex"
              flexDirection="column"
              gridGap={8}
            >
              <Button
                color="primary"
                size="small"
                aria-expanded={showYaml}
                onClick={() => setShowYaml(v => !v)}
                startIcon={
                  <ChevronRightIcon
                    style={{
                      transform: showYaml ? 'rotate(90deg)' : undefined,
                      transition: 'transform 150ms',
                    }}
                  />
                }
                style={{ alignSelf: 'flex-start' }}
              >
                What will be saved (YAML)
              </Button>
              <Collapse in={showYaml}>
                <pre className={classes.preview}>
                  {saved.length > 0
                    ? backendsYaml(saved)
                    : 'Pick the new backend to see the Endpoint it saves.'}
                </pre>
              </Collapse>
              <Typography variant="caption" color="textSecondary">
                {savedCaption(editing, convert, firstEnvironment?.label)}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}
    </DetailPageLayout>
  );
};
