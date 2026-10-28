import { fireEvent, render, screen } from '@testing-library/react';
import type {
  EndpointEnvironment,
  EndpointRollout,
  EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import { EndpointEnvironmentDetailPanel } from './EndpointEnvironmentDetailPanel';
import {
  EndpointEnvironmentsProvider,
  type EndpointEnvironmentsContextValue,
} from './EndpointEnvironmentsContext';

jest.mock('@openchoreo/backstage-design-system', () => ({
  StatusBadge: ({ label }: any) => (
    <span data-testid="status-badge">{label}</span>
  ),
}));

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  formatRelativeTime: () => '1 hour ago',
  useEndpointRolloutPermission: () => ({
    canRollOut: true,
    canStopRouting: true,
    loading: false,
    rollOutDeniedTooltip: '',
    stopRoutingDeniedTooltip: '',
  }),
}));

const canary: EndpointRollout = {
  strategy: 'canary',
  stable: 'trips-python',
  candidate: 'trips-go',
  steps: [5, 25, 50, 100],
};

const endpoint = (rollout?: EndpointRollout): EndpointSummary => ({
  name: 'trips-api',
  namespaceName: 'default',
  projectName: 'trips',
  type: { kind: 'ClusterEndpointType', name: 'http' },
  visibility: ['external'],
  autoDeploy: true,
  backends: [
    { componentName: 'trips-python', endpoint: 'http', weight: 100 },
    { componentName: 'trips-go', endpoint: 'http', weight: 0 },
  ],
  rollout,
  rolloutSource: rollout ? 'annotation' : 'none',
  environments: [],
  latestRelease: 'rel-1',
});

const dev: EndpointEnvironment = {
  name: 'development',
  displayName: 'Development',
  isProduction: false,
  bindingName: 'trips-api-development',
  endpointRelease: 'rel-1',
  latestRelease: 'rel-1',
  status: 'Routing',
  backends: [
    {
      componentName: 'trips-python',
      endpoint: 'http',
      weight: 100,
      resolved: true,
    },
    { componentName: 'trips-go', endpoint: 'http', weight: 0, resolved: true },
  ],
  overrides: [],
  environmentConfigs: { requestTimeout: '5s' },
  deployedAt: '2026-10-28T00:00:00Z',
  rollout: { index: 0, percent: 0, manual: false },
  deployedBackends: ['trips-python/http', 'trips-go/http'],
  promotionTargets: [],
};

function renderPanel(rollout?: EndpointRollout) {
  const value: EndpointEnvironmentsContextValue = {
    mode: rollout ? 'rollout' : 'deploy',
    endpoint: endpoint(rollout),
    environments: [dev],
    releases: [],
    loading: false,
    refetch: jest.fn(),
    pendingAction: null,
    onRollOut: jest.fn(),
    onStopRoutingRequest: jest.fn(),
    onViewReleases: jest.fn(),
    onViewArtifacts: jest.fn(),
    onConfigureOverrides: jest.fn(),
    onConfigureEnvironment: jest.fn(),
    onRolloutAction: jest.fn(),
    onRollBack: jest.fn(),
    onOpenRollout: jest.fn(),
    onCopy: jest.fn(),
  };
  render(
    <EndpointEnvironmentsProvider value={value}>
      <EndpointEnvironmentDetailPanel env={dev} onClose={jest.fn()} />
    </EndpointEnvironmentsProvider>,
  );
  return value;
}

describe('EndpointEnvironmentDetailPanel', () => {
  it.each([
    ['with no rollout', undefined],
    ['while a rollout runs', canary],
  ])('shows the release, artifacts and configuration %s', (_label, rollout) => {
    const ctx = renderPanel(rollout);
    expect(screen.getByText('Deployed')).toBeInTheDocument();
    expect(screen.getByText('1 hour ago')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /View K8s Artifacts/ }));
    expect(ctx.onViewArtifacts).toHaveBeenCalledWith('development');

    fireEvent.click(
      screen.getByRole('button', { name: /Configure overrides/ }),
    );
    expect(ctx.onConfigureEnvironment).toHaveBeenCalledWith('development');

    fireEvent.click(
      screen.getByRole('button', { name: /Set traffic by hand/ }),
    );
    expect(ctx.onConfigureOverrides).toHaveBeenCalledWith('development');
    expect(
      screen.getByText(/1 override set for Development: requestTimeout 5s/),
    ).toBeInTheDocument();
  });
});
