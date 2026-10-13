import { Entity } from '@backstage/catalog-model';
import { JsonValue } from '@backstage/types';

/**
 * One component workload endpoint that receives traffic through an Endpoint.
 *
 * @public
 */
export interface EndpointBackend {
  /** Component in the Endpoint's project that serves this backend. */
  component: string;
  /** Name of the endpoint in the component's Workload. */
  endpoint: string;
  /** Share of traffic relative to the sum of all weights. */
  weight: number;
  [key: string]: JsonValue | undefined;
}

/**
 * Backstage catalog Endpoint kind Entity.
 *
 * Represents an OpenChoreo Endpoint: developer-facing traffic routing for a
 * project, selecting component workload endpoints and their weights. Unlike
 * Resource, Endpoint is not a built-in Backstage kind, so it carries its own
 * entity type and a processor that validates it.
 *
 * @public
 */
export interface EndpointEntityV1alpha1 extends Entity {
  apiVersion: 'backstage.io/v1alpha1';
  kind: 'Endpoint';
  spec: {
    /** Name of the (Cluster)EndpointType, e.g. http-weighted. */
    type: string;
    /** Owner entity ref. */
    owner: string;
    /** The Project (System) this Endpoint belongs to. */
    system: string;
    /** Component endpoints receiving traffic, in spec order. */
    backends: EndpointBackend[];
    [key: string]: JsonValue | undefined;
  };
}
