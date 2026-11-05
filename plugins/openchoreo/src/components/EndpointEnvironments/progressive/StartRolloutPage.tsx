import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  InputAdornment,
  Link,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert, ToggleButton, ToggleButtonGroup } from '@material-ui/lab';
import YAML from 'yaml';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { useAsyncEntity, useEntity } from '@backstage/plugin-catalog-react';
import {
  Skeleton,
  YamlViewer,
  type FormYamlMode,
} from '@openchoreo/backstage-design-system';
import {
  DetailPageLayout,
  ForbiddenState,
  UnsavedChangesDialog,
} from '@openchoreo/backstage-plugin-react';
import {
  abAudience,
  backendMatchProblems,
  CHOREO_ANNOTATIONS,
  convertToCanary,
  isSameBackend,
  uniqueBackendName,
  planRollout,
  reconfigureRollout,
  hasShare,
  shareProblem,
  strategyUnsupported,
  withShare,
  toSpecRollout,
  type EndpointBackendMatch,
  type EndpointBackendWeight,
  type EndpointRollout,
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
  rolloutOptionsPlan,
  rolloutOptionsProblem,
  withStrategyDefaults,
  type RolloutOptions,
  type RolloutTypeSupport,
} from './RolloutOptionsFields';
import { useProjectWorkloadEndpoints } from '../../../scaffolder/EndpointBackendsField/useProjectWorkloadEndpoints';
import { openChoreoClientApiRef } from '../../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../../utils/errorUtils';
import { backendLabel, roleColor } from './endpointUi';
import { STRATEGY_COPY } from './endpointRolloutUi';
import { TrafficSplitBar } from './TrafficSplitBar';
import { PdBox, PdCard, PdSection } from './pdLayout';
import { useUnsavedGuard } from './useUnsavedGuard';

