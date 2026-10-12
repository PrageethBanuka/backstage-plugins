import { useEntity } from '@backstage/plugin-catalog-react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { openchoreoEndpointUpdatePermission } from '@openchoreo/backstage-plugin-common';
import { useEnvScopedPermission } from './useEnvScopedPermission';

/**
 * Result of the useEndpointTrafficPermission hook.
 */
export interface UseEndpointTrafficPermissionResult {
  /** Whether the user may change the Endpoint's traffic split */
  canChangeTraffic: boolean;
  /** Whether the permission check is still loading */
  loading: boolean;
  /** Tooltip message to show when permission is denied (empty when allowed/loading) */
  deniedTooltip: string;
}

/**
 * Hook for checking `endpoint:update` on the current project, which gates
 * changing an Endpoint's weights. Saving a new split cuts a release but
 * moves no traffic, so this check is not environment-scoped; rolling the
 * release out is (see useEndpointRolloutPermission).
 *
 * Must be used within an EntityProvider context (project entity page).
 */
export const useEndpointTrafficPermission =
  (): UseEndpointTrafficPermissionResult => {
    const { entity } = useEntity();
    const { allowed, loading } = useEnvScopedPermission({
      permission: openchoreoEndpointUpdatePermission,
      resourceRef: stringifyEntityRef(entity),
    });

    return {
      canChangeTraffic: allowed,
      loading,
      deniedTooltip:
        !allowed && !loading
          ? 'You do not have permission to change traffic for this endpoint'
          : '',
    };
  };
