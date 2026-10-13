---
'@openchoreo/backstage-plugin-catalog-backend-module': minor
'@openchoreo/backstage-plugin-common': minor
'@openchoreo/backstage-plugin-permission-backend-module-openchoreo-policy': minor
'@openchoreo/openchoreo-client-node': minor
---

Add Endpoint as a catalog entity kind, at the same level as Resource, so an
Endpoint is listed in its project and has its own page.

Resource is a built-in Backstage kind and validates for free. Endpoint is not,
so it follows the DeploymentPipeline pattern: its own entity type, and a
processor that validates the kind and emits `partOf` the Project and
`dependsOn` each backend Component. The provider lists Endpoints per namespace
and refreshes them from `openchoreo.endpoint` events.

Endpoint entities carry `openchoreo.io/endpoint-cr*` annotations, separate from
the existing `openchoreo.io/endpoint-*` keys that describe a Workload endpoint
of a Component. `endpoint` is a managed kind in the permission policy and is
scoped like a Resource: at the project, so a project-level deny hides it and a
Component-level deny does not.

Syncs the client with the K8s resource tree and events paths for
EndpointReleaseBindings.
