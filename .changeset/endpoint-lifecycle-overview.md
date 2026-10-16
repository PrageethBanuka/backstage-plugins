---
'@openchoreo/backstage-plugin': minor
'@openchoreo/backstage-plugin-backend': minor
'@openchoreo/backstage-plugin-common': minor
---

The Endpoint's Traffic card shows its lifecycle: where it was created from,
what happens when no backend is left (editable reclaim policy, via the new
`PUT /update-endpoint-reclaim-policy`), and notices while it is Orphaned or
degraded. Endpoint summaries carry `problem`.
