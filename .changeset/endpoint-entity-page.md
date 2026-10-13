---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-react': minor
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-design-system': minor
'@openchoreo/backstage-portal-app': minor
---

Give Endpoints their own page and move them out of the Project tab, mirroring
how Resources are laid out.

An Endpoint page has an Overview (traffic, deployments, backends, About and the
relations graph), and a Deploy tab that is the Resource Deploy tab with a
Traffic tile in place of the "Set up" tile. Endpoints are listed in the
project's contents next to Components and Resources, and a Component gets an
Endpoints tab listing every Endpoint that routes to it. The Project
"Endpoints" tab is removed.

Each environment tile has "View K8s artifacts", which opens the same resource
tree and events view Components use, showing the EndpointReleaseBinding, its
RenderedRelease and the route. The tree view takes its source from a small
context, so Components are unchanged.

The Roll out button now names the split it applies, the Releases dialog marks
the latest and pinned releases, and saving a split that already exists says
that its release is reused instead of reporting a new one.

Adds the Endpoint kind to the catalog filters, icons, graph labels and colours.
