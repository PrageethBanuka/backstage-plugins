import { usePermission } from '@backstage/plugin-permission-react';
import { openchoreoEndpointCreatePermission } from '@openchoreo/backstage-plugin-common';

/**
 * Result of the useEndpointCreatePermission hook.
 */
export interface UseEndpointCreatePermissionResult {
  /** Whether the user has permission to create an Endpoint */
  canCreate: boolean;
  /** Whether the permission check is still loading */
  loading: boolean;
  /** Tooltip message for create permission denied (empty string when allowed/loading) */
  createDeniedTooltip: string;
}

/**
 * Hook for checking if the current user may create Endpoints. Like Resource
 * creation, the project scope is resolved server-side when the request lands.
 */
export const useEndpointCreatePermission =
  (): UseEndpointCreatePermissionResult => {
    const { allowed: canCreate, loading } = usePermission({
      permission: openchoreoEndpointCreatePermission,
    });

    return {
      canCreate,
      loading,
      createDeniedTooltip:
        !canCreate && !loading
          ? 'You do not have permission to create an endpoint'
          : '',
    };
  };
