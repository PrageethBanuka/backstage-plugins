import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert, Skeleton } from '@material-ui/lab';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import YAML from 'yaml';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { useAsyncEntity, useEntity } from '@backstage/plugin-catalog-react';
import type { FormYamlMode } from '@openchoreo/backstage-design-system';
import {
  ChangesList,
  DetailPageLayout,
  ForbiddenState,
  UnsavedChangesDialog,
  YamlEditor,
  useEndpointReleaseBindingUpdatePermission,
  type Change,
} from '@openchoreo/backstage-plugin-react';
import {
  CHOREO_ANNOTATIONS,
  effectiveWeights,
  nextRolloutStage,
  rolloutStages,
  rolloutStepProblem,
  rolloutWeights,
  NO_ROLLOUT_TRAFFIC,
  type EndpointBackendWeight,
  type EndpointRollout,
  type EndpointWeightOverride,
  type RolloutStrategy,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../../utils/errorUtils';
import {
  toPdEnv,
  type EndpointEnvironment,
  type EndpointSummary,
} from './pdTypes';
import {
  inRollout,
  previewCommand,
  requestedPercent,
  servedSplit,
  STRATEGY_COPY,
} from './endpointRolloutUi';
import { roleColor, type RolloutRole } from './endpointUi';
import { StrategyFlow, toFlowVersion } from './StrategyFlow';
import { shareName, stageAction, stageName } from './rolloutCopy';
import { RolloutStepTrack } from './RolloutStepTrack';
import { PdBox, PdCard, PdSection, PendingChip } from './pdLayout';
import { useUnsavedGuard } from './useUnsavedGuard';

/** What the control on Configure sets, in the Edit weight dialog's words. */
const CONTROL_LABEL = 'Traffic share';

/** What hand-written overrides must keep, by strategy. */
const YAML_RULE: Record<RolloutStrategy, string> = {
  canary: 'A share that is no step shows as set by hand.',
  blueGreen:
    'Blue/green has no split: the new version gets all of Current’s weight or none.',
  abTest:
    'An A/B test has no split: the new version gets all of Current’s weight or none.',
  mirror: 'The new version keeps weight 0; mirror.percent sets the copy.',
};

const nameOf = (b: { name?: string; componentName: string }) =>
  b.name ?? b.componentName;

const useStyles = makeStyles(theme => ({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  spacer: { flex: 1 },
  status: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    height: 32,
    padding: theme.spacing(0, 1.5),
    borderRadius: 16,
    backgroundColor: theme.palette.action.selected,
    color: theme.palette.primary.dark,
    fontSize: 13,
    fontWeight: 500,
  },
  slider: {
    padding: theme.spacing(1, 1.5, 0),
  },
  command: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    minHeight: 52,
    padding: theme.spacing(0, 1.25, 0, 2),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    backgroundColor: theme.palette.background.default,
  },
  commandText: {
    flex: 1,
    minWidth: 0,
    overflowX: 'auto',
    whiteSpace: 'pre',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
  },
  role: {
    flexShrink: 0,
    padding: theme.spacing(0.25, 1.25),
    borderRadius: 16,
    border: `1px solid ${theme.palette.divider}`,
    fontSize: 12,
  },
  yaml: {
    minHeight: 320,
    display: 'flex',
    flexDirection: 'column',
  },
}));

/**
 * The plan's steps as slider marks. The environment's own share is marked
 * "now"; a step within 8% of the one before, or within 10% of "now", goes
 * unlabelled so labels never overlap. Any share between steps can still be
 * picked, which sets it by hand.
 */
export function stepMarks(
  rollout: EndpointRollout,
  now: number,
): { value: number; label?: string }[] {
  const stops = rolloutStages(rollout).map(st => st.percent);
  const marks = stops.map((p, i) => {
    const spaced = i === 0 || p - stops[i - 1] >= 8 || p === 100;
    const clearOfNow = p === now || Math.abs(p - now) >= 10;
    const name = stageName(rollout, p);
    return { value: p, label: spaced && clearOfNow ? name : undefined };
  });
  if (!stops.includes(now)) marks.push({ value: now, label: undefined });
  return marks.map(m =>
    m.value === now ? { ...m, label: `${stageName(rollout, now)} · now` } : m,
  );
}

