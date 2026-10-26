import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  EndpointEnvironment,
  EndpointRule,
} from '@openchoreo/backstage-plugin-common';
import {
  EnvironmentWeightsDialog,
  weightPresets,
} from './EnvironmentWeightsDialog';
import { describeRule } from './endpointUi';

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
  rules: [],
  deployedBackends: [],
  promotionTargets: [],
});

const preview: EndpointRule = {
  name: 'preview',
  matches: [{ headers: [{ name: 'x-preview', value: 'green' }] }],
  backends: [{ name: 'checkout-green' }],
};

describe('weightPresets', () => {
  it('offers nothing for a split set up by hand', () => {
    expect(
      weightPresets(
        [
          backend('trips-python', 60),
          backend('trips-legacy', 30),
          backend('trips-go', 10),
        ],
        [],
      ),
    ).toEqual([]);
  });

  it('offers canary steps and a rollback', () => {
    expect(
      weightPresets(
        [backend('trips-python', 100), backend('trips-go', 0)],
        [
          {
            name: 'canary-testers',
            matches: [{ headers: [{ name: 'x-canary', value: 'true' }] }],
            backends: [{ name: 'trips-go' }],
          },
        ],
      ).map(p => p.label),
    ).toEqual([
      'Canary 5%',
      'Canary 25%',
      'Canary 50%',
      'Promote: 100%',
      'Roll back: 0%',
    ]);
  });

  it('offers the blue/green switch and switch-back', () => {
    const presets = weightPresets(
      [backend('checkout-blue', 100), backend('checkout-green', 0)],
      [preview],
    );
    expect(presets[0]).toEqual({
      label: 'Switch to checkout-green',
      weights: { 'checkout-green': 100, 'checkout-blue': 0 },
    });
    expect(presets[1].label).toBe('Switch back to checkout-blue');
  });
});

describe('weightPresets during a rollout', () => {
  it('offers the stages with the stable ratio kept', () => {
    const presets = weightPresets(
      [
        backend('trips-python', 70),
        backend('trips-legacy', 30),
        backend('trips-go', 0),
      ],
      [],
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
      'Roll back to trips-python + trips-legacy',
      'Advance to 25%',
      'Send all traffic to trips-go',
    ]);
    expect(presets[1].weights).toEqual({
      'trips-python': 53,
      'trips-legacy': 22,
      'trips-go': 25,
    });
  });
});

describe('describeRule', () => {
  it('reads a rule as a sentence', () => {
    expect(describeRule(preview)).toBe(
      'when x-preview: green → checkout-green',
    );
    expect(
      describeRule({
        name: 'default',
        backends: [
          { name: 'a', weight: 90 },
          { name: 'b', weight: 10 },
        ],
        mirrors: [{ backend: 'b', percent: 5 }],
      }),
    ).toBe('every other request → a (90), b (10), mirror 5% to b');
  });
});

describe('EnvironmentWeightsDialog', () => {
  it('switches blue/green in one environment with a preset', async () => {
    const onSave = jest.fn().mockResolvedValue({ applied: true });
    render(
      <EnvironmentWeightsDialog
        open
        env={env({ 'checkout-blue': 100, 'checkout-green': 0 })}
        backends={[backend('checkout-blue', 100), backend('checkout-green', 0)]}
        rules={[preview]}
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
        rules={[]}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: "Reset to the Endpoint's weights" }),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('development', []));
  });
});
