import { render, screen } from '@testing-library/react';
import type { EndpointRollout } from '@openchoreo/backstage-plugin-common';
import {
  RolloutStepTrack,
  stepCaption,
  visibleSlots,
} from './RolloutStepTrack';

const canary = (steps: number[]): EndpointRollout => ({
  strategy: 'canary',
  stable: 'v1',
  candidate: 'v2',
  baseline: [],
  steps,
});

const states = () =>
  screen.getAllByText(/%$/).map(e => `${e.textContent}:${e.dataset.state}`);

describe('RolloutStepTrack', () => {
  it('marks the stages passed, the current one and the ones to come', () => {
    render(
      <RolloutStepTrack
        rollout={canary([10, 25, 50, 100])}
        position={{ index: 2, percent: 25, manual: false }}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Step 2 of 4: 25%' }),
    ).toBeInTheDocument();
    expect(states()).toEqual([
      '0%:done',
      '10%:done',
      '25%:current',
      '50%:upcoming',
      '100%:upcoming',
    ]);
  });

  it('has no current stage when the weights were set by hand', () => {
    const rollout = canary([10, 25, 50, 100]);
    const position = { index: -1, percent: 40, manual: true };
    render(<RolloutStepTrack rollout={rollout} position={position} />);
    expect(
      screen.getByRole('img', { name: 'Set by hand: 40%' }),
    ).toBeInTheDocument();
    expect(states()).not.toContainEqual(expect.stringContaining('current'));
    expect(stepCaption(rollout, position)).toBe('Set by hand · next 50%');
  });

  it('says when an environment is at the last step', () => {
    expect(
      stepCaption(canary([50, 100]), { index: 2, percent: 100, manual: false }),
    ).toBe('Step 2 of 2 · last step');
  });
});

describe('visibleSlots', () => {
  const stateOf = (i: number, current: number) => {
    if (i < current) return 'done' as const;
    return i === current ? ('current' as const) : ('upcoming' as const);
  };
  const stages = (n: number, current: number) =>
    Array.from({ length: n }, (_, i) => ({
      label: `${i}`,
      state: stateOf(i, current),
    }));
  const labels = (n: number, current: number) =>
    visibleSlots(stages(n, current)).map(s => (s === 'gap' ? '…' : s.label));

  it('draws every stage of a short plan', () => {
    expect(labels(3, 1)).toEqual(['0', '1', '2']);
    expect(labels(7, 6)).toHaveLength(7);
  });

  it('draws a long plan as seven slots around the current stage', () => {
    expect(labels(12, 1)).toEqual(['0', '1', '2', '3', '4', '…', '11']);
    expect(labels(12, 6)).toEqual(['0', '…', '5', '6', '7', '…', '11']);
    expect(labels(12, 10)).toEqual(['0', '…', '7', '8', '9', '10', '11']);
    for (let c = 0; c < 12; c++) expect(labels(12, c)).toHaveLength(7);
  });
});
