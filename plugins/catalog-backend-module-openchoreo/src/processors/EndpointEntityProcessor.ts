import {
  CatalogProcessor,
  CatalogProcessorEmit,
  processingResult,
} from '@backstage/plugin-catalog-node';
import {
  Entity,
  RELATION_DEPENDENCY_OF,
  RELATION_DEPENDS_ON,
  RELATION_HAS_PART,
  RELATION_PART_OF,
} from '@backstage/catalog-model';
import {
  CHOREO_ANNOTATIONS,
  RELATION_HAS_INSTANCE,
  RELATION_INSTANCE_OF,
} from '@openchoreo/backstage-plugin-common';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import type { EndpointEntityV1alpha1 } from '../kinds/EndpointEntityV1alpha1';

function isEndpointEntity(entity: Entity): entity is EndpointEntityV1alpha1 {
  return entity.kind === 'Endpoint';
}

/**
 * Processor for Endpoint entities.
 *
 * Endpoint is not a built-in Backstage kind, so this processor validates it
 * (otherwise the catalog rejects the entity) and, because the built-in
 * processors only derive relations for their own kinds, it also emits the
 * relations the entity page and graph need:
 *
 *  - Endpoint partOf Project (System), with the inverse hasPart
 *  - Endpoint dependsOn each backend Component, with the inverse dependencyOf
 */
export class EndpointEntityProcessor implements CatalogProcessor {
  getProcessorName(): string {
    return 'EndpointEntityProcessor';
  }

  async validateEntityKind(entity: Entity): Promise<boolean> {
    return entity.kind === 'Endpoint';
  }

  async postProcessEntity(
    entity: Entity,
    _location: LocationSpec,
    emit: CatalogProcessorEmit,
  ): Promise<Entity> {
    if (!isEndpointEntity(entity)) {
      return entity;
    }

    const namespace = entity.metadata.namespace || 'default';
    const sourceRef = {
      kind: 'endpoint',
      namespace,
      name: entity.metadata.name,
    };

    if (entity.spec.system) {
      const systemRef = {
        kind: 'system',
        namespace,
        name: entity.spec.system,
      };
      emit(
        processingResult.relation({
          source: sourceRef,
          target: systemRef,
          type: RELATION_PART_OF,
        }),
      );
      emit(
        processingResult.relation({
          source: systemRef,
          target: sourceRef,
          type: RELATION_HAS_PART,
        }),
      );
    }

    // instanceOf / hasInstance: the (Cluster)EndpointType the Endpoint
    // renders its routes from, as a Resource relates to its ResourceType.
    const typeName =
      entity.metadata.annotations?.[CHOREO_ANNOTATIONS.ENDPOINT_CR_TYPE];
    if (typeName) {
      const isCluster =
        entity.metadata.annotations?.[
          CHOREO_ANNOTATIONS.ENDPOINT_CR_TYPE_KIND
        ] === 'ClusterEndpointType';
      const typeRef = {
        kind: isCluster ? 'clusterendpointtype' : 'endpointtype',
        namespace: isCluster ? 'openchoreo-cluster' : namespace,
        name: typeName,
      };
      emit(
        processingResult.relation({
          source: sourceRef,
          target: typeRef,
          type: RELATION_INSTANCE_OF,
        }),
      );
      emit(
        processingResult.relation({
          source: typeRef,
          target: sourceRef,
          type: RELATION_HAS_INSTANCE,
        }),
      );
    }

    const seen = new Set<string>();
    for (const backend of entity.spec.backends ?? []) {
      if (!backend.component || seen.has(backend.component)) {
        continue;
      }
      seen.add(backend.component);
      const componentRef = {
        kind: 'component',
        namespace,
        name: backend.component,
      };
      emit(
        processingResult.relation({
          source: sourceRef,
          target: componentRef,
          type: RELATION_DEPENDS_ON,
        }),
      );
      emit(
        processingResult.relation({
          source: componentRef,
          target: sourceRef,
          type: RELATION_DEPENDENCY_OF,
        }),
      );
    }

    return entity;
  }
}
