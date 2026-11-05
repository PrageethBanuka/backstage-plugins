import { render, screen } from '@testing-library/react';
import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import { TrafficBlock } from './TrafficBlock';
import { ProgressiveDeliveryProvider } from './ProgressiveDeliveryContext';
import type { EndpointEnvironment } from './pdTypes';

function renderBlock(rollout: EndpointRollout, percent: number) {
  const mirror = rollout.strategy === 'mirror';
  const dev: EndpointEnvironment = {
    name: 'development',
    displayName: 'Development',
    bindingName: 'trips-api-development',
    backends: [
      {
        name: 'trips',
        componentName: 'trips',
        endpoint: 'http',
        weight: mirror ? 100 : 100 - percent,
        resolved: true,
      },
      {
        name: 'trips-v2',
        componentName: 'trips',
        releaseLine: 'v2',
        endpoint: 'http',
        weight: mirror ? 0 : percent,
        resolved: true,
      },
    ],
    overrides: [],
    rollout: { index: 0, percent, manual: false },
    promotionTargets: [],
  };
  render(
    <ProgressiveDeliveryProvider
      value={{
        endpoint: {
          backends: [
            {
              name: 'trips',
              componentName: 'trips',
              endpoint: 'http',
              weight: 100,
            },
            {
              name: 'trips-v2',
              componentName: 'trips',
              releaseLine: 'v2',
              endpoint: 'http',
              weight: 0,
              ...(mirror
                ? { mirror: { percent: 10 } }
                : {
                    match: {
                      headers: [{ name: 'x-preview', value: 'green' }],
                    },
                  }),
            },
          ],
          rollout,
          rolloutSource: 'plan',
          environments: [],
        },
        environments: [dev],
        onOpenRolloutDialog: jest.fn(),
        onCopy: jest.fn(),
      }}
    >
      <TrafficBlock
        env={{ name: 'Development', resourceName: 'development' } as any}
      />
    </ProgressiveDeliveryProvider>,
  );
}

const base = { stable: 'trips', candidate: 'trips-v2' };

describe('TrafficBlock', () => {
  it('shows the weights for a canary', () => {
    renderBlock({ ...base, strategy: 'canary', steps: [25, 100] }, 25);
    expect(
      screen.getByRole('img', { name: /Traffic split/ }),
    ).toBeInTheDocument();
  });

  it('shows who blue/green serves and its preview, without weights', () => {
    renderBlock({ ...base, strategy: 'blueGreen', steps: [100] }, 100);
    expect(screen.queryByRole('img', { name: /Traffic split/ })).toBeNull();
    expect(screen.getByText('Serving everyone')).toBeInTheDocument();
    expect(screen.getByText('New version')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('shows how much a mirror copies', () => {
    renderBlock({ ...base, strategy: 'mirror', steps: [10, 100] }, 10);
    expect(screen.getByText('10% to trips · v2')).toBeInTheDocument();
  });
});
