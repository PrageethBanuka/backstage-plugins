import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entity } from '@backstage/catalog-model';
import { useAsyncEntity } from '@backstage/plugin-catalog-react';
import type { RolloutActionResult } from '@openchoreo/backstage-plugin-common';
import type {
  EndpointEnvironment as MentorEnvironment,
  OpenChoreoClientApi,
} from '../../../api/OpenChoreoClientApi';
import { getErrorMessage } from '../../../utils/errorUtils';
import {
  ConfirmTrafficDialog,
  type TrafficConfirmation,
} from './ConfirmTrafficDialog';
import { RolloutDialog } from './RolloutDialog';
import { backendLabel } from './endpointUi';
import {
  toPdEnv,
  type EndpointEnvironment,
  type EndpointSummary,
} from './pdTypes';
import type { ProgressiveDeliveryContextValue } from './ProgressiveDeliveryContext';

interface Notifier {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

const ENTITY_RECHECK_MS = [3000, 8000];

/** Where to go next once an Endpoint change has a release to deploy. */
const releaseReady = (release?: string) =>
  release
    ? `${release} is the latest release; deploy it from Set up`
    : 'Saved; deploy the latest release from Set up';

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
 * Progressive delivery state for the Endpoint Deploy tab: the Endpoint's
 * rollout, the environments as the rollout views read them, the handlers,
 * and the dialogs to render next to the tab's own.
 */
/** What every change that cuts a release means for the environments. */
const NEW_RELEASE_NOTE =
  'This cuts a new release. Deploy and promote it as usual.';

export function useProgressiveDeliveryState({
  entity,
  client,
  environments,
  notification,
  refresh,
}: {
  entity: Entity;
  client: OpenChoreoClientApi;
  environments: MentorEnvironment[];
  notification: Notifier;
  refresh: () => Promise<void>;
}) {
  const [endpoint, setEndpoint] = useState<EndpointSummary | null>(null);
  const [rolloutEnv, setRolloutEnv] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<TrafficConfirmation | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);
  const { refresh: refreshEntity } = useAsyncEntity();

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const { showError } = notification;
  const load = useCallback(async () => {
    try {
      const info = await client.fetchEndpointRollout(entity);
      if (!cancelledRef.current) setEndpoint(info);
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      setEndpoint(null);
      showError(
        `Couldn't load this Endpoint's rollout: ${getErrorMessage(err)}`,
      );
    }
  }, [client, entity, showError]);

  useEffect(() => {
    void load();
  }, [load, environments]);

  const envs = useMemo(
    () => environments.map(e => toPdEnv(e, endpoint ?? undefined)),
    [environments, endpoint],
  );

  const run = useCallback(
    async (work: () => Promise<{ ok: boolean; message: string }>) => {
      setBusy(true);
      try {
        const result = await work();
        if (cancelledRef.current) return;
        if (result.ok) notification.showSuccess(result.message);
        else notification.showError(result.message);
      } catch (err: unknown) {
        if (cancelledRef.current) return;
        notification.showError(getErrorMessage(err));
      } finally {
        await refresh();
        await load();
        // The catalog entity, which lists the backends, follows the
        // Endpoint by event; look again once the release is cut.
        ENTITY_RECHECK_MS.forEach(ms =>
          setTimeout(() => {
            if (!cancelledRef.current) refreshEntity?.();
          }, ms),
        );
        if (!cancelledRef.current) setBusy(false);
      }
    },
    [load, notification, refresh, refreshEntity],
  );

  const setStage = useCallback(
    (env: EndpointEnvironment, percent: number) => {
      const r = endpoint?.rollout;
      if (!r) return;
      void run(async () => {
        const { applied } = await client.setRolloutStage(
          entity,
          env.name,
          percent,
        );
        if (!applied) {
          return {
            ok: false,
            message: `Saved, but not applied yet in ${env.displayName}. Its traffic moves once the Endpoint is ready there.`,
          };
        }
        return {
          ok: true,
          message:
            r.strategy === 'mirror'
              ? `${env.displayName}: the new version now gets a copy of ${percent}% of traffic`
              : `${env.displayName}: the new version now gets ${percent}% of traffic`,
        };
      });
    },
    [client, endpoint, entity, run],
  );

