# Third-party notices

## Repository-owned work

Original code and documentation contributed by Chen An are licensed under the root [MIT License](LICENSE), Copyright (c) 2026 Chen An. This does not replace the copyright or license of upstream-derived code or dependencies.

## Mobile sidebar layout fork

`mobile-sidebar-layout` is derived from the published `@deepseek-ai/dsh-client-ui-layout` **0.1.5-rc.1** client bundle (577-line baseline), part of DeepSeek Harness. Its package/module identity is retained for compatibility, not to claim official publication or endorsement.

- Upstream package: [@deepseek-ai/dsh-client-ui-layout](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-layout/v/0.1.5-rc.1).
- Upstream copyright: **Copyright (c) 2026 DeepSeek**.
- Upstream license: **MIT**, retained without modification in [mobile-sidebar-layout/LICENSE](mobile-sidebar-layout/LICENSE).

Redistributions containing this module must retain that upstream copyright and permission notice. Repository-specific modifications are also made available under MIT; the root license does not supersede the module's upstream notice.

## Installed dependencies and host integrations

The other plugins integrate with DeepSeek Harness and its native APIs. Package manifests and lockfiles identify their build/test and runtime dependencies. Those dependencies retain their own licenses and copyright notices; the repository's MIT license does not relicense them. In particular, React/ReactDOM and DSH client services are supplied by the host where documented, and provider integrations reuse installed upstream implementations rather than claiming authorship of them.

Dependency trees, generated bundles, and local deployment artifacts are not part of the intended source snapshot. If distributing built bundles or installed dependencies separately, review the actual included dependency licenses and carry forward the notices required by those packages. This file is not a complete license inventory for every possible installation or build output.

The repository does not include user portrait images; manually uploaded images remain browser-local and are not covered by the repository's code license.
