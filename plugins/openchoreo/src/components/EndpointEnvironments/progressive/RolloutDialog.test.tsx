import { fireEvent, render, screen } from '@testing-library/react';
import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import type { EndpointEnvironment, EndpointSummary } from './pdTypes';
import {
  ProgressiveDeliveryProvider,
  type ProgressiveDeliveryContextValue,
} from './ProgressiveDeliveryContext';
import { RolloutDialog, type RolloutDialogProps } from './RolloutDialog';

jest.mock('@openchoreo/backstage-plugin-react', () => ({
  useEndpointReleaseBindingUpdatePermission: () => ({
    canUpdate: true,
    loading: false,
    deniedTooltip: '',
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
  rolloutSource: 'plan',
  environments: [],
});

const env = (
  name: string,
  percent: number,
  extra: Partial<EndpointEnvironment> = {},
): EndpointEnvironment => ({
  name,
  displayName: name[0].toUpperCase() + name.slice(1),
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
  const ctx: ProgressiveDeliveryContextValue = {
    endpoint: endpoint(rollout),
    environments,
    onOpenRolloutDialog: jest.fn(),
    onCopy: jest.fn(),
  };
  const handlers: RolloutDialogProps = {
    env: environments[0],
    changeBlocked: '',
    onClose: jest.fn(),
    onSetStage: jest.fn(),
    ...props,
  };
  render(
    <ProgressiveDeliveryProvider value={ctx}>
      <RolloutDialog {...handlers} />
    </ProgressiveDeliveryProvider>,
  );
  return { ctx, handlers };
}

describe('RolloutDialog', () => {
  it('sets a canary share on the slider, previews it and saves it', () => {
    const dev = env('development', 25);
    const { handlers } = renderDialog(canary, [dev]);
    expect(screen.getByText('Canary in Development')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.keyDown(
      screen.getByRole('slider', { name: 'Share for the new version' }),
      { key: 'ArrowRight' },
    );
    expect(handlers.onSetStage).not.toHaveBeenCalled();
    expect(screen.getByText('New version 26%')).toBeInTheDocument();
    expect(
      screen.getByText(/serves 25% now. Save to change it/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSetStage).toHaveBeenCalledWith(dev, 26);
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('switches blue/green with a choice of two', () => {
    const blueGreen: EndpointRollout = {
      ...canary,
      strategy: 'blueGreen',
      steps: [100],
    };
    const dev = env('development', 0, {
      rollout: { index: 0, percent: 0, manual: false },
    });
    const { handlers } = renderDialog(blueGreen, [dev]);
    expect(screen.queryByRole('slider')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'New version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSetStage).toHaveBeenCalledWith(dev, 100);
  });

  it('changes nothing on Cancel', () => {
    const { handlers } = renderDialog(canary, [env('development', 25)]);
    fireEvent.keyDown(
      screen.getByRole('slider', { name: 'Share for the new version' }),
      { key: 'ArrowRight' },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onSetStage).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('configures only the environment it was opened for', () => {
    renderDialog(canary, [env('development', 25), env('staging', 5)]);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText(/Keep the new version/)).toBeNull();
  });

  it('names the backends by role in the controls and by component in the drawing', () => {
    renderDialog(canary, [env('development', 25)]);
    expect(screen.getByText('Current 75%')).toBeInTheDocument();
    expect(screen.getByText('New version 25%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trips-go/ })).toBeNull();
    expect(
      screen.getByRole('img', { name: /trips-go gets/ }),
    ).toBeInTheDocument();
  });

  it('copies the test command', () => {
    const { ctx } = renderDialog(canary, [env('development', 25)]);
    expect(
      screen.getByText("curl -H 'x-canary: true' http://development/trips"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy test command' }));
    expect(ctx.onCopy).toHaveBeenCalledWith(
      "curl -H 'x-canary: true' http://development/trips",
      'test command',
    );
  });

  it('steps a mirror by its copy share', () => {
    const mirror: EndpointRollout = {
      ...canary,
      strategy: 'mirror',
      steps: [10, 50, 100],
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
      rollout: { index: 1, percent: 10, manual: false },
    });
    const { handlers } = renderDialog(mirror, [dev]);
    expect(screen.queryByText('Test it')).toBeNull();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Copy of traffic' }), {
      key: 'ArrowRight',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSetStage).toHaveBeenCalledWith(dev, 11);
  });

  it('picks the next planned step and applies it on Save', () => {
    const dev = env('development', 25);
    const { handlers } = renderDialog(canary, [dev]);
    expect(
      screen.getByRole('img', { name: 'Step 2 of 4: 25%' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next step · 50%' }));
    expect(handlers.onSetStage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSetStage).toHaveBeenCalledWith(dev, 50);
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it('picks Current and applies it on Save', () => {
    const dev = env('development', 25);
    const { handlers } = renderDialog(canary, [dev]);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Current' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSetStage).toHaveBeenCalledWith(dev, 0);
  });

  it('shows the requested share while traffic is still moving', () => {
    renderDialog(canary, [
      env('development', 5, {
        overrides: [
          { name: 'trips-python', weight: 75 },
          { name: 'trips-go', weight: 25 },
        ],
      }),
    ]);
    expect(
      screen.getByText('Set 25% · Actual 5%, applying'),
    ).toBeInTheDocument();
  });

  it('gives the command that reaches Current as well', () => {
    renderDialog(canary, [env('development', 25)]);
    expect(
      screen.getByText(/curl http:\/\/development\/trips/),
    ).toBeInTheDocument();
    expect(screen.getByText(/It is not\s+access control/)).toBeInTheDocument();
  });

  it('points to Promote in an environment the rollout has not reached', () => {
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
      screen.getByText(/Promote the release from Development to start it here/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
