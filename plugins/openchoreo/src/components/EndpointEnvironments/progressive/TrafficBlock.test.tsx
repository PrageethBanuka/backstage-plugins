import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import { TrafficBlock } from './TrafficBlock';
import { ProgressiveDeliveryProvider } from './ProgressiveDeliveryContext';
import type { EndpointEnvironment } from './pdTypes';

function renderBlock(
  rollout: EndpointRollout,
  percent: number,
  manual = false,
) {
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
    rollout: { index: manual ? -1 : 0, percent, manual },
    promotionTargets: [],
  };
  render(
    <MemoryRouter initialEntries={['/deploy']}>
      <Routes>
        <Route
          path="/deploy/traffic/:envName"
          element={<p>Configure page</p>}
        />
        <Route
          path="/deploy"
          element={
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
                onCopy: jest.fn(),
              }}
            >
              <TrafficBlock
                env={
                  { name: 'Development', resourceName: 'development' } as any
                }
              />
            </ProgressiveDeliveryProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const base = { stable: 'trips', candidate: 'trips-v2' };

describe('TrafficBlock', () => {
  it('shows the weights for a canary, the pair named and tagged', () => {
    renderBlock({ ...base, strategy: 'canary', steps: [25, 100] }, 25);
    expect(
      screen.getByRole('img', {
        name: 'Traffic split: trips 75%, trips @ v2 25%',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(
      screen.getByText('trips-v2 gets 25% of trips’s traffic.'),
    ).toBeInTheDocument();
  });

  it('shows who blue/green serves and its preview', () => {
    renderBlock({ ...base, strategy: 'blueGreen', steps: [100] }, 100);
    expect(
      screen.getByRole('img', {
        name: 'Traffic split: trips 0%, trips @ v2 100%',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Blue/green · New')).toBeInTheDocument();
    expect(
      screen.getByText('trips-v2 has all of trips’s traffic.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('says a blue/green share between its two stages was set by hand', () => {
    renderBlock({ ...base, strategy: 'blueGreen', steps: [100] }, 30, true);
    expect(
      screen.getByText('Blue/green · 30% · set by hand'),
    ).toBeInTheDocument();
  });

  it('shows how much a mirror copies', () => {
    renderBlock({ ...base, strategy: 'mirror', steps: [10, 100] }, 10);
    expect(screen.getByText('10% to the new version')).toBeInTheDocument();
  });

  it('opens Configure traffic for the environment', () => {
    renderBlock({ ...base, strategy: 'canary', steps: [25, 100] }, 25);
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByText('Configure page')).toBeInTheDocument();
  });

  describe('with no rollout', () => {
    const renderPlain = (weights: [number, number], overrides = true) => {
      const backends = [
        { name: 'trips', componentName: 'trips', endpoint: 'http' },
        { name: 'trips-stale', componentName: 'trips-stale', endpoint: 'http' },
      ];
      render(
        <MemoryRouter>
          <ProgressiveDeliveryProvider
            value={{
              endpoint: {
                backends: backends.map(b => ({ ...b, weight: 1 })),
                rolloutSource: 'none',
                environments: [],
              },
              environments: [
                {
                  name: 'development',
                  displayName: 'Development',
                  bindingName: 'trips-api-development',
                  backends: backends.map((b, i) => ({
                    ...b,
                    weight: weights[i],
                    resolved: true,
                  })),
                  overrides: overrides
                    ? backends.map((b, i) => ({
                        name: b.name,
                        weight: weights[i],
                      }))
                    : [],
                  promotionTargets: [],
                },
              ],
              onCopy: jest.fn(),
            }}
          >
            <TrafficBlock
              env={{ name: 'Development', resourceName: 'development' } as any}
            />
          </ProgressiveDeliveryProvider>
        </MemoryRouter>,
      );
    };

    it('shows a split changed outside the portal', () => {
      renderPlain([80, 20]);
      expect(
        screen.getByText(
          /^Changed outside the portal, so it differs from the shares in Set up\. The next deploy or promote here applies those shares\.$/,
        ),
      ).toBeInTheDocument();
    });

    it('shows nothing when the environment keeps the shares of Set up', () => {
      renderPlain([100, 100]);
      expect(screen.queryByText('Traffic')).toBeNull();
    });
  });
});
