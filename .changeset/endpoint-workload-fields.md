---
'@openchoreo/backstage-plugin-react': minor
'@openchoreo/backstage-plugin': minor
---

The Workload editor can serve an endpoint through an Endpoint: a "Serve
through an Endpoint" switch with the Endpoint type and an optional Endpoint
name. Deploying creates the Endpoint if it is missing. The endpoints tab warns
when the Component reports that an endpoint can't be served through its
Endpoint (name conflict, type mismatch or missing type).
