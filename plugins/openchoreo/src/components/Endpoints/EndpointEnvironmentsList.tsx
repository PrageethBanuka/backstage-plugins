import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@backstage/core-components';
import { PageLoader } from '@openchoreo/backstage-design-system';
import { Box, Button, Tooltip, Typography } from '@material-ui/core';
import { useNavigate } from 'react-router-dom';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import {
  ForbiddenState,
  useEndpointTrafficPermission,
} from '@openchoreo/backstage-plugin-react';
import {
  CHOREO_ANNOTATIONS,
  type EndpointEnvironment,
  type EndpointReleaseSummary,
  type EndpointSummary,
  type RolloutActionResult,
  stableLabel,
} from '@openchoreo/backstage-plugin-common';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { isForbiddenError, getErrorMessage } from '../../utils/errorUtils';
import { useNotification } from '../../hooks';
import { NotificationBanner } from '../Environments/components';
import { NoEnvironmentsEmptyState } from '../Environments/components/NoEnvironmentsEmptyState';
import { useResourceDeployFlowCanvasStyles } from '../ResourceEnvironments/styles';
import { EndpointDeployFlowCanvas } from './EndpointDeployFlowCanvas';
import { EndpointEnvironmentDetailPanel } from './EndpointEnvironmentDetailPanel';
import {
  EndpointEnvironmentsProvider,
  type ActionKind,
  type EndpointTabMode,
} from './EndpointEnvironmentsContext';
import { EndpointReleasesDialog } from './EndpointReleasesDialog';
import { EndpointRolloutPane } from './EndpointRolloutPane';
import { RolloutDialog } from './RolloutDialog';
import { EndpointSetupCard } from './EndpointSetupCard';
import { EndpointSetupPane } from './EndpointSetupPane';
import { EnvironmentWeightsDialog } from './EnvironmentWeightsDialog';
import { StopRoutingDialog } from './StopRoutingDialog';
import {
  ConfirmTrafficDialog,
  type TrafficConfirmation,
} from './ConfirmTrafficDialog';
import { backendKey } from './endpointUi';
import {
  STRATEGY_COPY,
  inRollout,
  restoredSummary,
  stableKeeps,
  untouchedSummary,
  type RolloutAction,
} from './endpointRolloutUi';

/** "Staging", "Staging and Production", "A, B and C". */
const listNames = (names: string[]) =>
  names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** Poll fast while an environment is settling; the route lands in seconds. */
const SETTLING_POLL_MS = 3000;

/** Names the environments a multi-environment action failed in. */
function resultMessage(what: string, result: RolloutActionResult) {
  const failed = result.environments.filter(e => !e.ok);
  if (failed.length === 0) return { ok: true, message: what };
  return {
    ok: false,
    message: `${what}, but it failed in ${failed
      .map(f => `${f.name} (${f.error})`)
      .join(', ')}`,
  };
}

/**
 * The pipeline canvas and detail panel of an Endpoint's Deploy tab. Same
 * layout and flow as ResourceEnvironmentsList: a leading Set up tile,
 * environment tiles, the selected tile's panel on the right, and the dialogs
 * lifted up here. While a rollout runs, the tiles and panels show its steps
 * and the Set up pane summarises it; otherwise they deploy and promote.
 */
