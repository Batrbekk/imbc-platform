# IMBC development

- Build product interfaces with shadcn/ui components. Use the official shadcn MCP registry tools to inspect components and examples before adding new UI. Preserve existing components rather than overwriting them blindly.
- All visible authentication screens belong to IMBC and use the same shadcn/ui design. Do not expose the stock identity-provider interface. Keep password verification and the OIDC Authorization Code + PKCE flow in the identity service and BFF.
- Read `apps/web/AGENTS.md` and the installed Next.js documentation before changing web code.
- Preserve Kazakh, Russian and English translations for every user-facing state.
- Azure deployment uses both `compose.yaml` and `compose.azure.yaml`. Do not use `compose.dev.yaml` on the server.
- Keep all credentials out of Git and tool output. Server `.env*` files are generated and preserved separately.
- Use `.local` recipients for automated email tests. They are captured in Mailpit; real recipients are relayed externally and require explicit user authorization. The temporary Azure-managed sender has a small shared sending quota.
- Continue implementation by the acceptance steps in `docs/development-roadmap.md`.
