import { fireEvent, render, screen } from '@testing-library/react';
import {
  EndpointStrategyField,
  endpointStrategyFieldValidation,
  type EndpointStrategyValue,
} from './EndpointStrategyField';

const backend = (component: string) => ({
  name: `${component}-http`,
  component,
  endpoint: 'http',
});

function renderField(
  backends: unknown[],
  formData?: EndpointStrategyValue,
  typeOptions: object = {},
) {
  const onChange = jest.fn();
  render(
    <EndpointStrategyField
      {...({
        formData,
        onChange,
        formContext: { formData: { backends, endpoint_name: 'orders-api' } },
        uiSchema: {
          'ui:options': { backendsField: 'backends', ...typeOptions },
        },
      } as any)}
    />,
  );
  return onChange;
}

const matchOnly = { typeName: 'gamma-httproute', capabilities: ['Match'] };

describe('EndpointStrategyField', () => {
  it('stays hidden until the Endpoint has two backends', () => {
    renderField([backend('orders')]);
    expect(screen.queryByLabelText('How traffic moves')).toBeNull();
  });

  it('splits by weight by default and offers the strategies', () => {
    const onChange = renderField([backend('orders'), backend('orders-v2')]);
    expect(
      screen.getByText('Each backend gets the share its weight gives it.'),
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('How traffic moves'));
    fireEvent.click(screen.getByRole('option', { name: 'Canary' }));
    expect(onChange).toHaveBeenCalledWith({
      strategy: 'canary',
      steps: [5, 25, 50, 100],
      preview: { kind: 'header', name: 'x-canary', value: 'true' },
    });
  });

  it("shows a canary's steps and testers' header, as Add backend does", () => {
    const onChange = renderField([backend('orders'), backend('orders-v2')], {
      strategy: 'canary',
    });
    expect(screen.getByText('Steps')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Header'), {
      target: { value: 'x-test' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        strategy: 'canary',
        preview: { kind: 'header', name: 'x-test', value: 'true' },
      }),
    );
  });

  it('names the A/B cookie after the Endpoint', () => {
    renderField([backend('orders'), backend('orders-v2')], {
      strategy: 'abTest',
    });
    expect(screen.getByLabelText('Cookie')).toHaveValue(
      'exp_orders_api',
    );
  });

  it('keeps the options chosen before when the step is shown again', () => {
    renderField([backend('orders'), backend('orders-v2')], {
      strategy: 'canary',
      steps: [10, 100],
      preview: { kind: 'header', name: 'x-test', value: 'yes' },
    });
    expect(screen.getByLabelText('Header')).toHaveValue('x-test');
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('goes back to weights when a backend is removed', () => {
    const onChange = renderField([backend('orders')], { strategy: 'canary' });
    expect(onChange).toHaveBeenCalledWith({ strategy: 'weight' });
  });

  it('refuses a strategy with its options missing', () => {
    const addError = jest.fn();
    endpointStrategyFieldValidation({ strategy: 'abTest' }, { addError });
    expect(addError).toHaveBeenCalledWith(
      'Fill in how to reach the new backend',
    );
    addError.mockClear();
    endpointStrategyFieldValidation({ strategy: 'weight' }, { addError });
    expect(addError).not.toHaveBeenCalled();
  });
});

describe('EndpointStrategyField on a type with only Match', () => {
  it('offers no mirror, and says why', () => {
    renderField(
      [backend('orders'), backend('orders-v2')],
      undefined,
      matchOnly,
    );
    fireEvent.mouseDown(screen.getByLabelText('How traffic moves'));
    expect(
      screen.getByRole('option', {
        name: "Mirror (gamma-httproute can't mirror requests)",
      }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'Canary' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it("refuses a canary's testers header on a type without Match", () => {
    const validation = { addError: jest.fn() };
    endpointStrategyFieldValidation(
      {
        strategy: 'canary',
        steps: [10, 100],
        preview: { kind: 'header', name: 'x-test', value: 'yes' },
      },
      validation,
      { uiSchema: { 'ui:options': { capabilities: ['Mirror'] } } },
    );
    expect(validation.addError).toHaveBeenCalledWith(
      expect.stringContaining('turn the header off'),
    );
  });

  it('refuses mirror in validation too', () => {
    const validation = { addError: jest.fn() };
    endpointStrategyFieldValidation(
      { strategy: 'mirror', steps: [100] },
      validation,
      { uiSchema: { 'ui:options': matchOnly } },
    );
    expect(validation.addError).toHaveBeenCalledWith(
      "gamma-httproute can't mirror requests",
    );
  });
});