  const finish = useCallback(
    (outcome: 'complete' | 'abandon') => {
      const r = endpoint?.rollout;
      if (!r) return;
      setConfirmation({
        title:
          outcome === 'complete'
            ? 'Remove the current version?'
            : 'Remove the new version?',
        body:
          outcome === 'complete'
            ? 'The new version becomes the only backend.'
            : 'The current version becomes the only backend. To move users off the new version right away, set each environment to 0% in Configure first.',
        note: NEW_RELEASE_NOTE,
        confirmLabel: 'Remove',
        run: () =>
          run(async () => ({
            ok: true,
            message: releaseReady(
              (await client.finishRollout(entity, outcome)).latestRelease,
            ),
          })),
      });
    },
    [client, endpoint, entity, run],
  );

  /**
   * Deploys or promotes a release into an environment the Endpoint already
   * runs in, through the BFF when it needs care: when the release drops a
   * backend that still gets traffic there (asked first), or when the
   * environment has overrides the release may not use. Returns false
   * otherwise, so the caller deploys as usual.
   */
  const promote = useCallback(
    async (target: string, releaseName: string): Promise<boolean> => {
      const env = envs.find(e => e.name === target);
      if (!env?.bindingName) return false;
      const release = await client.fetchEndpointRelease(entity, releaseName);
      const refs = ((release.data?.spec as { backendRefs?: { name: string }[] })
        ?.backendRefs ?? []) as { name: string }[];
      const kept = new Set(refs.map(r => r.name));
      const dropped = env.backends.filter(
        b => b.weight > 0 && !kept.has(b.name ?? b.componentName),
      );
      const deploy = () =>
        run(async () =>
          resultMessage(
            `Deployed ${releaseName} to ${env.displayName}`,
            await client.deployEndpointRelease(entity, target, releaseName),
          ),
        );
      if (dropped.length > 0) {
        const total = env.backends.reduce((sum, b) => sum + b.weight, 0);
        const share = Math.round(
          (dropped.reduce((sum, b) => sum + b.weight, 0) / (total || 1)) * 100,
        );
        const names = dropped
          .map(b => backendLabel(b, env.backends))
          .join(', ');
        setConfirmation({
          title: `Deploy to ${env.displayName}?`,
          body: `${names} ${
            dropped.length === 1 ? 'serves' : 'serve'
          } ${share}% of ${env.displayName}'s traffic now.`,
          note: `This release removes ${
            dropped.length === 1 ? 'it' : 'them'
          }, so that traffic moves to the backends it keeps.`,
          confirmLabel: 'Deploy',
          run: deploy,
        });
        return true;
      }
      if (env.overrides.length === 0) return false;
      await deploy();
      return true;
    },
    [client, entity, envs, run],
  );

  const onCopy = useCallback(
    (text: string, what: string) => {
      navigator.clipboard
        ?.writeText(text)
        .then(() => notification.showSuccess(`Copied the ${what}`))
        .catch(() => undefined);
    },
    [notification],
  );

  const context = useMemo<ProgressiveDeliveryContextValue | null>(
    () =>
      endpoint
        ? {
            endpoint,
            environments: envs,
            onOpenRolloutDialog: setRolloutEnv,
            onCopy,
            onFinish: finish,
            changeBlocked: busy ? 'Wait for the current change to finish' : '',
          }
        : null,
    [endpoint, envs, onCopy, finish, busy],
  );

  const rolloutEnvironment = envs.find(e => e.name === rolloutEnv) ?? null;

  const dialogs = endpoint ? (
    <>
      <RolloutDialog
        env={rolloutEnvironment}
        changeBlocked={busy ? 'Wait for the current change to finish' : ''}
        onClose={() => setRolloutEnv(null)}
        onSetStage={setStage}
      />
      <ConfirmTrafficDialog
        confirmation={confirmation}
        onClose={() => setConfirmation(null)}
      />
    </>
  ) : null;

  return { context, dialogs, promote };
}
