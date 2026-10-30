import { fireEvent, render, screen } from '@testing-library/react';
import type {
  EndpointEnvironment,
  EndpointRollout,
  EndpointSummary,
} from '@openchoreo/backstage-plugin-common';
import {
  EndpointEnvironmentsProvider,
  type EndpointEnvironmentsContextValue,
} from './EndpointEnvironmentsContext';
import { RolloutDialog, type RolloutDialogProps } from './RolloutDialog';

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
  preview: { kind: 'header', name: 'x-canary', value: 'true' },
};

const endpoint = (rollout: EndpointRollout): EndpointSummary => ({
  name: 'trips-api',
  namespaceName: 'default',
  projectName: 'trips',
  type: { kind: 'ClusterEndpointType', name: 'http' },
  visibility: ['external'],
  autoDeploy: true,
  backends: [
    { componentName: 'trips-python', endpoint: 'http', weight: 100 },
    {
      componentName: 'trips-go',
      endpoint: 'http',
      weight: 0,
      ...(rollout.strategy === 'mirror'
        ? { mirror: { percent: 10 } }
        : { match: { headers: [{ name: 'x-canary', value: 'true' }] } }),
    },
  ],
  rollout,
  rolloutSource: 'annotation',
  environments: [],
});

const env = (
  name: string,
  percent: number,
  extra: Partial<EndpointEnvironment> = {},
): EndpointEnvironment => ({
  name,
  displayName: name[0].toUpperCase() + name.slice(1),
  isProduction: false,
  bindingName: `trips-api-${name}`,
  invokeURL: `http://${name}/trips`,
  status: 'Routing',
  backends: [
    {
      componentName: 'trips-python',
      endpoint: 'http',
      weight: 100 - percent,
      resolved: true,
    },
    {
      componentName: 'trips-go',
      endpoint: 'http',
      weight: percent,
      resolved: true,
    },
  ],
  overrides: [],
  rollout: {
    index: [0, 5, 25, 50, 100].indexOf(percent),
    percent,
    manual: false,
  },
  deployedBackends: ['trips-python/http', 'trips-go/http'],
  promotionTargets: [],
  ...extra,
});

function renderDialog(
  rollout: EndpointRollout,
  environments: EndpointEnvironment[],
  props: Partial<RolloutDialogProps> = {},
) {
  const ctx: EndpointEnvironmentsContextValue = {
    mode: 'rollout',
    endpoint: endpoint(rollout),
    environments,
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
  const handlers: RolloutDialogProps = {
    env: environments[0],
    changeBlocked: '',
    onClose: jest.fn(),
    onSetStage: jest.fn(),
    onKeep: jest.fn(),
    onConvert: jest.fn(),
    onRemove: jest.fn(),
    ...props,
  };
  render(
    <EndpointEnvironmentsProvider value={ctx}>
      <RolloutDialog {...handlers} />
    </EndpointEnvironmentsProvider>,
  );
  return { ctx, handlers };
}

describe('RolloutDialog', () => {
  it('runs the next step, any stage and roll back for the environment', () => {
    const dev = env('development', 25);
    const { ctx, handlers } = renderDialog(canary, [dev]);
    expect(screen.getByText('Canary · trips-go')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Advance to 50%' }));
    expect(handlers.onSetStage).toHaveBeenCalledWith(dev, 50, 'Advance to 50%');

    fireEvent.click(screen.getByRole('button', { name: 'Canary 5%' }));
    expect(handlers.onSetStage).toHaveBeenCalledWith(
      dev,
      5,
      expect.any(String),
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Roll back to trips-python/ }),
    );
    expect(ctx.onRollBack).toHaveBeenCalledWith('development');
  });

  it('applies a share set in the traffic editor', () => {
    const dev = env('development', 25);
    const { handlers } = renderDialog(canary, [dev]);
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Traffic share'), {
      target: { value: '30' },
    });
    fireEvent.click(apply);
    expect(handlers.onSetStage).toHaveBeenCalledWith(
      dev,
      30,
      'Send 30% to trips-go',
    );
  });

  it('copies the preview command', () => {
    const { ctx } = renderDialog(canary, [env('development', 25)]);
    expect(
      screen.getByText("curl -H 'x-canary: true' http://development/trips"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy preview command' }),
    );
    expect(ctx.onCopy).toHaveBeenCalledWith(
      "curl -H 'x-canary: true' http://development/trips",
      'preview command',
    );
  });

  it('keeps Keep only disabled until every environment is at 100%', () => {
    const { handlers } = renderDialog(canary, [
      env('development', 100),
      env('staging', 25),
    ]);
    expect(
      screen.getByRole('button', { name: 'Keep only trips-go' }),
    ).toBeDisabled();
    expect(screen.getByText(/in every environment first/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove trips-go' }));
    expect(handlers.onClose).toHaveBeenCalled();
    expect(handlers.onRemove).toHaveBeenCalled();
  });

  it('offers Keep only once every environment is at 100%', () => {
    const { handlers } = renderDialog(canary, [env('development', 100)]);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Keep only trips-go' })[0],
    );
    expect(handlers.onKeep).toHaveBeenCalled();
  });

  it('turns a mirror into a canary and edits its copy share', () => {
    const mirror: EndpointRollout = {
      ...canary,
      strategy: 'mirror',
      steps: [5, 10, 25, 50, 100],
      preview: undefined,
    };
    const dev = env('development', 0, {
      backends: [
        {
          componentName: 'trips-python',
          endpoint: 'http',
          weight: 100,
          resolved: true,
        },
        {
          componentName: 'trips-go',
          endpoint: 'http',
          weight: 0,
          resolved: true,
          mirror: { percent: 10 },
        },
      ],
      rollout: { index: 2, percent: 10, manual: false },
    });
    const { handlers } = renderDialog(mirror, [dev]);
    expect(screen.queryByText('Preview')).toBeNull();
    fireEvent.change(screen.getByLabelText('Copy share'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(handlers.onSetStage).toHaveBeenCalledWith(dev, 40, 'Copy 40%');

    fireEvent.click(screen.getByRole('button', { name: 'Turn into a canary' }));
    expect(handlers.onConvert).toHaveBeenCalled();
  });

  it('points to Promote when the rollout has not reached the environment', () => {
    const dev = env('development', 25);
    const staging = env('staging', 0, {
      backends: [
        {
          componentName: 'trips-python',
          endpoint: 'http',
          weight: 100,
          resolved: true,
        },
      ],
      rollout: undefined,
    });
    renderDialog(canary, [dev, staging], { env: staging });
    expect(
      screen.getByText(/Use Promote on Development to bring it here at 0%/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });
});
