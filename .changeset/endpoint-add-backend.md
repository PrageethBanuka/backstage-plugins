---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin-common': minor
---

Start a canary by adding a backend. Change traffic on an Endpoint can add a
project component as a backend at 0% and remove a backend once its saved
weight is 0, so a new version joins the same Endpoint and URL.
`PUT /update-endpoint-traffic` accepts `replaceBackends: true` to save the
full set of backends; removing one that still has traffic is refused.
