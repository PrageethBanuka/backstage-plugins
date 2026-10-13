---
'@openchoreo/backstage-plugin': minor
---

Add traffic management for Endpoints and a Traffic card to Component
overviews. Endpoints route a project's traffic across its components with
weights, for example a 90/10 canary.

- An Endpoint's Deploy tab shows its environments on the same pipeline canvas
  and detail panel as the Resource deploy view.
- Change traffic is a two-step dialog: save the split as a new release, then
  roll it out to the environments you choose. Each environment is checked
  first for permission and for every weighted backend being deployed there.
- Each environment can promote its release to the next one, roll back by
  pinning an older release, or stop routing; the components' own routes take
  traffic back first.
- The Traffic card shows, per Endpoint and environment, this component's
  share of the traffic. It renders nothing when no Endpoint routes to the
  component.
