import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Switch,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Skeleton } from '@openchoreo/backstage-design-system';
import {
  DetailPageLayout,
  ForbiddenState,
  useEndpointTrafficPermission,
} from '@openchoreo/backstage-plugin-react';
import {
  CHOREO_ANNOTATIONS,
  type EndpointBackendWeight,
  type EndpointEnvironment,
  type EndpointRule,
  type EndpointSummary,
  type EndpointVisibility,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../utils/errorUtils';
import { AutoDeployConfirmationDialog } from '../Environments/components/AutoDeployConfirmationDialog';
import {
  backendOptions,
  backendRowErrors,
  backendRowKey,
  EndpointBackendRows,
  type EndpointBackendOption,
  type EndpointBackendRow,
} from './EndpointBackendRows';
import { RulesEditorDialog } from './RulesEditorDialog';

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
    gap: theme.spacing(0.5),
  },
  label: { fontWeight: 600 },
  rows: { maxWidth: 640 },
}));

const VISIBILITIES: {
  value: EndpointVisibility;
  label: string;
  hint: string;
}[] = [
  {
    value: 'external',
    label: 'External',
    hint: 'Reachable from the internet through the public gateway',
  },
  {
    value: 'internal',
    label: 'Internal',
    hint: "Reachable from the organization's network",
  },
  {
    value: 'namespace',
    label: 'Namespace',
    hint: "In-cluster callers in the namespace, through the Endpoint's Service",
  },
];

const sameSet = <T,>(a: T[], b: T[]) =>
  a.length === b.length && a.every(x => b.includes(x));

const toRow = (b: EndpointBackendWeight): EndpointBackendRow => ({
  componentName: b.componentName,
  endpoint: b.endpoint,
  weight: b.weight,
  deployed: true,
});

const rowsKey = (rows: EndpointBackendRow[]) =>
  JSON.stringify(rows.map(r => [backendRowKey(r), r.weight]));

/**
 * The Endpoint's Configure & Deploy page, opened from the Set up tile. The
 * Configure Resource page's layout (DetailPageLayout): edit where the
 * Endpoint is reachable from, its versions and their weights, whether new
 * versions deploy on their own and, under Advanced, its routing rules.
 * Saving creates a new version of the routing and deploys it to the first
 * environment. Versions are locked while a rollout runs.
 */
