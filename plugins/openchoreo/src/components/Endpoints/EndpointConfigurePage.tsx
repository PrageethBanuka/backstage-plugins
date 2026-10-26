import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { Alert } from '@material-ui/lab';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef, useEntity } from '@backstage/plugin-catalog-react';
import { Skeleton } from '@openchoreo/backstage-design-system';
import {
  DetailPageLayout,
  ForbiddenState,
  useEndpointTrafficPermission,
} from '@openchoreo/backstage-plugin-react';
import {
  CHOREO_ANNOTATIONS,
  type EndpointEnvironment,
  type EndpointRule,
  type EndpointSummary,
  type EndpointVisibility,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../utils/errorUtils';
import { AutoDeployConfirmationDialog } from '../Environments/components/AutoDeployConfirmationDialog';
import { RulesEditorDialog } from './RulesEditorDialog';
import { TrafficSplitBar } from './TrafficSplitBar';

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
  pair: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
    gap: theme.spacing(2),
    maxWidth: 640,
    [theme.breakpoints.down('xs')]: { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
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

/**
 * The Endpoint's Configure & Deploy page, opened from the Set up tile. The
 * Configure Resource page's layout (DetailPageLayout): edit where the
 * Endpoint is reachable from, its version, whether new versions deploy on
 * their own and, under Advanced, its routing rules. Saving creates a new
 * version of the routing and deploys it to the first environment.
 */
export const EndpointConfigurePage = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const catalogApi = useApi(catalogApiRef);
  const perm = useEndpointTrafficPermission();
  const project = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.PROJECT];
  const namespace = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE];

  const [endpoint, setEndpoint] = useState<EndpointSummary | null>(null);
  const [firstEnv, setFirstEnv] = useState<EndpointEnvironment | null>(null);
  const [components, setComponents] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [visibility, setVisibility] = useState<EndpointVisibility[]>([]);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [component, setComponent] = useState('');
  const [endpointKey, setEndpointKey] = useState('');
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
          setComponent(summary.backends[0]?.componentName ?? '');
          setEndpointKey(summary.backends[0]?.endpoint ?? '');
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
    catalogApi
      .getEntities({
        filter: {
          kind: 'Component',
          'spec.system': project,
          'metadata.namespace': namespace,
        },
        fields: ['metadata.name'],
      })
      .then(res => {
        if (!ignore) setComponents(res.items.map(e => e.metadata.name).sort());
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [catalogApi, project, namespace]);

  const single = (endpoint?.backends.length ?? 0) <= 1;
  const versionChanged =
    single &&
    Boolean(endpoint) &&
    (component !== (endpoint!.backends[0]?.componentName ?? '') ||
      endpointKey !== (endpoint!.backends[0]?.endpoint ?? ''));
  const settingsChanged =
    Boolean(endpoint) &&
    (!sameSet(visibility, endpoint!.visibility) ||
      autoDeploy !== endpoint!.autoDeploy);
  const rulesChanged =
    Boolean(endpoint) &&
    JSON.stringify(rules) !== JSON.stringify(endpoint!.rules);
  const hasChanges = versionChanged || settingsChanged || rulesChanged;

  const newBackends = useMemo(
    () =>
      endpoint && single && component && endpointKey
        ? [
            {
              ...endpoint.backends[0],
              componentName: component,
              endpoint: endpointKey,
              weight: 100,
            },
          ]
        : undefined,
    [endpoint, single, component, endpointKey],
  );

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
          rules,
          versionChanged ? newBackends : undefined,
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
  if (denied) saveTooltip = perm.deniedTooltip;
  const actions = endpoint && (
    <Tooltip title={saveTooltip}>
      <span>
        <Button
          variant="contained"
          color="primary"
          disabled={saving || denied || !hasChanges || visibility.length === 0}
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
              Version
            </Typography>
            {single ? (
              <>
                <Box className={classes.pair}>
                  <TextField
                    id="endpoint-version-component"
                    select
                    size="small"
                    variant="outlined"
                    label="Component"
                    value={component}
                    onChange={e => setComponent(e.target.value)}
                  >
                    {[...new Set([component, ...components])]
                      .filter(Boolean)
                      .map(c => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                  </TextField>
                  <TextField
                    id="endpoint-version-endpoint"
                    size="small"
                    variant="outlined"
                    label="Its endpoint"
                    value={endpointKey}
                    onChange={e => setEndpointKey(e.target.value)}
                  />
                </Box>
                <Typography variant="caption" color="textSecondary">
                  This version gets all traffic. To move traffic to a new
                  version step by step, use the Rollout tab.
                </Typography>
              </>
            ) : (
              <>
                <Box maxWidth={480}>
                  <TrafficSplitBar backends={endpoint.backends} showLegend />
                </Box>
                <Typography variant="caption" color="textSecondary">
                  This Endpoint splits traffic between{' '}
                  {endpoint.backends.length} versions. Change the split from the
                  Rollout tab.
                </Typography>
              </>
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
                {rules.length === 0
                  ? 'No rules. Every request goes to the version above.'
                  : `${rules.length} rule${
                      rules.length === 1 ? '' : 's'
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
          rules={rules}
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
