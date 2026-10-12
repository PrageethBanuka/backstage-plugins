import { render, screen } from '@testing-library/react';
import { TrafficSplitBar } from './TrafficSplitBar';

const split = [
  { componentName: 'payments-v1', endpoint: 'http', weight: 9 },
  { componentName: 'payments-v2', endpoint: 'http', weight: 1 },
];

describe('TrafficSplitBar', () => {
  it('describes the split for assistive technology', () => {
    render(<TrafficSplitBar backends={split} />);
    expect(
      screen.getByRole('img', {
        name: 'Traffic split: payments-v1 90%, payments-v2 10%',
      }),
    ).toBeInTheDocument();
  });

  it('sizes segments by share and omits 0% backends', () => {
    render(
      <TrafficSplitBar
        backends={[
          ...split,
          { componentName: 'payments-v3', endpoint: 'http', weight: 0 },
        ]}
      />,
    );
    const segments = screen.getAllByTestId('split-segment');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveStyle({ flexBasis: '90%' });
    expect(segments[1]).toHaveStyle({ flexBasis: '10%' });
  });

  it('shows a legend with percentages', () => {
    render(<TrafficSplitBar backends={split} showLegend />);
    expect(screen.getByText('payments-v1 90%')).toBeInTheDocument();
    expect(screen.getByText('payments-v2 10%')).toBeInTheDocument();
  });
});