/** Why a share can't be set in an environment, or undefined when it can. */
function stepProblem(
  env: EndpointEnvironment,
  endpoint: EndpointSummary,
  rollout: EndpointRollout,
  share: number,
): string | undefined {
  return rolloutStepProblem(
    rollout,
    servedSplit(env, endpoint).map(nameOf),
    share,
    effectiveWeights(endpoint.backends, env.overrides),
  );
}

/**
 * The overrides a share writes, or the ones the environment has now (also
 * when the share can't be written, see {@link stepProblem}).
 */
function overridesFor(
  env: EndpointEnvironment,
  endpoint: EndpointSummary,
  rollout: EndpointRollout,
  share: number,
  current: number,
): EndpointWeightOverride[] {
  if (
    (share === current && env.overrides.length > 0) ||
    stepProblem(env, endpoint, rollout, share)
  )
    return env.overrides;
  return rolloutWeights(
    rollout,
    servedSplit(env, endpoint).map(nameOf),
    share,
    effectiveWeights(endpoint.backends, env.overrides),
  );
}

function bindingYaml(
  env: EndpointEnvironment,
  namespace: string | undefined,
  overrides: EndpointWeightOverride[],
): string {
  return YAML.stringify({
    apiVersion: 'openchoreo.dev/v1alpha1',
    kind: 'EndpointReleaseBinding',
    metadata: { name: env.bindingName, namespace },
    spec: {
      environment: env.name,
      endpointRelease: env.endpointRelease,
      backendOverrides: overrides,
    },
  });
}

/** Reads backendOverrides from edited YAML, or says what is wrong with it. */
export function parseOverrides(
  text: string,
): { overrides: EndpointWeightOverride[] } | { error: string } {
  let doc: { spec?: { backendOverrides?: unknown } } | null;
  try {
    doc = YAML.parse(text);
  } catch (err: unknown) {
    return { error: `Not valid YAML: ${getErrorMessage(err)}` };
  }
  const list = doc?.spec?.backendOverrides;
  if (!Array.isArray(list)) {
    return { error: 'spec.backendOverrides must be a list' };
  }
  for (const o of list as EndpointWeightOverride[]) {
    if (typeof o?.name !== 'string' || !o.name) {
      return { error: 'Each override needs a name' };
    }
    if (
      o.weight !== undefined &&
      (!Number.isInteger(o.weight) || o.weight < 0 || o.weight > 1_000_000)
    ) {
      return {
        error: `${o.name}: weight must be a whole number from 0 to 1000000`,
      };
    }
    if (o.weight === undefined && o.mirror === undefined) {
      return { error: `${o.name}: set a weight or a mirror` };
    }
  }
  return {
    overrides: (list as EndpointWeightOverride[]).map(o => ({
      name: o.name,
      ...(o.weight !== undefined && { weight: o.weight }),
      ...(o.mirror !== undefined && { mirror: o.mirror }),
    })),
  };
}

/** The overrides laid over the Endpoint's own weights and mirrors. */
function effective(
  backends: EndpointBackendWeight[],
  overrides: EndpointWeightOverride[],
): Map<string, { weight: number; mirror?: number }> {
  const out = new Map(
    backends.map(b => [
      nameOf(b),
      { weight: b.weight, mirror: b.mirror?.percent },
    ]),
  );
  for (const o of overrides) {
    const at = out.get(o.name);
    if (!at) continue;
    if (o.weight !== undefined) at.weight = o.weight;
    if (o.mirror) at.mirror = o.mirror.percent;
  }
  return out;
}

/** The new version's share the overrides give, as the form shows it. */
export function overridesShare(
  rollout: EndpointRollout,
  backends: EndpointBackendWeight[],
  overrides: EndpointWeightOverride[],
): number {
  const at = effective(backends, overrides);
  if (rollout.strategy === 'mirror')
    return at.get(rollout.candidate)?.mirror ?? 0;
  const candidate = at.get(rollout.candidate)?.weight ?? 0;
  const pair = candidate + (at.get(rollout.stable)?.weight ?? 0);
  return pair > 0 ? Math.round((candidate / pair) * 100) : 0;
}

/**
 * Why hand-written overrides break the running strategy, or undefined. Any
 * weights are valid on the binding, but in the portal they must keep the
 * strategy's meaning: blue/green and A/B serve the new version to nobody
 * beyond its match or to everyone, and a mirror's new version answers no one.
 */
