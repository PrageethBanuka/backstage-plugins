import { render, screen } from '@testing-library/react';
import {
  StrategyFlow,
  flowLabels,
  previewRule,
  toFlowVersion,
} from './StrategyFlow';

const header = { kind: 'header' as const, name: 'x-canary', value: 'true' };

describe('previewRule', () => {
  it('names the header, cookie or path that reaches the new version', () => {
    expect(previewRule(header)).toBe('x-canary: true');
    expect(previewRule({ kind: 'cookie', name: 'exp_api', value: 'b' })).toBe(
      'cookie exp_api=b',
    );
    expect(previewRule({ kind: 'path', name: 'path', value: '/preview' })).toBe(
      'path /preview',
    );
    expect(previewRule(undefined)).toBe('');
  });
});

describe('flowLabels', () => {
  it('splits a canary by its share, with the testers rule on the new version', () => {
    expect(flowLabels('canary', header, 25)).toEqual({
      current: '75%',
      next: '25% · x-canary: true',
      copy: false,
    });
    expect(flowLabels('canary', header, 0).next).toBe('x-canary: true');
  });

  it('leaves out percentages before the rollout starts', () => {
    expect(flowLabels('canary', header, undefined)).toEqual({
      current: 'everyone else',
      next: 'x-canary: true',
      copy: false,
    });
    expect(flowLabels('mirror', undefined, undefined).next).toBe('copy');
  });

  it('sends everyone to the new version once blue/green switches', () => {
    const green = {
      kind: 'header' as const,
      name: 'x-preview',
      value: 'green',
    };
    expect(flowLabels('blueGreen', green, 0).next).toBe('x-preview: green');
    expect(flowLabels('blueGreen', green, 100)).toEqual({
      current: '0%',
      next: 'everyone',
      copy: false,
    });
  });

  it('copies a share of requests for a mirror', () => {
    expect(flowLabels('mirror', undefined, 10)).toEqual({
      current: 'all requests',
      next: 'copy 10%',
      copy: true,
    });
  });
});

describe('StrategyFlow', () => {
  it('names each version by its component and release line', () => {
    render(
      <StrategyFlow
        strategy="canary"
        preview={header}
        percent={25}
        current={toFlowVersion(
          { componentName: 'trips' },
          { componentName: 'trips', releaseLine: 'v2' },
          '#3f51b5',
        )}
        next={{ name: 'trips', line: 'v2', color: '#009688' }}
      />,
    );

    expect(
      screen.getByRole('img', {
        name: 'trips gets 75%; trips gets 25% · x-canary: true',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('trips · main')).toBeInTheDocument();
    expect(screen.getByText('trips · v2')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('leaves out the line of a version from another component', () => {
    expect(
      toFlowVersion(
        { componentName: 'orders' },
        { componentName: 'trips' },
        '#000',
      ).line,
    ).toBeUndefined();
  });
});
