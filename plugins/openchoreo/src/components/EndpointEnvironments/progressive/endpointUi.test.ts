import type { EndpointEnvironment } from './pdTypes';
import { indigo, teal } from '@material-ui/core/colors';
import {
  backendColors,
  describeSplit,
  missingBackends,
  pairFirst,
  roleOf,
  sharePercents,
} from './endpointUi';

describe('sharePercents', () => {
  it('turns weights into percentages', () => {
    expect(sharePercents([90, 10])).toEqual([90, 10]);
    expect(sharePercents([9, 1])).toEqual([90, 10]);
  });

  it('always adds up to 100', () => {
    expect(sharePercents([1, 2])).toEqual([33, 67]);
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('gives zeros when no backend has weight', () => {
    expect(sharePercents([0, 0])).toEqual([0, 0]);
  });
});

describe('describeSplit', () => {
  it('reads the split as text', () => {
    expect(
      describeSplit([
        { componentName: 'payments-v1', endpoint: 'http', weight: 90 },
        { componentName: 'payments-v2', endpoint: 'http', weight: 10 },
      ]),
    ).toBe('payments-v1 90%, payments-v2 10%');
  });
});

describe('missingBackends', () => {
  const env = {
    name: 'staging',
    deployedBackends: ['payments-v1/http'],
  } as EndpointEnvironment;

  it('lists weighted backends that are not deployed', () => {
    expect(
      missingBackends(env, [
        { componentName: 'payments-v1', endpoint: 'http', weight: 90 },
        { componentName: 'payments-v2', endpoint: 'http', weight: 10 },
      ]),
    ).toEqual(['payments-v2']);
  });

  it('ignores a backend staged at 0%', () => {
    expect(
      missingBackends(env, [
        { componentName: 'payments-v1', endpoint: 'http', weight: 100 },
        { componentName: 'payments-v2', endpoint: 'http', weight: 0 },
      ]),
    ).toEqual([]);
  });
});

describe('rollout colours', () => {
  const pair = { stable: 'trips-python', candidate: 'trips-go' };
  const names = ['storefront', 'trips-python', 'storefront-recs', 'trips-go'];

  it('names the pair by role', () => {
    expect(roleOf('trips-python', pair)).toBe('Current');
    expect(roleOf('trips-go', pair)).toBe('New');
    expect(roleOf('storefront', pair)).toBeUndefined();
    expect(roleOf('trips-python')).toBeUndefined();
  });

  it('gives Current the blue and New teal, the others lighter blues', () => {
    const colors = backendColors(names, pair);
    expect(colors.get('trips-python')).toBe(indigo[500]);
    expect(colors.get('trips-go')).toBe(teal[500]);
    expect(colors.get('storefront')).toBe(indigo[200]);
    expect(colors.get('storefront-recs')).toBe(indigo[100]);
  });

  it('uses only blues without a rollout', () => {
    const colors = [...backendColors(names).values()];
    expect(colors[0]).toBe(indigo[500]);
    expect(colors).not.toContain(teal[500]);
    expect(new Set(colors).size).toBe(names.length);
  });

  it('puts the pair first, Current then New', () => {
    expect(pairFirst(names, n => n, pair)).toEqual([
      'trips-python',
      'trips-go',
      'storefront',
      'storefront-recs',
    ]);
    expect(pairFirst(names, n => n)).toBe(names);
  });
});
