import { getDiagramDataFromProject } from './projectUtils';
import { CellLinkModel } from '../components/Cell/CellLink/CellLinkModel';
import { ComponentType, Project } from '../types';

function exposed(id: string, label?: string) {
  return {
    id,
    version: '1.0.0',
    type: ComponentType.SERVICE,
    connections: [],
    services: {
      http: {
        id,
        type: 'HTTP',
        dependencyIds: [],
        deploymentMetadata: {
          gateways: {
            internet: { isExposed: true, label },
            intranet: { isExposed: false },
          },
        },
      },
    },
  };
}

describe('generateCellLinks', () => {
  it('carries a gateway label onto the link', () => {
    const project: Project = {
      id: 'rides',
      name: 'rides',
      components: [exposed('trips', 'trips-api'), exposed('orders')],
    };

    const links = [
      ...getDiagramDataFromProject(project).links.cellLinks.values(),
    ] as CellLinkModel[];

    expect(links.map(l => l.label).sort()).toEqual(['trips-api', undefined]);
  });
});
