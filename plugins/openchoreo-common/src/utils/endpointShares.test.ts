import {
  hasShare,
  shareProblem,
  splitPercents,
  withShare,
} from './endpointShares';

const backend = (name: string, weight: number, extra = {}) => ({
  name,
  componentName: name,
  endpoint: 'http',
  weight,
  ...extra,
});

const beta = backend('trips-beta', 0, {
  match: { headers: [{ name: 'x-beta', value: 'true' }] },
});

describe('splitPercents', () => {
  it('splits by weight into whole numbers that add up to the total', () => {
    expect(splitPercents([1, 2])).toEqual([33, 67]);
    expect(splitPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitPercents([1, 1], 50)).toEqual([25, 25]);
  });

  it('gives 0s when nothing has weight', () => {
    expect(splitPercents([0, 0])).toEqual([0, 0]);
  });
});

describe('hasShare', () => {
  it('is true only for a backend with weight and no match or mirror', () => {
    expect(hasShare(backend('trips-python', 1))).toBe(true);
    expect(hasShare(backend('trips-python', 0))).toBe(false);
    expect(hasShare(beta)).toBe(false);
    expect(
      hasShare(backend('trips-copy', 0, { mirror: { percent: 10 } })),
    ).toBe(false);
  });
});

describe('withShare', () => {
  const backends = [
    backend('trips-python', 1),
    backend('trips-stale', 3),
    beta,
  ];

  it('gives the backend its share and keeps the others in their ratio', () => {
    expect(
      withShare(backends, backends[0], 60).map(b => [b.name, b.weight]),
    ).toEqual([
      ['trips-python', 60],
      ['trips-stale', 40],
      ['trips-beta', 0],
    ]);
  });

  it('adds a backend that is not one yet', () => {
    expect(
      withShare(backends, backend('trips-go', 0), 20).map(b => [
        b.name,
        b.weight,
      ]),
    ).toEqual([
      ['trips-python', 20],
      ['trips-stale', 60],
      ['trips-beta', 0],
      ['trips-go', 20],
    ]);
  });
});

describe('shareProblem', () => {
  const backends = [backend('trips-python', 1)];

  it('accepts a whole percentage that leaves some backend a share', () => {
    expect(shareProblem(backends, backend('trips-go', 0), 30)).toBe('');
  });

  it('refuses a share that is not a whole percentage', () => {
    expect(shareProblem(backends, backends[0], 101)).toMatch(
      /whole percentage/,
    );
    expect(shareProblem(backends, backends[0], 2.5)).toMatch(
      /whole percentage/,
    );
  });

  it('refuses to leave no backend with a share', () => {
    expect(shareProblem(backends, backends[0], 0)).toBe(
      'At least one backend needs a share',
    );
  });
});