export const EndpointEnvironmentsList = () => {
  const canvasClasses = useResourceDeployFlowCanvasStyles();
  const { entity } = useEntity();
  const navigate = useNavigate();
  const endpointName =
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.ENDPOINT_CR] ??
    entity.metadata.name;
  const client = useApi(openChoreoClientApiRef);
  const notification = useNotification();
  const trafficPerm = useEndpointTrafficPermission();

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
  const [selectedSetup, setSelectedSetup] = useState(false);
  const [releasesEnv, setReleasesEnv] = useState<string | null>(null);
  const [overridesEnv, setOverridesEnv] = useState<string | null>(null);
  const [rolloutEnv, setRolloutEnv] = useState<string | null>(null);
  const [stopTarget, setStopTarget] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<TrafficConfirmation | null>(
    null,
  );
  const cancelledRef = useRef(false);

  const setSelectedEnvName = useCallback((name: string | null) => {
    setSelectedEnvNameState(name);
    if (name !== null) setSelectedSetup(false);
  }, []);
  const handleSelectSetup = useCallback(() => {
    setSelectedSetup(true);
    setSelectedEnvNameState(null);
  }, []);
  const handleClearSelection = useCallback(() => {
    setSelectedSetup(false);
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

  const isAnySettling =
    pendingAction !== null ||
    envs.some(e => e.status === 'Applying' || e.status === 'Releasing');
  useEffect(() => {
    if (!isAnySettling) return undefined;
    const id = setInterval(() => void fetchAll(), SETTLING_POLL_MS);
    return () => clearInterval(id);
  }, [isAnySettling, fetchAll]);

  /**
   * Runs a change against one environment (or all, for '*'), reports it in
   * the notification banner and refreshes.
   */
  const run = useCallback(
    async (
      env: string,
      kind: ActionKind,
      work: () => Promise<{ ok: boolean; message: string }>,
    ) => {
      setPendingAction({ env, kind });
      try {
        const result = await work();
        if (cancelledRef.current) return;
        if (result.ok) notification.showSuccess(result.message);
        else notification.showError(result.message);
      } catch (err: unknown) {
        if (cancelledRef.current) return;
        notification.showError(getErrorMessage(err));
      } finally {
        await fetchAll();
        if (!cancelledRef.current) setPendingAction(null);
      }
    },
    [fetchAll, notification],
  );

  /** Production traffic changes ask first; the others run straight away. */
  const guarded = useCallback(
    (
      env: EndpointEnvironment,
      confirm: Omit<TrafficConfirmation, 'run'>,
      kind: ActionKind,
      work: () => Promise<{ ok: boolean; message: string }>,
    ) => {
      if (env.isProduction) {
        setConfirmation({ ...confirm, run: () => run(env.name, kind, work) });
      } else {
        void run(env.name, kind, work);
      }
    },
    [run],
  );

  const handleRollOut = useCallback(
    async (environment: string, releaseName: string) => {
      const env = envs.find(e => e.name === environment);
      await run(environment, 'rollout', async () => {
        // Outside a rollout an environment serves the release as it is:
        // weights left from an earlier rollout are cleared.
        await client.updateEndpointReleaseBinding(
          entity,
          environment,
          releaseName,
          endpoint?.rollout ? undefined : [],
        );
        return {
          ok: true,
          message: `Deploying ${releaseName} to ${
            env?.displayName ?? environment
          }`,
        };
      });
    },
    [client, endpoint, entity, envs, run],
  );

  const finish = useCallback(
    (outcome: 'complete' | 'abandon') => {
      const r = endpoint?.rollout;
      if (!endpoint || !r) return;
      const untouched = untouchedSummary(r);
      const touchesProduction = envs.some(e => e.bindingName && e.isProduction);
      const where = `in every environment${
        touchesProduction ? ', including production' : ''
      }`;
      let completeBody = `${r.candidate} becomes the only backend of ${endpoint.name} ${where}. ${r.stable} stops getting traffic from ${endpoint.name}.`;
      if (untouched) {
        completeBody = `${r.candidate} replaces ${r.stable} ${where}. ${untouched} stays as it is.`;
      }
      // Environments later in the pipeline that do not run the Endpoint yet
      // skip the rollout: they get the new version directly when deployed.
      const notYet = envs.filter(e => !e.bindingName).map(e => e.displayName);
      if (notYet.length > 0) {
        completeBody += ` ${listNames(notYet)} ${
          notYet.length === 1 ? "doesn't" : "don't"
        } run ${endpoint.name} yet: when deployed there, ${
          notYet.length === 1 ? 'it gets' : 'they get'
        } ${
          r.candidate
        } directly. To step through the rollout there too, promote it first.`;
      }
      setConfirmation({
        title:
          outcome === 'complete'
            ? `Keep only ${r.candidate}?`
            : `Remove ${r.candidate}?`,
        body:
          outcome === 'complete'
            ? completeBody
            : `All traffic goes back to ${restoredSummary(
                r,
              )} in every environment, and ${r.candidate} leaves the Endpoint.`,
        confirmLabel:
          outcome === 'complete'
            ? `Keep only ${r.candidate}`
            : `Remove ${r.candidate}`,
        ...(outcome === 'complete' &&
          touchesProduction && { typeToConfirm: endpoint.name }),
        run: () =>
          run('*', 'stage', async () => {
            return resultMessage(
              outcome === 'complete'
                ? `${r.candidate} replaced ${r.stable}`
                : `${r.candidate} removed: ${restoredSummary(r)} restored`,
              await client.finishRollout(entity, outcome),
            );
          }),
      });
    },
    [client, endpoint, entity, envs, run],
  );

  // A mirror only gets copies; to send it real traffic it becomes a canary
  // on the same backend, which testers reach with x-canary: true.
  const convert = useCallback(() => {
    const r = endpoint?.rollout;
    if (!endpoint || !r) return;
    setConfirmation({
      title: `Turn ${r.candidate} into a canary?`,
      body: `${r.candidate} stops getting copies and starts at 0% wherever it runs, so no user traffic moves yet. Testers reach it with the header x-canary: true. Then advance each environment as for any canary.`,
      confirmLabel: 'Turn into a canary',
      run: () =>
        run('*', 'stage', async () =>
          resultMessage(
            `${r.candidate} is now a canary at 0%`,
            await client.convertRollout(entity, {
              name: 'x-canary',
              value: 'true',
            }),
          ),
        ),
    });
  }, [client, endpoint, entity, run]);

  const setStage = useCallback(
    (env: EndpointEnvironment, percent: number, label: string) => {
      const r = endpoint?.rollout;
      if (!r) return;
      guarded(
        env,
        {
          title: `${label} in ${env.displayName}?`,
          body:
            r.strategy === 'mirror'
              ? `${r.candidate} gets a copy of ${percent}% of ${env.displayName} traffic. Users still get only ${r.stable}'s answers.`
              : `${r.candidate} gets ${percent}% of ${
                  untouchedSummary(r)
                    ? `${r.stable}'s traffic in ${env.displayName}`
                    : `${env.displayName} traffic`
                } and ${stableKeeps(r, percent)}.${
                  untouchedSummary(r)
                    ? ` ${untouchedSummary(r)} is unchanged.`
                    : ''
                } You can roll back from the panel at any time.`,
          confirmLabel: label,
        },
        'stage',
        async () => {
          await client.setRolloutStage(entity, env.name, percent);
          return {
            ok: true,
            message:
              r.strategy === 'mirror'
                ? `${env.displayName}: ${r.candidate} now gets a copy of ${percent}% of traffic`
                : `${env.displayName}: ${r.candidate} now gets ${percent}% of traffic`,
          };
        },
      );
    },
    [client, endpoint, entity, guarded],
  );

  const handleRolloutAction = useCallback(
    (environment: string, action: RolloutAction) => {
      const env = envs.find(e => e.name === environment);
      const r = endpoint?.rollout;
      if (!env || !r) return;
      switch (action.kind) {
        case 'promote': {
          const from = envs.find(e => e.name === action.from);
          guarded(
            env,
            {
              title: `Promote the rollout to ${env.displayName}?`,
              body:
                r.strategy === 'mirror'
                  ? `${env.displayName} gets ${
                      r.candidate
                    } next to ${stableLabel(
                      r,
                    )}, copying the share the release sets. Users keep getting ${stableLabel(
                      r,
                    )}'s answers.`
                  : `${env.displayName} gets ${
                      r.candidate
                    } next to ${stableLabel(
                      r,
                    )}, at 0%. No traffic moves until you advance ${
                      env.displayName
                    }.`,
              confirmLabel: 'Promote',
            },
            'rollout',
            async () =>
              resultMessage(
                `Promoted the rollout from ${
                  from?.displayName ?? action.from
                } to ${env.displayName}`,
                await client.promoteRollout(entity, action.from, env.name),
              ),
          );
          break;
        }
        case 'complete':
          finish('complete');
          break;
        default:
          setStage(env, action.percent, action.label);
      }
    },
    [client, endpoint, entity, envs, finish, guarded, setStage],
  );

  const handleRollBack = useCallback(
    (environment: string) => {
      const env = envs.find(e => e.name === environment);
      const r = endpoint?.rollout;
      if (env && r) {
        setStage(
          env,
          0,
          r.strategy === 'mirror'
            ? 'Stop copying'
            : `Roll back to ${stableLabel(r)}`,
        );
      }
    },
    [endpoint, envs, setStage],
  );

  const handleStopConfirm = useCallback(async () => {
    if (!stopTarget) return;
    const environment = stopTarget;
    await run(environment, 'stop', async () => {
      await client.deleteEndpointReleaseBinding(entity, environment);
      return {
        ok: true,
        message: `Stopping ${endpointName} in ${environment}; components take their traffic back first`,
      };
    });
    setStopTarget(null);
  }, [client, entity, endpointName, run, stopTarget]);

  const handleDeleteRelease = useCallback(
    async (releaseName: string) => {
      await client.deleteEndpointRelease(entity, releaseName);
      if (cancelledRef.current) return;
      notification.showSuccess(`Deleted release ${releaseName}`);
      await fetchAll();
    },
    [client, entity, notification, fetchAll],
  );

  // Releases an environment runs can't be deleted; the dialog names where.
  const pinnedReleases = useMemo(() => {
    const byRelease = new Map<string, string[]>();
    for (const env of envs) {
      if (!env.endpointRelease) continue;
      const list = byRelease.get(env.endpointRelease) ?? [];
      list.push(env.displayName);
      byRelease.set(env.endpointRelease, list);
    }
    return byRelease;
  }, [envs]);

  // Going back to an older version clears the environment's own weights,
  // so it serves exactly what that version says.
  const handlePinFromReleases = useCallback(
    (releaseName: string) => {
      const env = envs.find(e => e.name === releasesEnv);
      setReleasesEnv(null);
      if (!env) return;
      guarded(
        env,
        {
          title: `Go back to ${releaseName} in ${env.displayName}?`,
          body: `${env.displayName} switches to that version of the routing and its own weights are cleared.`,
          confirmLabel: 'Go back',
        },
        'rollout',
        async () => {
          await client.updateEndpointReleaseBinding(
            entity,
            env.name,
            releaseName,
            [],
          );
          return {
            ok: true,
            message: `${env.displayName} went back to ${releaseName}`,
          };
        },
      );
    },
    [client, entity, envs, guarded, releasesEnv],
  );

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notification.showSuccess(`Copied ${label}`);
      } catch {
        notification.showError('Failed to copy to clipboard');
      }
    },
    [notification],
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
            mode: (endpoint.rollout ? 'rollout' : 'deploy') as EndpointTabMode,
            endpoint,
            environments: envs,
            releases,
            loading,
            refetch: fetchAll,
            pendingAction,
            onRollOut: handleRollOut,
            onStopRoutingRequest: setStopTarget,
            onViewReleases: setReleasesEnv,
            onViewArtifacts: (environment: string) =>
              navigate(`release/${encodeURIComponent(environment)}`),
            onConfigureOverrides: setOverridesEnv,
            onConfigureEnvironment: (environment: string) =>
              navigate(`overrides/${encodeURIComponent(environment)}`),
            onRolloutAction: handleRolloutAction,
            onRollBack: handleRollBack,
            onOpenRolloutDialog: setRolloutEnv,
            onCopy: (text: string, label: string) => void copy(text, label),
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
      handleRolloutAction,
      handleRollBack,
      copy,
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

  if (error || !contextValue || !endpoint) {
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

  const rollout = endpoint.rollout;
  const selectedEnv = envs.find(e => e.name === selectedEnvName) ?? null;
  const releasesEnvironment = envs.find(e => e.name === releasesEnv) ?? null;
  const overridesEnvironment = envs.find(e => e.name === overridesEnv) ?? null;
  const rolloutEnvironment = envs.find(e => e.name === rolloutEnv) ?? null;
  let changeBlocked = '';
  if (!trafficPerm.loading && !trafficPerm.canChangeTraffic) {
    changeBlocked =
      trafficPerm.deniedTooltip || 'You cannot change this Endpoint';
  } else if (pendingAction) {
    changeBlocked = 'Wait for the current change to finish';
  }

  const setupTile = (
    <EndpointSetupCard
      selected={selectedSetup}
      title="Set up"
      hint={
        rollout
          ? `${STRATEGY_COPY[rollout.strategy].name} · ${rollout.candidate}`
          : 'Endpoint configuration'
      }
    />
  );

  const setupPane = rollout ? (
    <EndpointRolloutPane
      onManage={() =>
        setRolloutEnv(
          (
            envs.find(e => inRollout(e, rollout)) ??
            envs.find(e => e.bindingName)
          )?.name ?? null,
        )
      }
      onClose={handleClearSelection}
    />
  ) : (
    <EndpointSetupPane
      title="Set up"
      onClose={handleClearSelection}
      action={{
        label: 'Configure & Deploy',
        onClick: () => navigate('configure'),
        disabledReason:
          !trafficPerm.loading && !trafficPerm.canChangeTraffic
            ? trafficPerm.deniedTooltip
            : '',
      }}
    >
      <Box display="flex" flexDirection="column" gridGap={12}>
        <Typography variant="body2" color="textSecondary">
          Change how the Endpoint routes traffic and deploy a new version of it.
        </Typography>
        <Box>
          <Typography variant="body2" style={{ fontWeight: 600 }}>
            Backends
          </Typography>
          <Typography variant="body2" color="textSecondary">
            To move traffic to another component, add it as a backend and choose
            how it gets traffic:{' '}
            {Object.values(STRATEGY_COPY)
              .map(c => c.name)
              .join(', ')}
            . Nothing changes for users until you advance an environment.
          </Typography>
          <Tooltip title={changeBlocked} disableHoverListener={!changeBlocked}>
            <span>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                disabled={Boolean(changeBlocked)}
                onClick={() => navigate('add-backend')}
                style={{ marginTop: 8 }}
              >
                Add a backend
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>
    </EndpointSetupPane>
  );

  return (
    <EndpointEnvironmentsProvider value={contextValue}>
      <NotificationBanner notification={notification.notification} />
      <Box className={canvasClasses.splitContainer}>
        <EndpointDeployFlowCanvas
          environments={envs}
          selectedEnvName={selectedEnvName}
          selectedSetup={selectedSetup}
          setupTile={setupTile}
          setupLabel="Select setup"
          onSelectEnv={setSelectedEnvName}
          onSelectSetup={handleSelectSetup}
          onClearSelection={handleClearSelection}
        />
        <Box className={canvasClasses.detailPanelFrame}>
          {selectedSetup ? (
            setupPane
          ) : (
            <EndpointEnvironmentDetailPanel
              env={selectedEnv}
              onClose={() => setSelectedEnvName(null)}
            />
          )}
        </Box>
      </Box>

      <RolloutDialog
        env={rolloutEnvironment}
        changeBlocked={changeBlocked}
        onClose={() => setRolloutEnv(null)}
        onSetStage={setStage}
        onKeep={() => finish('complete')}
        onConvert={convert}
        onRemove={() => finish('abandon')}
      />
      <ConfirmTrafficDialog
        confirmation={confirmation}
        onClose={() => setConfirmation(null)}
      />
      <EnvironmentWeightsDialog
        open={overridesEnvironment !== null}
        env={overridesEnvironment}
        backends={
          releases.find(r => r.name === overridesEnvironment?.endpointRelease)
            ?.backends ?? endpoint.backends
        }
        rollout={endpoint.rollout}
        onClose={() => setOverridesEnv(null)}
        onSave={async (environment, overrides) => {
          const res = await client.updateEndpointOverrides(
            entity,
            environment,
            overrides,
          );
          await fetchAll();
          return res;
        }}
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
        pinnedReleases={pinnedReleases}
        onDelete={handleDeleteRelease}
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
