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
import { Link as RouterLink, useNavigate } from 'react-router-dom';
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
  type EndpointSummary,
  type EndpointVisibility,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { getErrorMessage, isForbiddenError } from '../../utils/errorUtils';
import { AutoDeployConfirmationDialog } from '../Environments/components/AutoDeployConfirmationDialog';
import {
  backendOptions,
  backendRowKey,
  type EndpointBackendOption,
} from './EndpointBackendRows';
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
  version: { maxWidth: 480 },
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
 * The Endpoint's Configure & Deploy page, opened from the Deploy tab's Set
 * up tile, on the Configure Resource page's layout (DetailPageLayout). It
 * covers only what deploying needs: where the Endpoint is reachable from,
 * the one version it serves and whether new versions deploy on their own.
 * Splitting traffic across backends is done with Add a backend on the same
 * tab. This is a placeholder until the Endpoint's deploy config is defined.
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
  const [version, setVersion] = useState('');
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
          const busiest = [...summary.backends].sort(
            (a, b) => b.weight - a.weight,
          )[0];
          setVersion(busiest ? backendRowKey(busiest) : '');
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
  const several = (endpoint?.backends.length ?? 0) > 1;
  const current =
    endpoint?.backends.length === 1 ? backendRowKey(endpoint.backends[0]) : '';
  // Saving a version leaves the Endpoint serving only that one.
  const versionChanged =
    Boolean(endpoint) && Boolean(version) && (several || version !== current);

  const newBackends = useMemo((): EndpointBackendWeight[] | undefined => {
    if (!endpoint || !versionChanged) return undefined;
    const [componentName, ...rest] = version.split('/');
    const kept = endpoint.backends.find(b => backendRowKey(b) === version);
    return [{ ...kept, componentName, endpoint: rest.join('/'), weight: 100 }];
  }, [endpoint, version, versionChanged]);

  const settingsChanged =
    Boolean(endpoint) &&
    (!sameSet(visibility, endpoint!.visibility) ||
      autoDeploy !== endpoint!.autoDeploy);
  const hasChanges = versionChanged || settingsChanged;
  const versionChoices = [
    ...new Set([
      ...(endpoint?.backends.map(backendRowKey) ?? []),
      ...options.map(backendRowKey),
    ]),
  ];

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
      if (versionChanged && newBackends) {
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
      subtitle={`Change where ${
        endpoint?.name ?? 'the Endpoint'
      } is reachable and which version it serves. Saving creates a new version${
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
            {several && (
              <Box className={classes.version} mb={1}>
                <TrafficSplitBar backends={endpoint.backends} showLegend />
              </Box>
            )}
            <Box className={classes.version}>
              <TextField
                id="endpoint-version"
                select
                fullWidth
                size="small"
                variant="outlined"
                label="Component / endpoint"
                value={version}
                disabled={locked}
                onChange={e => setVersion(e.target.value)}
              >
                {versionChoices.map(v => (
                  <MenuItem key={v} value={v}>
                    {v}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            {locked && (
              <Typography variant="caption" color="textSecondary">
                {endpoint.rollout!.candidate} is being rolled out. Keep only it,
                or remove it, from the{' '}
                <RouterLink to=".." relative="path">
                  Set up pane
                </RouterLink>{' '}
                first.
              </Typography>
            )}
            {!locked && several && (
              <Typography variant="caption" color="textSecondary">
                {endpoint.name} serves several versions. Saving keeps only this
                version; the others leave the Endpoint.
              </Typography>
            )}
            {!locked && !several && (
              <Typography variant="caption" color="textSecondary">
                This backend gets all traffic. To move traffic to another
                component step by step, use Add a backend on the Set up pane.
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
        </Box>
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
