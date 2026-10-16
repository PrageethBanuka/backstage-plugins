import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@backstage/core-components';
import { PageLoader } from '@openchoreo/backstage-design-system';
import { Box } from '@material-ui/core';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef, useEntity } from '@backstage/plugin-catalog-react';
import { ForbiddenState } from '@openchoreo/backstage-plugin-react';
import { CHOREO_ANNOTATIONS } from '@openchoreo/backstage-plugin-common';
import type {
  EndpointBackendWeight,
  EndpointEnvironment,
  EndpointReleaseSummary,
  EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { isForbiddenError, getErrorMessage } from '../../utils/errorUtils';
import { useNotification } from '../../hooks';
import { NotificationBanner } from '../Environments/components';
import { NoEnvironmentsEmptyState } from '../Environments/components/NoEnvironmentsEmptyState';
import { useResourceDeployFlowCanvasStyles } from '../ResourceEnvironments/styles';
import { EndpointDeployFlowCanvas } from './EndpointDeployFlowCanvas';
import { EndpointEnvironmentDetailPanel } from './EndpointEnvironmentDetailPanel';
import { EndpointTrafficDetailPane } from './EndpointTrafficDetailPane';
import {
  EndpointEnvironmentsProvider,
  type ActionKind,
} from './EndpointEnvironmentsContext';
import { EndpointReleasesDialog } from './EndpointReleasesDialog';
import { StopRoutingDialog } from './StopRoutingDialog';
import { TrafficEditorDialog } from './TrafficEditorDialog';
import { backendKey } from './endpointUi';

/** Poll fast while an environment is settling; the route lands in seconds. */
const SETTLING_POLL_MS = 3000;

/**
 * An Endpoint's Deploy tab, mounted at `/environments` on the Endpoint
 * entity page. Same layout and flow as ResourceEnvironmentsList: the
 * pipeline canvas with a leading Traffic tile on the left, the selected
 * tile's detail panel on the right, and the dialogs lifted up here.
 */
export const EndpointEnvironmentsList = () => {
  const canvasClasses = useResourceDeployFlowCanvasStyles();
  const { entity } = useEntity();
  const navigate = useNavigate();
  const endpointName =
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.ENDPOINT_CR] ??
    entity.metadata.name;
  const client = useApi(openChoreoClientApiRef);
  const catalogApi = useApi(catalogApiRef);
  const notification = useNotification();
  const projectName = entity.metadata.annotations?.[CHOREO_ANNOTATIONS.PROJECT];
  const namespaceName =
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE];
  const [projectComponents, setProjectComponents] = useState<string[]>([]);

  // Components of the project, offered as backends to add in Change traffic.
  useEffect(() => {
    if (!projectName || !namespaceName) return undefined;
    let cancelled = false;
    catalogApi
      .getEntities({
        filter: {
          kind: 'Component',
          'spec.system': projectName,
          'metadata.namespace': namespaceName,
        },
        fields: ['metadata.name'],
      })
      .then(res => {
        if (!cancelled) {
          setProjectComponents(res.items.map(e => e.metadata.name).sort());
        }
      })
      .catch(() => {
        // Non-critical: the editor still changes weights without the list.
      });
    return () => {
      cancelled = true;
    };
  }, [catalogApi, projectName, namespaceName]);

  const [endpoint, setEndpoint] = useState<EndpointSummary | null>(null);
  const [envs, setEnvs] = useState<EndpointEnvironment[]>([]);
  const [releases, setReleases] = useState<EndpointReleaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    env: string;
    kind: ActionKind;
  } | null>(null);
  const [selectedEnvName, setSelectedEnvNameState] = useState<string | null>(
    null,
  );
  const [selectedTraffic, setSelectedTraffic] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [releasesEnv, setReleasesEnv] = useState<string | null>(null);
  const [stopTarget, setStopTarget] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const setSelectedEnvName = useCallback((name: string | null) => {
    setSelectedEnvNameState(name);
    if (name !== null) setSelectedTraffic(false);
  }, []);
  const handleSelectTraffic = useCallback(() => {
    setSelectedTraffic(true);
    setSelectedEnvNameState(null);
  }, []);
  const handleClearSelection = useCallback(() => {
    setSelectedTraffic(false);
    setSelectedEnvNameState(null);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const fetchAll = useCallback(
    async (opts: { showProgress?: boolean } = {}) => {
      if (opts.showProgress) setLoading(true);
      try {
        const [summary, envInfo, releaseList] = await Promise.all([
          client.fetchEndpoint(entity),
          client.fetchEndpointEnvironmentInfo(entity),
          client.fetchEndpointReleases(entity),
        ]);
        if (cancelledRef.current) return;
        setEndpoint(summary);
        setEnvs(envInfo ?? []);
        setReleases(releaseList ?? []);
        setError(null);
      } catch (err: unknown) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelledRef.current && opts.showProgress) setLoading(false);
      }
    },
    [client, entity],
  );

  useEffect(() => {
    fetchAll({ showProgress: true });
  }, [fetchAll]);

  const isAnySettling = envs.some(
    e => e.status === 'Applying' || e.status === 'Releasing',
  );
  useEffect(() => {
    if (!isAnySettling) return undefined;
    const id = setInterval(() => void fetchAll(), SETTLING_POLL_MS);
    return () => clearInterval(id);
  }, [isAnySettling, fetchAll]);

  const handleRollOut = useCallback(
    async (environment: string, releaseName: string) => {
      setPendingAction({ env: environment, kind: 'rollout' });
      try {
        await client.updateEndpointReleaseBinding(
          entity,
          environment,
          releaseName,
        );
        if (cancelledRef.current) return;
        notification.showSuccess(
          `Rolling out ${releaseName} to ${environment}`,
        );
        await fetchAll();
      } catch (err: unknown) {
        if (cancelledRef.current) return;
        notification.showError(
          `Failed to roll out to ${environment}: ${getErrorMessage(err)}`,
        );
      } finally {
        if (!cancelledRef.current) setPendingAction(null);
      }
    },
    [client, entity, notification, fetchAll],
  );

  const handleSaveTraffic = useCallback(
    async (backends: EndpointBackendWeight[]) => {
      const res = await client.updateEndpointTraffic(entity, backends);
      await fetchAll();
      return res;
    },
    [client, entity, fetchAll],
  );

  const handleRollOutMany = useCallback(
    async (environments: string[], releaseName: string) => {
      for (const environment of environments) {
        await client.updateEndpointReleaseBinding(
          entity,
          environment,
          releaseName,
        );
      }
      notification.showSuccess(
        `Rolling out ${releaseName} to ${environments.join(', ')}`,
      );
      await fetchAll();
    },
    [client, entity, notification, fetchAll],
  );

  const handleStopConfirm = useCallback(async () => {
    if (!stopTarget) return;
    const environment = stopTarget;
    setPendingAction({ env: environment, kind: 'stop' });
    try {
      await client.deleteEndpointReleaseBinding(entity, environment);
      if (cancelledRef.current) return;
      setStopTarget(null);
      notification.showSuccess(
        `Stopping ${endpointName} in ${environment}; components take their traffic back first`,
      );
      await fetchAll();
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      notification.showError(
        `Failed to stop routing in ${environment}: ${getErrorMessage(err)}`,
      );
    } finally {
      if (!cancelledRef.current) setPendingAction(null);
    }
  }, [client, entity, endpointName, notification, fetchAll, stopTarget]);

  const handlePinFromReleases = useCallback(
    async (releaseName: string) => {
      if (!releasesEnv) return;
      await handleRollOut(releasesEnv, releaseName);
      setReleasesEnv(null);
    },
    [handleRollOut, releasesEnv],
  );

  // Colours follow the Endpoint's backendRefs order everywhere on the page.
  const backendIndex = useCallback(
    (componentName: string, ep: string) => {
      const i = (endpoint?.backends ?? []).findIndex(
        b => backendKey(b) === `${componentName}/${ep}`,
      );
      return i < 0 ? 0 : i;
    },
    [endpoint],
  );

  const contextValue = useMemo(
    () =>
      endpoint
        ? {
            endpoint,
            environments: envs,
            releases,
            loading,
            refetch: fetchAll,
            pendingAction,
            onRollOut: handleRollOut,
            onStopRoutingRequest: setStopTarget,
            onChangeTraffic: () => setEditorOpen(true),
            onViewReleases: setReleasesEnv,
            onViewArtifacts: (environment: string) =>
              navigate(`release/${encodeURIComponent(environment)}`),
          }
        : null,
    [
      endpoint,
      envs,
      releases,
      loading,
      fetchAll,
      pendingAction,
      handleRollOut,
      navigate,
    ],
  );

  if (isForbiddenError(error)) {
    return (
      <ForbiddenState
        message="You do not have permission to view this endpoint."
        minHeight="400px"
      />
    );
  }

  if (loading) {
    return <PageLoader />;
  }

  if (error || !contextValue) {
    return (
      <EmptyState
        missing="data"
        title={error ? 'Failed to load the endpoint' : 'Endpoint not found'}
        description={
          error
            ? getErrorMessage(error)
            : `This project has no Endpoint named ${endpointName}.`
        }
      />
    );
  }

  if (envs.length === 0) {
    return <NoEnvironmentsEmptyState />;
  }

  const selectedEnv = envs.find(e => e.name === selectedEnvName) ?? null;
  const releasesEnvironment = envs.find(e => e.name === releasesEnv) ?? null;

  return (
    <EndpointEnvironmentsProvider value={contextValue}>
      <NotificationBanner notification={notification.notification} />
      <Box className={canvasClasses.splitContainer}>
        <EndpointDeployFlowCanvas
          environments={envs}
          selectedEnvName={selectedEnvName}
          selectedSetup={selectedTraffic}
          onSelectEnv={setSelectedEnvName}
          onSelectSetup={handleSelectTraffic}
          onClearSelection={handleClearSelection}
        />
        <Box className={canvasClasses.detailPanelFrame}>
          {selectedTraffic ? (
            <EndpointTrafficDetailPane onClose={handleClearSelection} />
          ) : (
            <EndpointEnvironmentDetailPanel
              env={selectedEnv}
              onClose={() => setSelectedEnvName(null)}
            />
          )}
        </Box>
      </Box>

      <TrafficEditorDialog
        open={editorOpen}
        endpointName={endpointName}
        backends={contextValue.endpoint.backends}
        environments={envs}
        releases={releases}
        componentOptions={projectComponents}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveTraffic}
        onRollOut={handleRollOutMany}
      />
      <EndpointReleasesDialog
        open={releasesEnvironment !== null}
        environment={releasesEnvironment}
        releases={releases}
        backendIndex={backendIndex}
        isPinning={
          pendingAction?.kind === 'rollout' && pendingAction.env === releasesEnv
        }
        onClose={() => setReleasesEnv(null)}
        onPin={handlePinFromReleases}
      />
      <StopRoutingDialog
        open={stopTarget !== null}
        endpointName={endpointName}
        environmentName={
          envs.find(e => e.name === stopTarget)?.displayName ?? stopTarget ?? ''
        }
        isStopping={
          pendingAction?.kind === 'stop' && pendingAction.env === stopTarget
        }
        onCancel={() => setStopTarget(null)}
        onConfirm={handleStopConfirm}
      />
    </EndpointEnvironmentsProvider>
  );
};
