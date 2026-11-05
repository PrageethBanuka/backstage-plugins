import { givesReleaseShares, heededOverrides } from './endpointRolloutRefs';

const ref = (name: string, weight = 1, extra = {}) => ({
  name,
  kind: 'Component' as const,
  component: { name, endpoint: 'http' },
  weight,
  ...extra,
});

describe('heededOverrides', () => {
  it("keeps only the overrides naming one of the release's backends", () => {
    expect(
      heededOverrides(
        [
          { name: 'trips-python', weight: 3 },
          { name: 'trips-gone', weight: 1 },
        ],
        [ref('trips-python')],
      ),
    ).toEqual([{ name: 'trips-python', weight: 3 }]);
  });
});

describe('givesReleaseShares', () => {
  const refs = [
    ref('trips-python', 40),
    ref('trips-stale', 40),
    ref('trips-v2', 20),
  ];

  it('is true for weights scaled by one factor, or none at all', () => {
    expect(
      givesReleaseShares(refs, [
        { name: 'trips-python', weight: 4000 },
        { name: 'trips-stale', weight: 4000 },
        { name: 'trips-v2', weight: 2000 },
      ]),
    ).toBe(true);
    expect(givesReleaseShares(refs, [])).toBe(true);
  });

  it('is false for weights that change the shares', () => {
    expect(
      givesReleaseShares(refs, [{ name: 'trips-python', weight: 80 }]),
    ).toBe(false);
  });

  it('leaves a mirror out of the split, and counts a mirror share as a change', () => {
    const mirrored = [
      ref('trips-python', 1),
      ref('trips-copy', 0, { mirror: { percent: 10 } }),
    ];
    expect(
      givesReleaseShares(mirrored, [{ name: 'trips-python', weight: 100 }]),
    ).toBe(true);
    expect(
      givesReleaseShares(mirrored, [
        { name: 'trips-copy', mirror: { percent: 50 } },
      ]),
    ).toBe(false);
  });
});