export function overridesProblem(
  rollout: EndpointRollout,
  backends: EndpointBackendWeight[],
  overrides: EndpointWeightOverride[],
): string | undefined {
  const names = new Set(backends.map(nameOf));
  const seen = new Set<string>();
  for (const o of overrides) {
    if (!names.has(o.name))
      return `${o.name} is not a backend of this Endpoint`;
    if (seen.has(o.name)) return `${o.name} is listed twice`;
    seen.add(o.name);
    if (o.mirror) {
      if (rollout.strategy !== 'mirror' || o.name !== rollout.candidate) {
        return `Only ${rollout.candidate} gets a mirror, and only in a mirror rollout`;
      }
      const m = o.mirror.percent;
      if (!Number.isInteger(m) || m < 0 || m > 100) {
        return `${o.name}: mirror.percent must be a whole number from 0 to 100`;
      }
    }
  }
  const at = effective(backends, overrides);
  const candidate = at.get(rollout.candidate)?.weight ?? 0;
  const pair = candidate + (at.get(rollout.stable)?.weight ?? 0);
  switch (rollout.strategy) {
    case 'mirror':
      return candidate > 0
        ? `${rollout.candidate} answers no one in a mirror: keep its weight 0 and set mirror.percent`
        : undefined;
    case 'blueGreen':
    case 'abTest':
      return candidate > 0 && candidate < pair
        ? `${STRATEGY_COPY[rollout.strategy].name} has no split: give ${
            rollout.candidate
          } all of ${rollout.stable}'s weight or none`
        : undefined;
    default:
      return undefined;
  }
}

/** Whether the form can show these overrides: its share writes the same traffic. */
export function formShows(
  backends: EndpointBackendWeight[],
  overrides: EndpointWeightOverride[],
  form: EndpointWeightOverride[],
): boolean {
  const shares = (list: EndpointWeightOverride[]) => {
    const at = effective(backends, list);
    const total = [...at.values()].reduce((n, b) => n + b.weight, 0);
    return new Map(
      [...at].map(([name, b]) => [
        name,
        {
          weight: total > 0 ? (b.weight / total) * 100 : 0,
          mirror: b.mirror ?? 0,
        },
      ]),
    );
  };
  const a = shares(overrides);
  const b = shares(form);
  return [...a].every(([name, x]) => {
    const y = b.get(name)!;
    return Math.abs(x.weight - y.weight) < 0.5 && x.mirror === y.mirror;
  });
}

/**
 * Configure traffic: one environment's traffic in a running rollout, on a
 * page like the environment overrides page. The control picks where the
 * environment should be; nothing moves until Save, which always asks first.
 * The YAML view shows the binding Save writes, and its backendOverrides can
 * be edited by hand.
 */
