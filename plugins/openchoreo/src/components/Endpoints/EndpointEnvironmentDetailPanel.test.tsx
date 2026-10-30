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

const withMatch = (e: EndpointSummary): EndpointSummary => ({
  ...e,
  backends: [
    e.backends[0],
    {
      ...e.backends[1],
      match: { headers: [{ name: 'x-canary', value: 'true' }] },
    },
  ],
});

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
  rollout: { index: 2, percent: 25, manual: false },
  deployedBackends: ['trips-python/http', 'trips-go/http'],
  promotionTargets: [{ name: 'staging' }],
};

const staging: EndpointEnvironment = {
  ...dev,
  name: 'staging',
  displayName: 'Staging',
  bindingName: 'trips-api-staging',
  backends: [dev.backends[0]],
  rollout: undefined,
  environmentConfigs: {},
  promotionTargets: [],
};

function renderPanel(
  rollout?: EndpointRollout,
  opts: { env?: EndpointEnvironment; staging?: EndpointEnvironment } = {},
) {
  const env = opts.env ?? dev;
  const value: EndpointEnvironmentsContextValue = {
    mode: rollout ? 'rollout' : 'deploy',
    endpoint: withMatch(endpoint(rollout)),
    environments: [dev, opts.staging ?? staging].map(e =>
      e.name === env.name ? env : e,
    ),
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
    onOpenRolloutDialog: jest.fn(),
    onCopy: jest.fn(),
  };
  render(
    <EndpointEnvironmentsProvider value={value}>
      <EndpointEnvironmentDetailPanel env={env} onClose={jest.fn()} />
    </EndpointEnvironmentsProvider>,
  );
  return value;
}

describe('EndpointEnvironmentDetailPanel', () => {
  it.each([
    ['with no rollout', undefined],
    ['while a rollout runs', canary],
  ])(
    'shows the release, artifacts, actions and danger zone %s',
    (_label, rollout) => {
      const ctx = renderPanel(rollout);
      expect(screen.getByText('Deployed')).toBeInTheDocument();
      expect(screen.getByText('1 hour ago')).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: /View K8s Artifacts/ }),
      );
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
        screen.getByText(/Overrides: requestTimeout 5s/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Danger zone' }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Promote from/)).toBeNull();
    },
  );

  it('promotes the release to the next environment with no rollout', () => {
    const ctx = renderPanel(undefined, {
      staging: { ...staging, endpointRelease: 'rel-0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    expect(ctx.onRollOut).toHaveBeenCalledWith('staging', 'rel-1');
  });

  it('promotes the rollout from where it runs, with the new version at 0%', () => {
    const ctx = renderPanel(canary);
    expect(screen.getByText(/with trips-go at 0%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    expect(ctx.onRolloutAction).toHaveBeenCalledWith(
      'staging',
      expect.objectContaining({ kind: 'promote', from: 'development' }),
    );
    expect(ctx.onRollOut).not.toHaveBeenCalled();
  });

  it('shows the rollout as one line with Manage rollout, and no steps', () => {
    const ctx = renderPanel(canary);
    expect(screen.getByText('Canary')).toBeInTheDocument();
    expect(screen.getByText('Canary 25%')).toBeInTheDocument();
    expect(
      screen.getByText('x-canary: true always reaches trips-go'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Advance to/ })).toBeNull();
    expect(screen.queryByText('Preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manage rollout' }));
    expect(ctx.onOpenRolloutDialog).toHaveBeenCalledWith('development');
  });

  it('shows no rollout line for a split set by hand', () => {
    renderPanel(undefined, {
      env: {
        ...dev,
        backends: [
          { ...dev.backends[0], weight: 70 },
          { ...dev.backends[1], weight: 30 },
        ],
        rollout: undefined,
      },
    });
    expect(screen.getByText('Traffic')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage rollout' })).toBeNull();
  });
});
