import type { StatusType } from '@openchoreo/backstage-design-system';
import type { EndpointRoutingStatus } from '@openchoreo/backstage-plugin-common';

/**
 * Maps how an Endpoint routes in an environment to a StatusBadge variant.
 * Shared by the canvas tile, the detail panel and the Traffic card so an
 * environment renders the same badge everywhere. Mirrors
 * deriveResourceEnvBadgeStatus.
 */
export function deriveEndpointBadgeStatus(
  status: EndpointRoutingStatus,
): StatusType {
  switch (status) {
    case 'Routing':
      return 'active';
    case 'Applying':
    case 'Releasing':
      return 'pending';
    case 'BackendsUnresolved':
      return 'warning';
    case 'Failed':
      return 'failed';
    default:
      return 'not-deployed';
  }
}

/** Badge labels; the StatusBadge defaults say "Deployed", which is wrong here. */
export const ENDPOINT_BADGE_LABEL: Record<EndpointRoutingStatus, string> = {
  Routing: 'Routing',
  Applying: 'Applying',
  BackendsUnresolved: 'Needs attention',
  Failed: 'Failed',
  Releasing: 'Handing back',
  NotRouted: 'Not routed',
};