export const ConfigureTrafficPage = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const { envName = '' } = useParams<{ envName: string }>();
  const { entity } = useEntity();
  const { refresh: refreshEntity } = useAsyncEntity();
  const client = useApi(openChoreoClientApiRef);
  const namespace = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE];
  const perm = useEndpointReleaseBindingUpdatePermission(envName);

  const [endpoint, setEndpoint] = useState<EndpointSummary | null>(null);
  const [envs, setEnvs] = useState<EndpointEnvironment[]>([]);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [mode, setMode] = useState<FormYamlMode>('form');
  const [yamlText, setYamlText] = useState('');
  const [yamlDirty, setYamlDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [switchNote, setSwitchNote] = useState<string | null>(null);

  const back = useCallback(
    () => navigate('../..', { relative: 'path' }),
    [navigate],
  );

  useEffect(() => {
    let ignore = false;
    setLoadError(null);
    Promise.all([
      client.fetchEndpointRollout(entity),
      client.fetchEndpointEnvironmentInfo(entity),
    ])
      .then(([summary, info]) => {
        if (ignore) return;
        setEndpoint(summary);
        setEnvs(info.map(e => toPdEnv(e, summary)));
      })
      .catch(err => !ignore && setLoadError(err));
    return () => {
      ignore = true;
    };
  }, [client, entity, reload]);

  const env = envs.find(e => e.name === envName);
  const rollout = endpoint?.rollout;
  const percent = env?.rollout?.percent ?? 0;
  const share = target ?? percent;
  const pending = share !== percent;
  const guard = useUnsavedGuard(pending || yamlDirty);
  const leave = () => guard.leave(back);

  const formOverrides = useMemo(
    () =>
      env && endpoint && rollout
        ? overridesFor(env, endpoint, rollout, share, percent)
        : [],
    [env, endpoint, rollout, share, percent],
  );

  // Like the other FORM | YAML cards: YAML edits carry over to the form, and
  // YAML that does not parse keeps you in YAML until it is fixed.
  // Weights the form cannot show (other backends moved) keep you in YAML too.
  const switchMode = (next: FormYamlMode) => {
    if (next === mode || !env || !endpoint || !rollout) return;
    if (next === 'yaml') {
      setYamlText(bindingYaml(env, namespace, formOverrides));
    } else if (yamlDirty) {
      const parsed = parseOverrides(yamlText);
      if ('error' in parsed) return;
      if (overridesProblem(rollout, endpoint.backends, parsed.overrides))
        return;
      const yamlShare = overridesShare(
        rollout,
        endpoint.backends,
        parsed.overrides,
      );
      const form = overridesFor(env, endpoint, rollout, yamlShare, percent);
      if (!formShows(endpoint.backends, parsed.overrides, form)) {
        setSwitchNote(
          'These weights also move backends outside the rollout, which the form cannot show. Save them from YAML, or undo that change.',
        );
        return;
      }
      setTarget(yamlShare);
    }
    setSwitchNote(null);
    setYamlDirty(false);
    setMode(next);
  };

  if (isForbiddenError(loadError)) {
    return (
      <ForbiddenState
        message="You do not have permission to view this endpoint's traffic."
        minHeight="400px"
      />
    );
  }

  const title = `Configure Traffic — ${env?.displayName ?? envName}`;
  if (!endpoint || !env || !rollout) {
    return (
      <DetailPageLayout title={title} onBack={back}>
        {loadError ? (
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
            Failed to load the rollout: {getErrorMessage(loadError)}
          </Alert>
        ) : (
          <>
            {endpoint && !rollout && (
              <Alert severity="info">
                No rollout is running on this Endpoint.
              </Alert>
            )}
            {endpoint && rollout && !env && (
              <Alert severity="info">This Endpoint is not in {envName}.</Alert>
            )}
            {!endpoint && (
              <Box className={classes.page}>
                <Skeleton variant="rect" width="100%" height={64} />
                <Skeleton variant="rect" width="100%" height={240} />
              </Box>
            )}
          </>
        )}
      </DetailPageLayout>
    );
  }

  const strategy = rollout.strategy;
  const here = inRollout(env, rollout);
  const previous = envs[envs.indexOf(env) - 1];
  const stepped = strategy === 'canary' || strategy === 'mirror';
  const next = nextRolloutStage(
    rollout,
    env.rollout ?? { index: 0, percent: 0, manual: false },
  );
  const requested = requestedPercent(env, rollout);
  const applying = requested !== undefined && requested !== percent;
  const manual = Boolean(env.rollout?.manual);
  const atLast = stepped && !next && percent > 0;
  const candidate = rollout.candidate;

  const yamlParsed = mode === 'yaml' ? parseOverrides(yamlText) : null;
  let yamlError: string | undefined;
  if (yamlParsed && 'error' in yamlParsed) yamlError = yamlParsed.error;
  else if (yamlParsed) {
    yamlError = overridesProblem(
      rollout,
      endpoint.backends,
      yamlParsed.overrides,
    );
  }
  const named = (p: number) => shareName(rollout, p);

  // Stable and the candidate get no traffic here, so only 0 can be saved.
  const pairOff =
    stepProblem(env, endpoint, rollout, 100) === NO_ROLLOUT_TRAFFIC;
  const problem =
    mode === 'form' && pending
      ? stepProblem(env, endpoint, rollout, share)
      : undefined;
  let locked = '';
  if (!perm.loading && !perm.canUpdate) locked = perm.deniedTooltip;
  else if (applying) locked = 'Wait until the last change is applied';
  const disabled = Boolean(locked) || saving;
  let blocked = locked;
  if (!blocked && mode === 'yaml' && yamlError) blocked = yamlError;
  else if (!blocked && problem) blocked = `In ${env.name}, ${problem}`;
  else if (!blocked && (mode === 'yaml' ? !yamlDirty : !pending))
    blocked = 'Nothing to save';

  const flowVersion = (name: string, role: RolloutRole) =>
    toFlowVersion(
      endpoint.backends.find(b => nameOf(b) === name) ?? {
        componentName: name,
      },
      roleColor(role),
    );

  const changes: Change[] =
    mode === 'yaml' && yamlParsed && 'overrides' in yamlParsed
      ? yamlParsed.overrides.map(o => {
          const before = env.overrides.find(b => b.name === o.name);
          return {
            path: o.name,
            type: before ? 'modified' : 'new',
            oldValue: before?.weight ?? before?.mirror?.percent,
            newValue: o.weight ?? o.mirror?.percent,
          };
        })
      : [
          {
            path: CONTROL_LABEL,
            type: 'modified',
            oldValue: named(percent),
            newValue: named(share),
          },
        ];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (mode === 'yaml' && yamlParsed && 'overrides' in yamlParsed) {
        await client.updateEndpointOverrides(
          entity,
          env.name,
          yamlParsed.overrides,
        );
      } else {
        await client.setRolloutStage(entity, env.name, share);
      }
      [0, 3000].forEach(ms => setTimeout(() => refreshEntity?.(), ms));
      guard.pass(back);
    } catch (err: unknown) {
      setError(
        isForbiddenError(err)
          ? 'You do not have permission to perform this action. Contact your administrator.'
          : getErrorMessage(err),
      );
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string, what: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(what))
      .catch(() => undefined);
  };

  const backTo = 0;
  let forward: number | undefined = next?.percent;
  if (!stepped) forward = percent >= 100 ? 0 : 100;
  const forwardLabel =
    forward === undefined ? 'Next step' : stageAction(rollout, forward);

  const preview = previewCommand(rollout, env.invokeURL);
  const commands: { text: string; reaches: string }[] = [];
  if (preview) commands.push({ text: preview, reaches: 'New' });
  if (env.invokeURL)
    commands.push({ text: `curl ${env.invokeURL}`, reaches: 'Current' });

  const actions = (
    <Tooltip title={blocked} disableHoverListener={!blocked}>
      <span>
        <Button
          variant="contained"
          color="primary"
          disabled={Boolean(blocked) || perm.loading || saving}
          onClick={() => setConfirming(true)}
          startIcon={
            saving ? <CircularProgress size={20} color="inherit" /> : undefined
          }
        >
          {saving ? 'Saving' : 'Save Overrides'}
        </Button>
      </span>
    </Tooltip>
  );

  const control = (
    <PdSection heading={CONTROL_LABEL}>
      {pairOff && (
        <Alert severity="warning">
          {rollout.stable} and {rollout.candidate} get no traffic in{' '}
          {env.displayName}, so a step would take it from the other backends.
          Give {rollout.stable} a weight first.
        </Alert>
      )}
      {atLast && (
        <Alert severity="info">
          At the last step. Remove the current version from Set up to finish.
        </Alert>
      )}
      <Box className={classes.actions}>
        {(!stepped || forward !== undefined) && (
          <Button
            variant={pending && share === forward ? 'contained' : 'outlined'}
            color="primary"
            disabled={disabled || share === forward}
            onClick={() => setTarget(forward ?? percent)}
          >
            {forwardLabel}
          </Button>
        )}
        {stepped && (percent > 0 || share > 0) && (
          <Button
            variant="outlined"
            disabled={disabled || share === backTo}
            onClick={() => setTarget(backTo)}
          >
            {stageAction(rollout, backTo)}
          </Button>
        )}
        <span className={classes.spacer} />
        {applying && (
          <span className={classes.status} role="status">
            <CircularProgress size={14} />
            Progressing: {named(percent)} → {named(requested!)}
          </span>
        )}
        {!applying && manual && !pending && (
          <span className={classes.status}>{named(percent)} · set by hand</span>
        )}
        {pending && <PendingChip from={named(percent)} to={named(share)} />}
      </Box>
      {stepped ? (
        <Box className={classes.slider}>
          <Slider
            value={share}
            min={0}
            max={100}
            step={1}
            valueLabelDisplay="auto"
            valueLabelFormat={v => stageName(rollout, v)}
            marks={stepMarks(rollout, percent)}
            disabled={disabled}
            onChange={(_e, v) => setTarget(v as number)}
            aria-label={CONTROL_LABEL}
          />
        </Box>
      ) : (
        <RolloutStepTrack
          rollout={rollout}
          position={env.rollout}
          target={pending ? share : undefined}
        />
      )}
    </PdSection>
  );

  return (
    <DetailPageLayout
      title={title}
      subtitle={`Set ${env.displayName}-specific traffic for this binding only.`}
      onBack={leave}
      actions={here ? actions : undefined}
    >
      <Box className={classes.page}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <PdCard
          title="Traffic"
          chip={STRATEGY_COPY[strategy].name}
          mode={here ? mode : undefined}
          onModeChange={switchMode}
        >
          {!here && (
            <PdSection heading={CONTROL_LABEL}>
              <Alert severity="info">
                Not deployed.{' '}
                {previous
                  ? `Promote it from ${previous.displayName} first.`
                  : 'Deploy the release from Set up first.'}
              </Alert>
            </PdSection>
          )}
          {here && mode === 'yaml' && (
            <PdSection
              heading="EndpointReleaseBinding"
              helper={`${env.displayName}'s binding as Save writes it. Only spec.backendOverrides is saved. ${YAML_RULE[strategy]}`}
            >
              <Box className={classes.yaml}>
                {switchNote && (
                  <Box mb={2}>
                    <Alert
                      severity="warning"
                      onClose={() => setSwitchNote(null)}
                    >
                      {switchNote}
                    </Alert>
                  </Box>
                )}
                <YamlEditor
                  content={yamlText}
                  onChange={text => {
                    setYamlText(text);
                    setYamlDirty(true);
                    setSwitchNote(null);
                  }}
                  errorText={yamlError}
                  isDirty={yamlDirty}
                />
              </Box>
            </PdSection>
          )}
          {here && mode === 'form' && (
            <>
              {control}
              <PdSection
                heading={
                  pending ? 'How requests flow after Save' : 'How requests flow'
                }
              >
                <PdBox>
                  <StrategyFlow
                    strategy={strategy}
                    preview={rollout.preview}
                    percent={share}
                    current={flowVersion(rollout.stable, 'Current')}
                    next={flowVersion(candidate, 'New')}
                  />
                </PdBox>
              </PdSection>
              {commands.length > 0 && (
                <PdSection
                  heading="Invoke URLs"
                  helper={
                    strategy === 'mirror'
                      ? 'The new version answers nobody, so check its logs to see the copies arrive.'
                      : 'Anyone who sends the header reaches the new version. It is not access control.'
                  }
                >
                  <Box display="flex" flexDirection="column" gridGap={8}>
                    {commands
                      .filter(
                        c => strategy !== 'mirror' || c.reaches === 'Current',
                      )
                      .map(c => (
                        <Box key={c.reaches} className={classes.command}>
                          <span className={classes.commandText}>{c.text}</span>
                          <Typography
                            component="span"
                            className={classes.role}
                            color={
                              c.reaches === 'Current'
                                ? 'textSecondary'
                                : 'primary'
                            }
                          >
                            {c.reaches}
                          </Typography>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={
                              <FileCopyOutlinedIcon fontSize="small" />
                            }
                            aria-label={`Copy the command for ${c.reaches}`}
                            onClick={() => copy(c.text, c.reaches)}
                          >
                            {copied === c.reaches ? 'Copied' : 'Copy'}
                          </Button>
                        </Box>
                      ))}
                  </Box>
                </PdSection>
              )}
            </>
          )}
        </PdCard>
      </Box>

      <Dialog
        open={confirming}
        onClose={() => !saving && setConfirming(false)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="confirm-traffic-title"
      >
        <DialogTitle id="confirm-traffic-title">
          Confirm Save Changes ({changes.length}{' '}
          {changes.length === 1 ? 'change' : 'changes'})
        </DialogTitle>
        <DialogContent dividers>
          <ChangesList
            sections={[{ title: 'Traffic', changes }]}
            emptyMessage="No changes to save"
          />
          <Typography
            variant="body2"
            color="textSecondary"
            style={{ marginTop: 16 }}
          >
            This moves traffic in the <strong>{env.displayName}</strong>{' '}
            environment only. Other environments keep their step.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving...' : 'Confirm Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <UnsavedChangesDialog {...guard.dialog} changeCount={changes.length} />
    </DetailPageLayout>
  );
};