const useStyles = makeStyles(theme => ({
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: theme.spacing(2),
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
  joins: {
    marginTop: theme.spacing(-1),
    paddingLeft: theme.spacing(1.75),
  },
  rename: {
    font: 'inherit',
    verticalAlign: 'baseline',
    padding: 0,
  },
  // OpenChoreo's segmented toggle as the retain policy shows it.
  strategies: {
    alignSelf: 'flex-start',
    flexWrap: 'wrap',
  },
  version: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minHeight: 52,
    padding: theme.spacing(0, 2),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    backgroundColor: theme.palette.background.default,
  },
  spacer: { flex: 1 },
  nested: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    margin: theme.spacing(1, 0, 1.5, 4),
  },
  share: { width: 160 },
  flow: {
    minHeight: 120,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

const STRATEGIES = Object.keys(STRATEGY_COPY) as RolloutStrategy[];

const candidateKeyOf = (
  component: string,
  endpoint: string,
  releaseLine?: string,
) => `${component}@${releaseLine ?? ''}/${endpoint}`;

const lineKeyOf = (component: string, releaseLine?: string) =>
  `${component}@${releaseLine ?? ''}`;

const nameOf = (b: { name?: string; componentName: string }) =>
  b.name ?? b.componentName;

/** The Endpoint's backendRefs and spec.rollout as Save writes them. */
function endpointYaml(
  backends: EndpointBackendWeight[],
  rollout?: EndpointRollout,
): string {
  return YAML.stringify({
    spec: {
      backendRefs: backends.map(b => ({
        name: nameOf(b),
        component: {
          name: b.componentName,
          endpoint: b.endpoint,
          ...(b.releaseLine && { releaseLine: b.releaseLine }),
        },
        weight: b.weight,
        ...(b.match && { match: b.match }),
        ...(b.mirror && { mirror: b.mirror }),
      })),
      ...(rollout && { rollout: toSpecRollout(rollout) }),
    },
  });
}

/**
 * How a new backend gets its traffic: gradually, through a rollout, or right
 * away, by a share of the requests or, at weight 0, by its match.
 */
type Traffic = 'gradual' | 'share' | 'match';

interface PlainMatch {
  by: 'header' | 'cookie' | 'path';
  name: string;
  value: string;
}

function toMatch(m: PlainMatch): EndpointBackendMatch | undefined {
  if (!m.value || (m.by !== 'path' && !m.name)) return undefined;
  if (m.by === 'path') return { path: { value: m.value } };
  if (m.by === 'cookie') return { cookies: [{ name: m.name, value: m.value }] };
  return { headers: [{ name: m.name, value: m.value }] };
}

function matchRule(m: PlainMatch): string {
  if (m.by === 'path') return `path ${m.value}`;
  if (m.by === 'cookie') return `cookie ${m.name}=${m.value}`;
  return `${m.name}: ${m.value}`;
}

/** The testers' header a plan sends early traffic by, if any. */
function testerHeader(
  plan: RolloutPlan,
): { name: string; value: string } | undefined {
  const p = plan.preview;
  return p?.kind === 'header' ? { name: p.name, value: p.value } : undefined;
}

function pageTitle(editing: boolean, convert: boolean): string {
  if (convert) return 'Convert to a Canary';
  return editing ? 'Configure Rollout' : 'Add Backend';
}

function pageSubtitle(
  editing: boolean,
  convert: boolean,
  traffic: Traffic = 'gradual',
): string {
  if (convert) {
    return 'The new backend stops getting copies and joins as a canary at 0%. Step it up from Configure.';
  }
  if (editing) {
    return 'Edit the steps and the match. New steps alone cut no release.';
  }
  if (traffic === 'share') {
    return 'The new backend gets its share once the release is deployed. Saving cuts a new release.';
  }
  if (traffic === 'match') {
    return 'Only matching requests reach the new backend once the release is deployed. Saving cuts a new release.';
  }
  return 'The new backend joins at 0%. Saving cuts a new release.';
}

/** What saving does to releases, under the flow. */
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
  return `In each environment before its first step. Saving cuts one release, deployed to ${firstEnvironment}.`;
}

/** What saving a backend added right away does, under the flow. */
function plainCaption(
  traffic: Traffic,
  firstEnvironment = 'the first environment',
  name: string,
  share: number,
  rule: string,
): string {
  if (traffic === 'share') {
    return `Saving cuts one release, deployed to ${firstEnvironment}, where ${
      name || 'the new backend'
    } gets ${share}%.`;
  }
  return `Saving cuts one release, deployed to ${firstEnvironment}. Requests with ${rule} reach ${
    name || 'the new backend'
  }; the rest keep this split.`;
}

function saveLabel(convert: boolean, busy: boolean): string {
  if (convert) return busy ? 'Converting' : 'Convert';
  return busy ? 'Deploying' : 'Save & Deploy';
}

/**
 * Adds a backend to the Endpoint and chooses how it gets traffic, from the
 * Deploy tab's Set up pane, on OpenChoreo's configure page layout: one card
 * with a section per decision (the new version, the strategy, its options)
 * and how requests will flow, and its YAML behind the FORM | YAML toggle.
 * Saving cuts a release with the new backend at 0%, deployed and promoted
 * like any other, so nothing moves until an environment is stepped. With
 * `editing`, the same page changes the rollout's settings before it is
 * deployed; with `convert` as well, it turns a running mirror into a canary
 * on the same backend, with the steps chosen here.
 */
export const StartRolloutPage = ({
  editing = false,
  convert = false,
}: { editing?: boolean; convert?: boolean } = {}) => {
  const classes = useStyles();
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
  const [reload, setReload] = useState(0);
  const [strategy, setStrategy] = useState<RolloutStrategy>('canary');
  const [traffic, setTraffic] = useState<Traffic>('gradual');
  const [pickedShare, setShare] = useState<number | null>(null);
  const [plainMatch, setPlainMatch] = useState<PlainMatch>({
    by: 'header',
    name: '',
    value: '',
  });
  const [lineKey, setLineKey] = useState('');
  const [endpointName, setEndpointName] = useState('');
  const [rolloutOptions, setRolloutOptions] = useState<RolloutOptions>(() =>
    defaultRolloutOptions('canary', entity.metadata.name),
  );
  // The new backend's name in the Endpoint, when changed from the suggestion.
  const [candidateName, setCandidateName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [replaces, setReplaces] = useState('');
  const [mode, setMode] = useState<FormYamlMode>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The fields changed here, for the unsaved-changes dialog.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const touch = (field: string) =>
    setTouched(t => (t.has(field) ? t : new Set(t).add(field)));
  const guard = useUnsavedGuard(touched.size > 0);

  const back = useCallback(
    () => navigate('..', { relative: 'path' }),
    [navigate],
  );

  useEffect(() => {
    let ignore = false;
    setLoadError(null);
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
  }, [client, entity, editing, convert, reload]);

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

  // A rollout or plain routing; editing and converting are rollouts.
  const plain = !editing && !convert && traffic !== 'gradual';
  // Until one is typed, the new backend gets an even share with the others.
  const share =
    pickedShare ??
    Math.round(100 / ((endpoint?.backends.filter(hasShare).length ?? 0) + 1));
  // Any workload endpoint but the backends serving now, on a component's
  // main line or a release line; one left at 0% by an earlier rollout can be
  // rolled out again. A backend added right away is a new one.
  const current = new Set(
    endpoint?.backends
      .filter(b => plain || b.weight > 0)
      .map(b => candidateKeyOf(b.componentName, b.endpoint, b.releaseLine)) ??
      [],
  );
  const options = workloadEndpoints.filter(
    o => !current.has(candidateKeyOf(o.component, o.endpoint, o.releaseLine)),
  );
  const lines = [
    ...new Map(
      options.map(o => [lineKeyOf(o.component, o.releaseLine), o]),
    ).values(),
  ];
  const lineEndpoints = options.filter(
    o => lineKeyOf(o.component, o.releaseLine) === lineKey,
  );
  const picked = lineEndpoints.find(o => o.endpoint === endpointName);
  const runningCandidate = editing
    ? endpoint?.backends.find(b => nameOf(b) === endpoint.rollout?.candidate)
    : undefined;
  const component = runningCandidate?.componentName ?? picked?.component ?? '';
  const endpointKey = runningCandidate?.endpoint ?? picked?.endpoint ?? '';
  const releaseLine = runningCandidate
    ? runningCandidate.releaseLine
    : picked?.releaseLine;
  const owner = (entity.spec as { managedByComponent?: string } | undefined)
    ?.managedByComponent;
  const movesToProject = Boolean(owner && component && component !== owner);
  // The new backend replaces one serving backend, by default the busiest;
  // the others keep their traffic, as on an Argo Rollouts or Flagger route.
  const serving = endpoint?.backends.filter(b => b.weight > 0) ?? [];
  const servingTotal = serving.reduce((sum, b) => sum + b.weight, 0);
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
    (endpoint?.backends ?? []).some(b => nameOf(b) === candidateName)
  ) {
    nameProblem = 'The Endpoint already has a backend with this name.';
  }

  const match = traffic === 'match' ? toMatch(plainMatch) : undefined;
  const plainBackend = useMemo((): EndpointBackendWeight | null => {
    if (!plain || !component || !endpointKey || nameProblem) return null;
    return {
      componentName: component,
      endpoint: endpointKey,
      ...(releaseLine && { releaseLine }),
      ...(backendName && { name: backendName }),
      weight: traffic === 'share' ? share : 0,
      ...(match && { match }),
    };
  }, [
    plain,
    component,
    endpointKey,
    releaseLine,
    backendName,
    nameProblem,
    traffic,
    share,
    match,
  ]);
  const matchUnsupported =
    support.capabilities?.length && !support.capabilities.includes('Match')
      ? `${support.typeName ?? 'This type'} can't route by a match`
      : '';
  let plainProblem = '';
  if (traffic === 'share') {
    plainProblem = shareProblem(
      endpoint?.backends ?? [],
      { componentName: component, endpoint: endpointKey, weight: share },
      share,
    );
  } else if (traffic === 'match') {
    plainProblem =
      matchUnsupported ||
      (match ? backendMatchProblems(match)[0] ?? '' : 'Fill in the match');
  }
  const existing = endpoint?.backends ?? [];
  let withPlain = existing;
  if (plainBackend && traffic === 'share' && !plainProblem) {
    withPlain = withShare(existing, plainBackend, share);
  } else if (plainBackend) {
    withPlain = [...existing, plainBackend];
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
    if (plainBackend && endpoint) return { backends: withPlain };
    if (!endpoint || !plan) return null;
    const running = endpoint.rollout;
    if (convert && running) {
      return convertToCanary(
        endpoint.backends,
        running,
        testerHeader(plan),
        plan.steps,
      );
    }
    if (editing && running) {
      return reconfigureRollout(endpoint.backends, running, {
        steps: plan.steps,
        preview: plan.preview,
        mirrorPercent: plan.mirrorPercent,
      });
    }
    return planRollout(endpoint.backends, plan);
  }, [endpoint, plan, convert, editing, plainBackend, withPlain]);
  const savedCandidate = saved?.backends.find(b =>
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
    if (!plan && !plainBackend) return;
    setBusy(true);
    setError(null);
    try {
      if (plainBackend) {
        const { latestRelease } = await client.addBackend(
          entity,
          plainBackend,
          traffic === 'share' ? share : undefined,
        );
        if (latestRelease && firstEnvironment) {
          await client.deployEndpointRelease(
            entity,
            firstEnvironment.name,
            latestRelease,
          );
        }
      } else if (!plan) {
        return;
      } else if (convert) {
        await client.convertRollout(entity, testerHeader(plan), plan.steps);
      } else {
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
      }
      [0, 3000, 8000].forEach(ms => setTimeout(() => refreshEntity?.(), ms));
      guard.pass(back);
    } catch (err: unknown) {
      setError(
        isForbiddenError(err)
          ? 'You do not have permission to perform this action. Contact your administrator.'
          : getErrorMessage(err),
      );
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
  else if (!component) blocked = 'Pick the new version';
  else if (nameProblem) blocked = nameProblem;
  else if (plain) blocked = plainProblem;
  else if (strategyProblem) blocked = strategyProblem;
  else if (optionsProblem) blocked = optionsProblem;
  else if (matchProblem) blocked = matchProblem;

  const actions = endpoint && (
    <Tooltip title={blocked} disableHoverListener={!blocked}>
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
          {saveLabel(convert, busy)}
        </Button>
      </span>
    </Tooltip>
  );

  const pickLine = (key: string) => {
    touch('component');
    setLineKey(key);
    const first = options.find(
      o => lineKeyOf(o.component, o.releaseLine) === key,
    );
    setEndpointName(first?.endpoint ?? '');
  };

  const unsupported = STRATEGIES.map(kind => ({
    kind,
    reason: strategyUnsupported(kind, support.capabilities, support.typeName),
  })).filter(s => s.reason);
  let strategyHelper = STRATEGY_COPY[strategy].question;
  if (convert) {
    strategyHelper =
      'Converting turns the mirror into a canary on the same backend.';
  } else if (editing) {
    strategyHelper =
      'Fixed while the rollout runs. To use another, remove the new version from the Set up pane first.';
  }

  const running = endpoint?.rollout;
  const versions =
    editing && running
      ? [
          {
            role: 'Current',
            backend: endpoint?.backends.find(b => nameOf(b) === running.stable),
            name: running.stable,
          },
          {
            role: 'New',
            backend: runningCandidate,
            name: running.candidate,
          },
        ]
      : [];

  const waiting = (problem: string, what: string) => (
    <Typography variant="caption" color="textSecondary">
      {component
        ? `${problem || 'Fill in the settings'} to see how requests flow.`
        : `Pick the new ${what} to see how requests flow.`}
    </Typography>
  );
  let flow: ReactNode;
  if (plain) {
    flow = plainBackend ? (
      <Box width="100%">
        <TrafficSplitBar
          backends={traffic === 'share' ? withPlain : existing}
          showLegend
        />
      </Box>
    ) : (
      waiting(plainProblem, 'backend')
    );
  } else {
    flow = plan ? (
      <StrategyFlow
        strategy={plan.strategy}
        preview={plan.preview}
        current={toFlowVersion(
          replaced ?? { componentName: stable },
          roleColor('Current'),
        )}
        next={toFlowVersion(plan.candidate, roleColor('New'))}
      />
    ) : (
      waiting(optionsProblem, 'version')
    );
  }

  const form = (
    <>
      {editing ? (
        <PdSection
          heading="Versions"
          helper={
            convert
              ? 'The mirror’s new version becomes the canary’s.'
              : 'Fixed while the rollout runs. To use another backend, remove the new version from the Set up pane first.'
          }
        >
          {versions.map(v => (
            <Box key={v.role} className={classes.version}>
              <Typography variant="body2" style={{ fontWeight: 600 }}>
                {v.backend ? backendLabel(v.backend) : v.name}
              </Typography>
              {v.backend?.endpoint && (
                <>
                  <Typography variant="body2" color="textSecondary">
                    /
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {v.backend.endpoint}
                  </Typography>
                </>
              )}
              <span className={classes.spacer} />
              <Chip
                size="small"
                variant="outlined"
                color={v.role === 'New' ? 'primary' : 'default'}
                label={v.role}
              />
            </Box>
          ))}
        </PdSection>
      ) : (
        <PdSection
          heading="Backend"
          helper="A component's endpoint, on its main line or one of its release lines."
        >
          <Box className={classes.pair}>
            <TextField
              id="rollout-component"
              select
              fullWidth
              variant="outlined"
              label="Component"
              value={lineKey}
              onChange={e => pickLine(e.target.value)}
              SelectProps={{
                renderValue: key => {
                  const o = lines.find(
                    l => lineKeyOf(l.component, l.releaseLine) === key,
                  );
                  return o
                    ? backendLabel({
                        componentName: o.component,
                        releaseLine: o.releaseLine,
                      })
                    : '';
                },
              }}
            >
              {lines.length === 0 && (
                <MenuItem value="" disabled>
                  No other workload endpoints in this project
                </MenuItem>
              )}
              {lines.map(o => (
                <MenuItem
                  key={lineKeyOf(o.component, o.releaseLine)}
                  value={lineKeyOf(o.component, o.releaseLine)}
                >
                  {backendLabel({
                    componentName: o.component,
                    releaseLine: o.releaseLine,
                  })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              id="rollout-endpoint"
              select
              fullWidth
              variant="outlined"
              label="Endpoint"
              value={endpointName}
              disabled={!lineKey}
              onChange={e => {
                touch('endpoint');
                setEndpointName(e.target.value);
              }}
            >
              {lineEndpoints.map(o => (
                <MenuItem key={o.endpoint} value={o.endpoint}>
                  {o.endpoint}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          {backendName && !editingName && (
            <Typography
              variant="caption"
              color="textSecondary"
              className={classes.joins}
            >
              Joins as <strong>{backendName}</strong>
              {traffic === 'share' &&
                !editing &&
                `, getting ${share}% of requests. `}
              {traffic === 'match' &&
                !editing &&
                ', for matching requests only. '}
              {(traffic === 'gradual' || editing) &&
                (strategy === 'mirror'
                  ? ` next to ${stable}, getting copies only. `
                  : ` next to ${stable}, at 0%. `)}
              <Link
                component="button"
                className={classes.rename}
                onClick={() => {
                  setCandidateName(backendName);
                  setEditingName(true);
                }}
              >
                Rename
              </Link>
            </Typography>
          )}
          {editingName && (
            <TextField
              id="rollout-candidate-name"
              variant="outlined"
              label="Backend name"
              value={candidateName}
              error={Boolean(nameProblem)}
              helperText={
                nameProblem ||
                `Its name in the Endpoint. Empty uses ${suggestedName}.`
              }
              onChange={e => {
                touch('name');
                setCandidateName(e.target.value);
              }}
            />
          )}
          {movesToProject && (
            <Alert severity="info">
              This Endpoint belongs to {owner}. Routing to {component} moves it
              to the project. A release line of {owner} keeps it with the
              component.
            </Alert>
          )}
        </PdSection>
      )}

      {!editing && !convert && (
        <PdSection
          heading="How it gets traffic"
          helper="Pick how the new backend starts getting requests."
        >
          <RadioGroup
            aria-label="How it gets traffic"
            value={traffic}
            onChange={e => {
              touch('traffic');
              setTraffic(e.target.value as Traffic);
            }}
          >
            {(
              [
                [
                  'gradual',
                  'Gradually',
                  'A rollout: it starts at 0% and you step it up in each environment.',
                ],
                [
                  'share',
                  'By share',
                  'Right away: it gets a percentage of all requests.',
                ],
                [
                  'match',
                  'By match',
                  matchUnsupported ||
                    'Right away: only requests with a header, cookie or path reach it.',
                ],
              ] as const
            ).map(([value, label, helper]) => (
              <Box key={value}>
                <FormControlLabel
                  value={value}
                  disabled={value === 'match' && Boolean(matchUnsupported)}
                  control={<Radio color="primary" />}
                  label={
                    <Box>
                      <Typography variant="body1">{label}</Typography>
                      <Typography variant="body2" color="textSecondary">
                        {helper}
                      </Typography>
                    </Box>
                  }
                />
                {value === 'share' && traffic === 'share' && (
                  <Box className={classes.nested}>
                    <TextField
                      id="backend-share"
                      type="number"
                      variant="outlined"
                      label="Share"
                      className={classes.share}
                      value={Number.isNaN(share) ? '' : share}
                      inputProps={{ min: 0, max: 100, step: 1 }}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">%</InputAdornment>
                        ),
                      }}
                      error={Boolean(plainProblem)}
                      onChange={e => {
                        touch('share');
                        setShare(parseInt(e.target.value, 10));
                      }}
                      helperText={
                        plainProblem ||
                        'Of the requests no match takes. The other backends keep their ratio.'
                      }
                    />
                  </Box>
                )}
                {value === 'match' && traffic === 'match' && (
                  <Box className={classes.nested}>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      className={classes.strategies}
                      value={plainMatch.by}
                      aria-label="Match by"
                      onChange={(_e, by: PlainMatch['by'] | null) => {
                        if (!by) return;
                        touch('match');
                        setPlainMatch(m => ({ ...m, by }));
                      }}
                    >
                      <ToggleButton value="header">Header</ToggleButton>
                      <ToggleButton value="cookie">Cookie</ToggleButton>
                      <ToggleButton value="path">Path</ToggleButton>
                    </ToggleButtonGroup>
                    <Box
                      className={plainMatch.by === 'path' ? '' : classes.pair}
                    >
                      {plainMatch.by !== 'path' && (
                        <TextField
                          id="backend-match-name"
                          variant="outlined"
                          label={
                            plainMatch.by === 'cookie' ? 'Cookie' : 'Header'
                          }
                          value={plainMatch.name}
                          onChange={e => {
                            touch('match');
                            setPlainMatch(m => ({
                              ...m,
                              name: e.target.value,
                            }));
                          }}
                        />
                      )}
                      <TextField
                        id="backend-match-value"
                        variant="outlined"
                        fullWidth={plainMatch.by === 'path'}
                        label={
                          {
                            header: 'Value',
                            cookie: 'Cookie value',
                            path: 'Path',
                          }[plainMatch.by]
                        }
                        value={plainMatch.value}
                        error={Boolean(match && plainProblem)}
                        helperText={match ? plainProblem : undefined}
                        onChange={e => {
                          touch('match');
                          setPlainMatch(m => ({ ...m, value: e.target.value }));
                        }}
                      />
                    </Box>
                  </Box>
                )}
              </Box>
            ))}
          </RadioGroup>
        </PdSection>
      )}

      {!editing && !plain && serving.length > 1 && (
        <PdSection
          heading="Replaces"
          helper="The new version takes traffic only from this one. The others keep theirs and stay after the rollout."
        >
          <RadioGroup
            aria-label="Version to replace"
            value={stable}
            onChange={e => {
              touch('replaces');
              setReplaces(e.target.value);
            }}
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
        </PdSection>
      )}

      {!plain && (
        <>
          <PdSection heading="Strategy" helper={strategyHelper}>
            <ToggleButtonGroup
              exclusive
              size="small"
              className={classes.strategies}
              value={strategy}
              aria-label="Strategy"
              onChange={(_e, next: RolloutStrategy | null) => {
                if (!next || editing) return;
                touch('strategy');
                setStrategy(next);
              }}
            >
              {STRATEGIES.map(kind => (
                <ToggleButton
                  key={kind}
                  value={kind}
                  disabled={
                    (editing && kind !== strategy) ||
                    unsupported.some(s => s.kind === kind)
                  }
                >
                  {STRATEGY_COPY[kind].name}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {!editing && unsupported.length > 0 && (
              <Typography variant="caption" color="textSecondary">
                {unsupported
                  .map(s => `${STRATEGY_COPY[s.kind].name}: ${s.reason}`)
                  .join('. ')}
                .
              </Typography>
            )}
          </PdSection>

          <RolloutOptionsFields
            strategy={strategy}
            value={rolloutOptions}
            onChange={o => {
              touch('options');
              setRolloutOptions(o);
            }}
            stableName={stable}
            matchProblem={matchProblem}
            support={support}
          />
        </>
      )}

      <PdSection
        heading="How requests flow"
        helper={
          plain
            ? plainCaption(
                traffic,
                firstEnvironment?.label,
                backendName,
                share,
                matchRule(plainMatch),
              )
            : savedCaption(editing, convert, firstEnvironment?.label)
        }
      >
        <PdBox>
          <Box className={classes.flow}>{flow}</Box>
        </PdBox>
      </PdSection>
    </>
  );

  const yaml = (
    <PdSection
      heading="Endpoint"
      helper={
        plain
          ? "The Endpoint's backendRefs as Save writes them. Read-only: change them with the form."
          : "The Endpoint's backendRefs and spec.rollout as Save writes them. Read-only: change them with the form."
      }
    >
      {saved ? (
        <YamlViewer
          value={endpointYaml(
            saved.backends,
            'rollout' in saved ? saved.rollout : undefined,
          )}
          maxHeight="none"
        />
      ) : (
        <Typography variant="body2" color="textSecondary">
          {component
            ? `${optionsProblem || 'Fill in the settings'} to see the YAML.`
            : 'Pick the new version to see the YAML.'}
        </Typography>
      )}
    </PdSection>
  );

  return (
    <DetailPageLayout
      title={pageTitle(editing, convert)}
      subtitle={pageSubtitle(editing, convert, traffic)}
      onBack={() => guard.leave(back)}
      actions={actions}
    >
      {!endpoint && !loadError && (
        <Box className={classes.loadingContainer}>
          <Skeleton variant="rect" width="100%" height={64} />
          <Skeleton variant="rect" width="100%" height={240} />
        </Box>
      )}
      {loadError && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setReload(n => n + 1)}
            >
              Retry
            </Button>
          }
        >
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
        <PdCard
          title={editing ? 'Rollout settings' : 'New backend'}
          mode={mode}
          onModeChange={setMode}
        >
          {mode === 'yaml' ? yaml : form}
        </PdCard>
      )}

      <UnsavedChangesDialog {...guard.dialog} changeCount={touched.size} />
    </DetailPageLayout>
  );
};
