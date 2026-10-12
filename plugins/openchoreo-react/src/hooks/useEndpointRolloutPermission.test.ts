import { renderHook } from '@testing-library/react';
import {
  openchoreoEndpointReleaseBindingCreatePermission,
  openchoreoEndpointReleaseBindingDeletePermission,
  openchoreoEndpointReleaseBindingUpdatePermission,
} from '@openchoreo/backstage-plugin-common';
import { useEndpointRolloutPermission } from './useEndpointRolloutPermission';

const allowed = new Map<string, boolean>();
const mockUseEnvScopedPermission = jest.fn(
  ({ permission }: { permission: { name: string } }) => ({
    allowed: allowed.get(permission.name) ?? false,
    loading: false,
  }),
);

jest.mock('@backstage/plugin-catalog-react', () => ({
  useEntity: () => ({
    entity: {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'System',
      metadata: { name: 'shop', namespace: 'default' },
    },
  }),
}));
jest.mock('./useEnvScopedPermission', () => ({
  useEnvScopedPermission: (opts: any) => mockUseEnvScopedPermission(opts),
}));

const CREATE = openchoreoEndpointReleaseBindingCreatePermission.name;
const UPDATE = openchoreoEndpointReleaseBindingUpdatePermission.name;
const DELETE = openchoreoEndpointReleaseBindingDeletePermission.name;

beforeEach(() => {
  allowed.clear();
  mockUseEnvScopedPermission.mockClear();
});

describe('useEndpointRolloutPermission', () => {
  it('needs create the first time an environment is routed', () => {
    allowed.set(CREATE, true);

    const { result } = renderHook(() =>
      useEndpointRolloutPermission('development', false),
    );

    expect(result.current.canRollOut).toBe(true);
    expect(result.current.canStopRouting).toBe(false);
    expect(result.current.stopRoutingDeniedTooltip).toBe('');
  });

  it('needs update once the environment has a binding', () => {
    allowed.set(CREATE, true);

    const { result } = renderHook(() =>
      useEndpointRolloutPermission('production', true),
    );

    expect(result.current.canRollOut).toBe(false);
    expect(result.current.rollOutDeniedTooltip).toBe(
      'You do not have permission to change traffic in production',
    );
  });

  it('allows stopping routing with delete', () => {
    allowed.set(UPDATE, true);
    allowed.set(DELETE, true);

    const { result } = renderHook(() =>
      useEndpointRolloutPermission('staging', true),
    );

    expect(result.current.canRollOut).toBe(true);
    expect(result.current.canStopRouting).toBe(true);
  });

  it('evaluates every check for the environment', () => {
    renderHook(() => useEndpointRolloutPermission('production', true));

    expect(mockUseEnvScopedPermission).toHaveBeenCalledTimes(3);
    for (const [opts] of mockUseEnvScopedPermission.mock.calls) {
      expect((opts as any).environment).toBe('production');
      expect((opts as any).resourceRef).toBe('system:default/shop');
    }
  });
});
