import { getDiagramDataFromProject } from './projectUtils';
import { CellLinkModel } from '../components/Cell/CellLink/CellLinkModel';
import { ComponentType, Project, RolloutMark } from '../types';

function exposed(
  id: string,
  endpoints?: string[],
  rollouts?: RolloutMark[],
  service = 'http',
) {
  return {
    id,
    type: 'HTTP',
    dependencyIds: [],
    deploymentMetadata: {
      gateways: {
        internet: { isExposed: true, endpoints, rollouts },
        intranet: { isExposed: false },
      },
    },
    key: service,
  };
}

function component(id: string, ...services: ReturnType<typeof exposed>[]) {
  return {
    id,
    version: '1.0.0',
    type: ComponentType.SERVICE,
    connections: [],
    services: Object.fromEntries(services.map(({ key, ...s }) => [key, s])),
  };
}

/** The diagram's gateway links, found by the component they reach. */
function linksOf(project: Project) {
  const links = [
    ...getDiagramDataFromProject(project).links.cellLinks.values(),
  ] as CellLinkModel[];
  return (id: string) =>
    links.find(l => l.targetNode.nodeId === `componentNode|${id}`)!;
}

describe('generateCellLinks', () => {
  it("lists a link's Endpoints in its tooltip and leaves it unmarked", () => {
    const project: Project = {
      id: 'rides',
      name: 'rides',
      components: [
        component('trips', exposed('trips', ['trips-api', 'orders-api'])),
        component('orders', exposed('orders')),
      ],
    };

    const linkTo = linksOf(project);
    const trips = linkTo('trips');
    expect(trips.tooltip).toBe('trips-api\norders-api');
    expect(trips.rollouts).toEqual([]);
    expect(linkTo('orders').tooltip).toBeFalsy();
  });

  it("marks a rollout's current and new versions and pairs their links", () => {
    const current: RolloutMark = {
      endpoint: 'rides',
      strategy: 'canary',
      role: 'current',
    };
    const next: RolloutMark = { ...current, role: 'new' };
    const project: Project = {
      id: 'rides',
      name: 'rides',
      components: [
        component(
          'trips-python',
          exposed('trips-python', ['rides · current'], [current]),
        ),
        component(
          'trips-go',
          exposed('trips-go', ['rides · new · canary'], [next]),
          exposed(
            'trips-go',
            ['shadow · new · mirror'],
            [{ endpoint: 'shadow', strategy: 'mirror', role: 'new' }],
            'grpc',
          ),
        ),
        component('orders', exposed('orders', ['orders-api'])),
      ],
    };

    const linkTo = linksOf(project);
    const python = linkTo('trips-python');
    const go = linkTo('trips-go');
    expect(python.rollouts).toEqual([current]);
    expect(go.rollouts.map(r => r.endpoint)).toEqual(['rides', 'shadow']);
    expect(python.rolloutPeers.map(l => l.getID())).toEqual([go.getID()]);
    expect(go.rolloutPeers.map(l => l.getID())).toEqual([python.getID()]);
    expect(linkTo('orders').rolloutPeers).toEqual([]);
  });
});
