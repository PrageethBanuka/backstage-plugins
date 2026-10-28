import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Typography,
  makeStyles,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import type { JSONSchema7 } from 'json-schema';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import type { EndpointEnvironment } from '@openchoreo/backstage-plugin-common';
import {
  DetailPageLayout,
  ForbiddenState,
} from '@openchoreo/backstage-plugin-react';
import { RjsfForm, Skeleton } from '@openchoreo/backstage-design-system';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { isForbiddenError, getErrorMessage } from '../../utils/errorUtils';
import { useNotification } from '../../hooks';
import { NotificationBanner } from '../Environments/components';

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
  },
  formHint: {
    color: theme.palette.text.secondary,
    fontSize: theme.typography.body2.fontSize,
    marginBottom: theme.spacing(2),
  },
  actionsRow: {
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  },
  emptyState: {
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
    padding: theme.spacing(4),
    textAlign: 'center',
  },
}));

export interface EndpointEnvironmentOverridesPageProps {
  envName: string;
  onBack: () => void;
  onSaved: () => void;
}

/**
 * Edits `EndpointReleaseBinding.spec.endpointTypeEnvironmentConfigs` for one
 * environment, on the Resource overrides page's layout. Saving updates the
 * binding; the controller validates the values against the type's schema
 * and re-renders the environment's routes, without a new release.
 *
 * The schema comes from the EndpointType snapshot on the release the
 * environment runs, not the live type, so the form validates against what
 * the release was cut with.
 */
export const EndpointEnvironmentOverridesPage = ({
  envName,
  onBack,
  onSaved,
}: EndpointEnvironmentOverridesPageProps) => {
  const classes = useStyles();
  const { entity } = useEntity();
  const client = useApi(openChoreoClientApiRef);
  const notification = useNotification();

  const [env, setEnv] = useState<EndpointEnvironment | null>(null);
  const [typeName, setTypeName] = useState('the EndpointType');
  const [schema, setSchema] = useState<JSONSchema7 | null>(null);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [initialOverrides, setInitialOverrides] = useState<
    Record<string, unknown>
  >({});
  // True when the binding has stored values; RJSF fills schema defaults on
  // mount, so the form alone can't tell whether there is anything to clear.
  const [hasActualOverrides, setHasActualOverrides] = useState(false);
  // With nothing stored, adopt RJSF's first normalized snapshot as the
  // baseline so filling defaults on mount doesn't count as a change.
  const formInitializedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const envDisplayName = env?.displayName ?? envName;
  const hasBinding = Boolean(env?.bindingName);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const load = async () => {
      try {
        const [envs, summary] = await Promise.all([
          client.fetchEndpointEnvironmentInfo(entity),
          client.fetchEndpoint(entity),
        ]);
        if (cancelled) return;
        const match = (envs ?? []).find(e => e.name === envName) ?? null;
        setEnv(match);
        if (summary?.type.name) setTypeName(summary.type.name);

        const stored = match?.environmentConfigs ?? {};
        const copy = JSON.parse(JSON.stringify(stored));
        formInitializedRef.current = Object.keys(stored).length > 0;
        setOverrides(copy);
        setInitialOverrides(copy);
        setHasActualOverrides(Object.keys(stored).length > 0);

        const release = match?.endpointRelease;
        if (!release) {
          setSchema({} as JSONSchema7);
          return;
        }
        const releaseSchema = await client.fetchEndpointReleaseSchema(
          entity,
          release,
        );
        if (cancelled) return;
        setSchema((releaseSchema as JSONSchema7) ?? ({} as JSONSchema7));
      } catch (err: unknown) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [client, entity, envName]);

  const hasChanges = useMemo(
    () => JSON.stringify(overrides) !== JSON.stringify(initialOverrides),
    [overrides, initialOverrides],
  );
  const hasFields =
    !!schema?.properties && Object.keys(schema.properties).length > 0;

  // Only fields given a value are stored; an emptied field inherits again.
  const persist = useCallback(
    async (next: Record<string, unknown>) => {
      const kept = Object.fromEntries(
        Object.entries(next).filter(([, v]) => v !== undefined && v !== ''),
      );
      await client.updateEndpointEnvironmentConfigs(entity, envName, kept);
    },
    [client, entity, envName],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await persist(overrides);
      notification.showSuccess(`Saved overrides for ${envDisplayName}.`);
      onSaved();
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [envDisplayName, notification, onSaved, overrides, persist]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    setSaveError(null);
    try {
      await persist({});
      notification.showSuccess(`Cleared overrides for ${envDisplayName}.`);
      onSaved();
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err));
    } finally {
      setClearing(false);
    }
  }, [envDisplayName, notification, onSaved, persist]);

  const headerActions = !loading && !loadError && (
    <Box className={classes.actionsRow}>
      <Button
        onClick={handleClear}
        disabled={saving || clearing || !hasActualOverrides || !hasBinding}
      >
        {clearing ? 'Clearing' : 'Clear Overrides'}
      </Button>
      <Button
        variant="contained"
        color="primary"
        onClick={handleSave}
        disabled={saving || clearing || !hasBinding || !hasChanges}
        startIcon={
          saving ? <CircularProgress size={20} color="inherit" /> : undefined
        }
      >
        {saving ? 'Saving' : 'Save Overrides'}
      </Button>
    </Box>
  );

  if (isForbiddenError(loadError)) {
    return (
      <ForbiddenState
        message="You do not have permission to configure overrides for this environment."
        minHeight="400px"
      />
    );
  }

  return (
    <DetailPageLayout
      title={`Configure Environment Overrides — ${envDisplayName}`}
      subtitle={`Set ${envDisplayName}-specific values for ${typeName}. They apply to this environment only and need no new release.`}
      onBack={onBack}
      actions={headerActions}
    >
      <NotificationBanner notification={notification.notification} />

      {loading && (
        <Box className={classes.loadingContainer}>
          <Skeleton variant="rect" width="100%" height={64} />
          <Skeleton variant="rect" width="100%" height={120} />
        </Box>
      )}

      {loadError && !loading && (
        <Box mb={2}>
          <Alert severity="error">
            Failed to load overrides: {getErrorMessage(loadError)}
          </Alert>
        </Box>
      )}

      {!loading && !loadError && !hasBinding && (
        <Box mb={2}>
          <Alert severity="info">
            This Endpoint is not deployed in {envDisplayName} yet. Deploy it
            there before configuring overrides.
          </Alert>
        </Box>
      )}

      {saveError && !loading && (
        <Box mb={2}>
          <Alert severity="error" onClose={() => setSaveError(null)}>
            {saveError}
          </Alert>
        </Box>
      )}

      {!loading && !loadError && hasBinding && (
        <Box className={classes.formCard}>
          {hasFields ? (
            <>
              <Typography className={classes.formHint}>
                Only fields you fill in here are stored as overrides for{' '}
                {envDisplayName}. Empty fields use {typeName}&apos;s defaults.
              </Typography>
              <RjsfForm
                schema={schema as any}
                uiSchema={{}}
                formData={overrides}
                onChange={data => {
                  const next = (data.formData ?? {}) as Record<string, unknown>;
                  setOverrides(next);
                  if (!formInitializedRef.current) {
                    setInitialOverrides(next);
                    formInitializedRef.current = true;
                  }
                }}
                tagName="div"
              />
            </>
          ) : (
            <Typography className={classes.emptyState}>
              {typeName} declares no environment configs for the release{' '}
              {envDisplayName} runs, so there is nothing to override here.
            </Typography>
          )}
        </Box>
      )}
    </DetailPageLayout>
  );
};
