import { render, screen } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { MemoryRouter } from 'react-router-dom';
import { openChoreoClientApiRef } from '../../api/OpenChoreoClientApi';
import { ComponentEndpoints } from './ComponentEndpoints';

jest.mock('@backstage/core-components', () => ({
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
  EmptyState: ({ title, description }: any) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
  Table: ({ title, data, columns }: any) => (
    <table aria-label={title}>
      <tbody>
        {data.map((row: any, i: number) => (
          <tr key={i}>
            {columns.map((c: any, j: number) => (
              <td key={j}>
                {c.render ? c.render(row) : String(row[c.field] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));
jest.mock('../../utils/errorUtils', () => ({
  ...jest.requireActual('../../utils/errorUtils'),
  isForbiddenError: (e: any) => e?.status === 403,
}));
jest.mock('@openchoreo/backstage-plugin-react', () => ({
  ForbiddenState: ({ message }: any) => <div>{message}</div>,
}));

const entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'payments-v2',
    namespace: 'default',
    annotations: {
      'openchoreo.io/component': 'payments-v2',
      'openchoreo.io/project': 'shop',
      'openchoreo.io/namespace': 'default',
    },
  },
};

function renderTab(fetchComponentTraffic: jest.Mock) {
  return render(
    <MemoryRouter>
      <TestApiProvider
        apis={[[openChoreoClientApiRef, { fetchComponentTraffic } as any]]}
      >
        <EntityProvider entity={entity as any}>
          <ComponentEndpoints />
        </EntityProvider>
      </TestApiProvider>
    </MemoryRouter>,
  );
}

describe('ComponentEndpoints', () => {
  it('lists each Endpoint and environment that routes here, linking to the Endpoint', async () => {
    renderTab(
      jest.fn().mockResolvedValue([
        {
          endpointName: 'payments-api',
          environment: 'development',
          status: 'Routing',
          weight: 10,
          totalWeight: 100,
          sharePercent: 10,
          invokeURL: 'http://dev.example.com/pay',
        },
        {
          endpointName: 'payments-api',
          environment: 'staging',
          status: 'NotRouted',
          weight: 0,
          totalWeight: 0,
          sharePercent: 0,
        },
      ]),
    );

    const links = await screen.findAllByText('payments-api');
    expect(links).toHaveLength(2);
    expect(links[0].closest('a')).toHaveAttribute(
      'href',
      '/catalog/default/endpoint/payments-api',
    );
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('http://dev.example.com/pay')).toBeInTheDocument();
  });

  it('explains the empty state', async () => {
    renderTab(jest.fn().mockResolvedValue([]));
    expect(
      await screen.findByText('No endpoints route to this component'),
    ).toBeInTheDocument();
  });

  it('shows a forbidden state on 403', async () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    renderTab(jest.fn().mockRejectedValue(err));
    expect(
      await screen.findByText(/do not have permission to view endpoints/),
    ).toBeInTheDocument();
  });
});
