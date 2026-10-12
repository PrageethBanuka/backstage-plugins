import { useEntity } from '@backstage/plugin-catalog-react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import {
  openchoreoEndpointReleaseBindingCreatePermission,
  openchoreoEndpointReleaseBindingDeletePermission,
  openchoreoEndpointReleaseBindingUpdatePermission,
} from '@openchoreo/backstage-plugin-common';
import { useEnvScopedPermission } from './useEnvScopedPermission';

/**
 * Result of the useEndpointRolloutPermission hook.
 */
export interface UseEndpointRolloutPermissionResult {
  /** Whether the user may pin the environment to a release (roll out or back) */
  canRollOut: boolean;
  /** Whether the user may stop routing the Endpoint in the environment */
  canStopRouting: boolean;
  /** Whether any permission check is still loading */
  loading: boolean;
  /** Tooltip for a denied roll out (empty when allowed/loading) */
  rollOutDeniedTooltip: string;
  /** Tooltip for a denied stop routing (empty when allowed/loading) */
  stopRoutingDeniedTooltip: string;
}

/**
 * Hook for the actions that move an environment's traffic for an Endpoint.
 * Each is evaluated for the environment, so ABAC `resource.environment`
 * constraints apply (e.g. allowed in development, not in production).
 *
 * Rolling out updates the environment's EndpointReleaseBinding when it has
 * one (`endpointreleasebinding:update`) and creates it otherwise
 * (`endpointreleasebinding:create`). Stopping routing deletes it
 * (`endpointreleasebinding:delete`).
 *
 * Must be used within an EntityProvider context (project entity page).
 * `environment` is the Environment resource name, not its display name.
 */
export const useEndpointRolloutPermission = (
  environment: string,
  hasBinding: boolean,
): UseEndpointRolloutPermissionResult => {
  const { entity } = useEntity();
  const resourceRef = stringifyEntityRef(entity);

  const create = useEnvScopedPermission({
    permission: openchoreoEndpointReleaseBindingCreatePermission,
    resourceRef,
    environment,
  });
  const update = useEnvScopedPermission({
    permission: openchoreoEndpointReleaseBindingUpdatePermission,
    resourceRef,
    environment,
  });
  const remove = useEnvScopedPermission({
    permission: openchoreoEndpointReleaseBindingDeletePermission,
    resourceRef,
    environment,
  });

  const rollOut = hasBinding ? update : create;
  const loading = create.loading || update.loading || remove.loading;

  return {
    canRollOut: rollOut.allowed,
    canStopRouting: hasBinding && remove.allowed,
    loading,
    rollOutDeniedTooltip:
      !rollOut.allowed && !rollOut.loading
        ? `You do not have permission to change traffic in ${environment}`
        : '',
    stopRoutingDeniedTooltip:
      hasBinding && !remove.allowed && !remove.loading
        ? `You do not have permission to stop routing in ${environment}`
        : '',
  };
};
