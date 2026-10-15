# Test fixtures

- `glance-example.yml` is Glance's official example config, copied unchanged from
  [glanceapp/glance `docs/glance.yml`](https://github.com/glanceapp/glance/blob/main/docs/glance.yml)
  (Glance is licensed under AGPL-3.0). It is only used as test data, to check that Glancer leaves a real
  config byte-for-byte identical except for what was edited.
- `homelab.yml` was written for these tests: comments everywhere, `${ENV}` placeholders, an escaped `\${...}`,
  `$include` / `!include` lines, YAML anchors and merge keys, quoted values and flow-style lists.
