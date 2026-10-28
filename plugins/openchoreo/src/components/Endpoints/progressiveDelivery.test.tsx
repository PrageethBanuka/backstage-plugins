import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EndpointEnvironment } from '@openchoreo/backstage-plugin-common';
import {
  EnvironmentWeightsDialog,
  weightPresets,
} from './EnvironmentWeightsDialog';
import { describeMatch, describeReach } from './endpointUi';

const backend = (name: string, weight: number) => ({
  name,
  componentName: name,
  endpoint: 'http',
  weight,
});

const env = (
  weights: Record<string, number>,
  overrides: EndpointEnvironment['overrides'] = [],
): EndpointEnvironment => ({
  name: 'development',
  displayName: 'Development',
  isProduction: false,
  status: 'Routing',
  bindingName: 'checkout-development',
  endpointRelease: 'checkout-aaa',
  backends: Object.entries(weights).map(([name, weight]) => ({
    ...backend(name, weight),
    resolved: true,
  })),
  overrides,
  deployedBackends: [],
  promotionTargets: [],
});

// Green at weight 0, reached by the preview header.
const green = {
  ...backend('checkout-green', 0),
  match: { headers: [{ name: 'x-preview', value: 'green' }] },
};

describe('weightPresets', () => {
  it('offers nothing for a split set up by hand', () => {
    expect(
      weightPresets([
        backend('trips-python', 60),
        backend('trips-legacy', 30),
        backend('trips-go', 10),
      ]),
    ).toEqual([]);
  });

  it('offers canary steps and a rollback', () => {
    expect(
      weightPresets([
        backend('trips-python', 100),
        {
          ...backend('trips-go', 0),
          match: { headers: [{ name: 'x-canary', value: 'true' }] },
        },
      ]).map(p => p.label),
    ).toEqual([
      'Canary 5%',
      'Canary 25%',
      'Canary 50%',
      'All traffic: 100%',
      'Roll back: 0%',
    ]);
  });

  it('offers no weight presets for a mirror', () => {
    expect(
      weightPresets(
        [
          backend('trips-python', 100),
          { ...backend('trips-go', 0), mirror: { percent: 10 } },
        ],
        {
          strategy: 'mirror',
          stable: 'trips-python',
          candidate: 'trips-go',
          steps: [5, 10, 100],
        },
      ),
    ).toEqual([]);
  });
});

describe('weightPresets during a rollout', () => {
  it('offers the stages and leaves the untouched backend alone', () => {
    const presets = weightPresets(
      [
        backend('trips-python', 70),
        backend('trips-legacy', 30),
        backend('trips-go', 0),
      ],
      {
        strategy: 'canary',
        stable: 'trips-python',
        candidate: 'trips-go',
        baseline: [
          { name: 'trips-python', weight: 70 },
          { name: 'trips-legacy', weight: 30 },
        ],
        steps: [25, 100],
      },
    );
    expect(presets.map(p => p.label)).toEqual([
      'Roll back to trips-python',
      'Advance to 25%',
      'Send all traffic to trips-go',
    ]);
    expect(presets[1].weights).toEqual({
      'trips-python': 5250,
      'trips-legacy': 3000,
      'trips-go': 1750,
    });
  });
});

describe('describeMatch', () => {
  it("reads a backend's match and mirror as a line", () => {
    expect(describeMatch(green.match)).toBe('x-preview: green');
    expect(
      describeMatch({
        path: { value: '/next' },
        headers: [
          { name: 'user-agent', type: 'RegularExpression', value: '.*Mobi.*' },
        ],
        cookies: [{ name: 'exp', value: 'b' }],
      }),
    ).toBe('path /next/… and user-agent ~ .*Mobi.* and cookie exp=b');
    expect(
      describeReach({ ...backend('shadow', 0), mirror: { percent: 10 } }),
    ).toBe('a copy of 10% of traffic');
    expect(describeReach(backend('blue', 100))).toBe('');
  });
});

describe('EnvironmentWeightsDialog', () => {
  it('switches blue/green in one environment with a preset', async () => {
    const onSave = jest.fn().mockResolvedValue({ applied: true });
    render(
      <EnvironmentWeightsDialog
        open
        env={env({ 'checkout-blue': 100, 'checkout-green': 0 })}
        backends={[backend('checkout-blue', 100), green]}
        rollout={{
          strategy: 'blueGreen',
          stable: 'checkout-blue',
          candidate: 'checkout-green',
          steps: [100],
        }}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to checkout-green' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply here' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('development', [
        { name: 'checkout-blue', weight: 0 },
        { name: 'checkout-green', weight: 100 },
      ]),
    );
  });

  it("clears the environment's weights", async () => {
    const onSave = jest.fn().mockResolvedValue({ applied: true });
    render(
      <EnvironmentWeightsDialog
        open
        env={env({ a: 50, b: 50 }, [{ name: 'b', weight: 50 }])}
        backends={[backend('a', 90), backend('b', 10)]}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: "Reset to the Endpoint's weights" }),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('development', []));
  });

  it("sets a mirror's copy share next to the weights", async () => {
    const onSave = jest.fn().mockResolvedValue({ applied: true });
    render(
      <EnvironmentWeightsDialog
        open
        env={env({ blue: 100, shadow: 0 })}
        backends={[
          backend('blue', 100),
          { ...backend('shadow', 0), mirror: { percent: 100 } },
        ]}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText(/shadow/, { selector: 'input' }), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply here' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('development', [
        { name: 'blue', weight: 100 },
        { name: 'shadow', mirror: { percent: 10 } },
      ]),
    );
  });
});
