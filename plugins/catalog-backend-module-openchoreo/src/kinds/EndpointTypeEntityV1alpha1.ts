import { Entity } from '@backstage/catalog-model';

/**
 * Backstage catalog EndpointType kind Entity. Represents an OpenChoreo
 * namespaced endpoint type: the template an Endpoint renders its routes from.
 *
 * @public
 */
export interface EndpointTypeEntityV1alpha1 extends Entity {
  /**
   * The apiVersion string of the EndpointType.
   */
  apiVersion: 'backstage.io/v1alpha1';
  /**
   * The kind of the entity
   */
  kind: 'EndpointType';
  /**
   * The specification of the EndpointType Entity
   */
  spec: {
    /**
     * The domain this endpoint type belongs to
     */
    domain?: string;
  };
}
