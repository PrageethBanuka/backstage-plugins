import { fireEvent, render, screen } from '@testing-library/react';
import { StepsField, normalizeSteps } from './StepsField';

describe('normalizeSteps', () => {
  it('keeps increasing shares from 1 to 99 and always ends at 100', () => {
    expect(normalizeSteps([50, 5, 5, 0, 120, 25])).toEqual([5, 25, 50, 100]);
    expect(normalizeSteps([])).toEqual([100]);
  });
});

describe('StepsField', () => {
  it('adds a step in order and removes one, never the last', () => {
    const onChange = jest.fn();
    const { container } = render(
      <StepsField value={[5, 50, 100]} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText('New step (%)'), {
      target: { value: '25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    expect(onChange).toHaveBeenLastCalledWith([5, 25, 50, 100]);

    const deletes = container.querySelectorAll('.MuiChip-deleteIcon');
    expect(deletes).toHaveLength(2);
    fireEvent.click(deletes[0]);
    expect(onChange).toHaveBeenLastCalledWith([50, 100]);
  });

  it('says why a step cannot be added', () => {
    render(<StepsField value={[5, 100]} onChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('New step (%)'), {
      target: { value: '5' },
    });
    expect(screen.getByText('5% is already a step.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add step' })).toBeDisabled();
  });
});
