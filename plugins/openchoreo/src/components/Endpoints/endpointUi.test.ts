import type { EndpointEnvironment } from '@openchoreo/backstage-plugin-common';
import { describeSplit, missingBackends, sharePercents } from './endpointUi';

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
