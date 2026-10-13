import { createContext, useContext } from 'react';

/**
 * Where a resource tree comes from. The tree view is shared by every kind
 * whose binding owns a RenderedRelease: it defaults to a Component's
 * ReleaseBinding, and an Endpoint page provides its own source so the same
 * view reads the EndpointReleaseBinding's events and labels its root node.
 */
export interface ResourceTreeSource {
  /** Kind label of the root node, e.g. `EndpointReleaseBinding`. */
  rootKind: string;
  /**
   * Fetches the events of one resource in the tree. Must be referentially
   * stable (memoise it), as the events table refetches when it changes.
   */
  fetchEvents: (resource: {
    group: string;
    version: string;
    kind: string;
    name: string;
  }) => Promise<unknown>;
}

export const ResourceTreeSourceContext =
  createContext<ResourceTreeSource | null>(null);

/** The provided source, or null for the default ReleaseBinding behaviour. */
export const useResourceTreeSource = () =>
  useContext(ResourceTreeSourceContext);
