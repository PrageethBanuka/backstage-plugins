import { fireEvent, render, screen } from '@testing-library/react';
import type {
  EndpointEnvironment,
  EndpointRollout,
  EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import { EndpointMiniEnvironmentNode } from './EndpointMiniEnvironmentNode';
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
    ...(rollout
      ? [{ componentName: 'trips-go', endpoint: 'http', weight: 0 }]
      : []),
  ],
  rollout,
  rolloutSource: rollout ? 'annotation' : 'none',
  environments: [],
  latestRelease: 'rel-1',
});

const dev = (percent?: number): EndpointEnvironment => ({
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
      weight: 100 - (percent ?? 0),
      resolved: true,
    },
    ...(percent === undefined
      ? []
      : [
          {
            componentName: 'trips-go',
            endpoint: 'http',
            weight: percent,
            resolved: true,
          },
        ]),
  ],
  overrides: [],
  rollout:
    percent === undefined
      ? undefined
      : { index: [0, 5, 25, 50, 100].indexOf(percent), percent, manual: false },
  deployedBackends: ['trips-python/http', 'trips-go/http'],
  promotionTargets: [{ name: 'staging' }],
});

const staging: EndpointEnvironment = {
  ...dev(),
  name: 'staging',
  displayName: 'Staging',
  bindingName: undefined,
  endpointRelease: undefined,
  status: 'NotRouted',
  promotionTargets: [],
};

function renderTile(
  env: EndpointEnvironment,
  ctx: Partial<EndpointEnvironmentsContextValue>,
) {
  const value: EndpointEnvironmentsContextValue = {
    mode: 'deploy',
    endpoint: endpoint(),
    environments: [env, staging],
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
    ...ctx,
  };
  render(
    <EndpointEnvironmentsProvider value={value}>
      <EndpointMiniEnvironmentNode
        env={env}
        selected={false}
        onSelect={jest.fn()}
      />
    </EndpointEnvironmentsProvider>,
  );
  return value;
}

describe('EndpointMiniEnvironmentNode', () => {
  it('is the Resource tile on the Deploy tab: status and Promote', () => {
    const ctx = renderTile(dev(), {});
    expect(screen.getByTestId('status-badge')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /promote development/i }),
    );
    expect(ctx.onRollOut).toHaveBeenCalledWith('staging', 'rel-1');
  });

  it('links to the Rollout tab from the Deploy tab while a rollout runs', () => {
    const ctx = renderTile(dev(25), { endpoint: endpoint(canary) });
    fireEvent.click(screen.getByRole('button', { name: /open the rollout/i }));
    expect(ctx.onOpenRollout).toHaveBeenCalled();
    expect(screen.queryByText('Advance to 50%')).not.toBeInTheDocument();
  });

  it('shows the stage and the next step on the Rollout tab', () => {
    const env = dev(25);
    const ctx = renderTile(env, {
      mode: 'rollout',
      endpoint: endpoint(canary),
    });
    expect(screen.getByText('Canary 25%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Advance to 50%' }));
    expect(ctx.onRolloutAction).toHaveBeenCalledWith(
      'development',
      expect.objectContaining({ kind: 'stage', percent: 50 }),
    );
  });

  it('offers Keep only once every environment is at 100%', () => {
    renderTile(dev(100), { mode: 'rollout', endpoint: endpoint(canary) });
    expect(
      screen.getByRole('button', { name: 'Keep only trips-go' }),
    ).toBeInTheDocument();
  });
});