export const EndpointConfigurePage = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const perm = useEndpointTrafficPermission();
  const project = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.PROJECT];
  const namespace = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE];

  const [endpoint, setEndpoint] = useState<EndpointSummary | null>(null);
  const [firstEnv, setFirstEnv] = useState<EndpointEnvironment | null>(null);
  const [options, setOptions] = useState<EndpointBackendOption[]>([]);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [visibility, setVisibility] = useState<EndpointVisibility[]>([]);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [rows, setRows] = useState<EndpointBackendRow[]>([]);
  const [rules, setRules] = useState<EndpointRule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [autoDeployAsk, setAutoDeployAsk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const back = useCallback(
    () => navigate('..', { relative: 'path' }),
    [navigate],
  );

  useEffect(() => {
    let ignore = false;
    Promise.all([
      client.fetchEndpoint(entity),
      client.fetchEndpointEnvironmentInfo(entity),
    ])
      .then(([summary, envs]) => {
        if (ignore) return;
        setEndpoint(summary);
        setFirstEnv(envs?.[0] ?? null);
        if (summary) {
          setVisibility(summary.visibility);
          setAutoDeploy(summary.autoDeploy);
          setRows(summary.backends.map(toRow));
          setRules(summary.rules);
        }
      })
      .catch(err => !ignore && setLoadError(err));
    return () => {
      ignore = true;
    };
  }, [client, entity]);

  useEffect(() => {
    if (!project || !namespace) return undefined;
    let ignore = false;
    client
      .fetchEndpointCandidates(namespace, project)
      .then(list => {
        if (!ignore) setOptions(backendOptions(list));
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [client, project, namespace]);

  const locked = Boolean(endpoint?.rollout);
  const versionChanged =
    Boolean(endpoint) &&
    rowsKey(rows) !== rowsKey(endpoint!.backends.map(toRow));

  // The backends as the API takes them; a kept one keeps its name.
  const newBackends = useMemo((): EndpointBackendWeight[] | undefined => {
    if (!endpoint || !versionChanged) return undefined;
    const saved = new Map(endpoint.backends.map(b => [backendRowKey(b), b]));
    return rows.map(r => ({
      ...saved.get(backendRowKey(r)),
      componentName: r.componentName,
      endpoint: r.endpoint,
      weight: r.weight,
    }));
  }, [endpoint, rows, versionChanged]);

  // Rules lose the backends that were removed; a rule left with none goes.
  const keptNames = new Set(
    (newBackends ?? endpoint?.backends ?? []).map(
      b => b.name ?? b.componentName,
    ),
  );
  const effectiveRules = rules
    .map(r => ({
      ...r,
      backends: r.backends.filter(b => keptNames.has(b.name)),
      mirrors: r.mirrors?.filter(m => keptNames.has(m.backend)),
    }))
    .filter(r => r.backends.length > 0);
  const prunedRules = rules
    .filter(
      r =>
        JSON.stringify(r) !==
        JSON.stringify(effectiveRules.find(e => e.name === r.name)),
    )
    .map(r => r.name);

  const settingsChanged =
    Boolean(endpoint) &&
    (!sameSet(visibility, endpoint!.visibility) ||
      autoDeploy !== endpoint!.autoDeploy);
  const rulesChanged =
    Boolean(endpoint) &&
    JSON.stringify(effectiveRules) !== JSON.stringify(endpoint!.rules);
  const hasChanges = versionChanged || settingsChanged || rulesChanged;

  // The server refuses removing a backend that still gets traffic in the
  // saved version: it has to go to 0% first so environments can drain.
  const removedWithTraffic = (endpoint?.backends ?? []).filter(
    b => b.weight > 0 && !rows.some(r => backendRowKey(r) === backendRowKey(b)),
  );
  const rowErrors = versionChanged
    ? [
        ...backendRowErrors(rows),
        ...removedWithTraffic.map(
          b =>
            `Set ${b.componentName} to 0 and save before removing it, so its traffic drains first`,
        ),
      ]
    : [];

  const save = async () => {
    if (!endpoint) return;
    setSaving(true);
    setSaveError(null);
    try {
      let latest: string | undefined;
      if (settingsChanged) {
        const res = await client.updateEndpointSettings(entity, {
          visibility,
          autoDeploy,
        });
        latest = res.latestRelease ?? latest;
      }
      if (rulesChanged) {
        const res = await client.updateEndpointRules(
          entity,
          effectiveRules,
          newBackends,
        );
        latest = res.latestRelease ?? latest;
      } else if (versionChanged && newBackends) {
        const res = await client.updateEndpointTraffic(entity, newBackends);
        latest = res.latestRelease ?? latest;
      }
      // With auto deploy on, the controller deploys the new version to the
      // first environment itself.
      if (latest && !autoDeploy && firstEnv) {
        await client.updateEndpointReleaseBinding(
          entity,
          firstEnv.name,
          latest,
        );
      }
      back();
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (isForbiddenError(loadError)) {
    return (
      <ForbiddenState
        message="You do not have permission to configure this endpoint."
        minHeight="400px"
      />
    );
  }

  const denied = !perm.loading && !perm.canChangeTraffic;
  let saveTooltip = hasChanges ? '' : 'Nothing changed';
  if (rowErrors.length > 0) saveTooltip = rowErrors[0];
  if (denied) saveTooltip = perm.deniedTooltip;
  const actions = endpoint && (
    <Tooltip title={saveTooltip}>
      <span>
        <Button
          variant="contained"
          color="primary"
          disabled={
            saving ||
            denied ||
            !hasChanges ||
            visibility.length === 0 ||
            rowErrors.length > 0
          }
          startIcon={
            saving ? <CircularProgress size={20} color="inherit" /> : undefined
          }
          onClick={() => void save()}
        >
          {saving ? 'Saving' : 'Save & Deploy'}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <DetailPageLayout
      title="Configure Endpoint"
      subtitle={`Change how ${
        endpoint?.name ?? 'the Endpoint'
      } routes traffic. Saving creates a new version of the routing${
        firstEnv ? ` and deploys it to ${firstEnv.displayName}` : ''
      }.`}
      onBack={back}
      actions={actions}
    >
      {!endpoint && !loadError && (
        <Box className={classes.loadingContainer}>
          <Skeleton variant="rect" width="100%" height={64} />
          <Skeleton variant="rect" width="100%" height={120} />
        </Box>
      )}
      {loadError && (
        <Alert severity="error">
          Failed to load the endpoint: {getErrorMessage(loadError)}
        </Alert>
      )}
      {saveError && (
        <Box mb={2}>
          <Alert severity="error" onClose={() => setSaveError(null)}>
            {saveError}
          </Alert>
        </Box>
      )}

      {endpoint && (
        <Box className={classes.formCard}>
          {endpoint.problem && (
            <Alert severity="warning">
              Degraded: {endpoint.problem}. Environments keep their last good
              route.
            </Alert>
          )}

          <Box className={classes.field}>
            <Typography variant="body2" className={classes.label}>
              Reachable from
            </Typography>
            <Box display="flex" flexWrap="wrap">
              {VISIBILITIES.map(v => (
                <Tooltip key={v.value} title={v.hint}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        color="primary"
                        checked={visibility.includes(v.value)}
                        onChange={() =>
                          setVisibility(prev =>
                            prev.includes(v.value)
                              ? prev.filter(x => x !== v.value)
                              : [...prev, v.value],
                          )
                        }
                      />
                    }
                    label={v.label}
                  />
                </Tooltip>
              ))}
            </Box>
            {visibility.length === 0 && (
              <Typography variant="caption" color="error">
                Pick at least one.
              </Typography>
            )}
          </Box>

          <Box className={classes.field}>
            <Typography variant="body2" className={classes.label}>
              {rows.length > 1 ? 'Versions and their weights' : 'Version'}
            </Typography>
            <Box className={classes.rows}>
              <EndpointBackendRows
                rows={rows}
                options={options}
                onChange={setRows}
                disabled={locked}
              />
            </Box>
            {locked ? (
              <Typography variant="caption" color="textSecondary">
                A rollout to {endpoint.rollout!.candidate} is running. Finish or
                abandon it on the Rollout tab to change versions.
              </Typography>
            ) : (
              <Typography variant="caption" color="textSecondary">
                Environments get this split when they deploy the new version,
                unless their weights were set by hand. To move traffic to a new
                version step by step, use the Rollout tab.
              </Typography>
            )}
            {rowErrors.map(e => (
              <Typography key={e} variant="caption" color="error">
                {e}
              </Typography>
            ))}
            {versionChanged && prunedRules.length > 0 && (
              <Typography variant="caption" color="textSecondary">
                {prunedRules.join(', ')}{' '}
                {prunedRules.length === 1 ? 'loses' : 'lose'} the removed
                versions; a rule left with none is removed.
              </Typography>
            )}
          </Box>

          <Box className={classes.field}>
            <Typography variant="body2" className={classes.label}>
              Deploy changes automatically
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  color="primary"
                  checked={autoDeploy}
                  onChange={e => setAutoDeployAsk(e.target.checked)}
                />
              }
              label="Deploy each new version to the first environment"
            />
          </Box>

          <Box className={classes.field}>
            <Typography variant="body2" className={classes.label}>
              Advanced · Routing rules
            </Typography>
            <Box display="flex" alignItems="center" gridGap={16}>
              <Typography variant="body2" color="textSecondary">
                {effectiveRules.length === 0
                  ? 'No rules. Every request follows the split above.'
                  : `${effectiveRules.length} rule${
                      effectiveRules.length === 1 ? '' : 's'
                    }, first match wins.`}
              </Typography>
              <Button
                variant="outlined"
                color="primary"
                size="small"
                onClick={() => setRulesOpen(true)}
              >
                Edit routing rules
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {endpoint && (
        <RulesEditorDialog
          open={rulesOpen}
          endpointName={endpoint.name}
          backends={newBackends ?? endpoint.backends}
          rules={effectiveRules}
          onClose={() => setRulesOpen(false)}
          onSave={async next => {
            // Kept on the page; Save & Deploy writes everything at once.
            setRules(next);
            setRulesOpen(false);
            return { changed: true };
          }}
        />
      )}
      <AutoDeployConfirmationDialog
        open={autoDeployAsk !== null}
        isEnabling={autoDeployAsk === true}
        isUpdating={false}
        onCancel={() => setAutoDeployAsk(null)}
        onConfirm={() => {
          setAutoDeploy(Boolean(autoDeployAsk));
          setAutoDeployAsk(null);
        }}
      />
    </DetailPageLayout>
  );
};
