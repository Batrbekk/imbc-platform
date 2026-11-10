# IMBC identity screens

React + shadcn/ui screens for IMBC sign-in, password recovery and required account actions. Password forms submit directly to the signed action URLs supplied by the identity service. The BFF continues to use Authorization Code + PKCE; this package does not introduce a password API or store credentials.

The isolated npm package is outside the pnpm workspace. Its own `package-lock.json` makes the theme build independent of API and Next.js changes.

```sh
npm ci
npm run typecheck
npm run dev
npm run build:theme
```

The theme build requires Java 17+ and Maven. It produces `dist_keycloak/imbc-theme.jar` for Keycloak 26+. The Dockerfile includes the required build tools:

```sh
docker build -t imbc/keycloak:dev infrastructure/keycloak/identity
```

Set both the realm `loginTheme` and any client-level `attributes.login_theme` to `imbc`. The `imbc-bff` client's former `keycloak.v2` override must be updated. Keep `emailTheme` unchanged: this package only supplies login screens.

Supported configured screens: username/password login, separate username/password steps, forgot password, password update, email verification, required-action confirmation, information/errors, expired links, logout confirmation, profile/email update, authenticator selection and OTP. Unconfigured authentication methods show an IMBC recovery screen instead of a vendor UI. Native action URLs, credential identifiers and required form names are preserved.

In development only, `?page=login-reset-password.ftl&locale=kk` (or `ru`, `en`) selects a preview using Keycloakify fixtures. No preview fixtures enter the production bundle. Repeat with the relevant page identifier for other screens.

The official shadcn MCP `login-01` example informed the card/form structure. Button, Input, Label, Card, Alert, Checkbox, Separator, DropdownMenu and Select were installed from the official `new-york` registry with the shadcn CLI. Styling uses the same Inter font and IMBC color variables as the main application.

Kazakh server messages come from the native Keycloak 26.4.0 community bundle (Apache-2.0): https://github.com/keycloak/keycloak/blob/26.4.0/themes/src/main/resources-community/theme/base/login/messages/messages_kk.properties. Keycloakify supplies compatible message keys under MIT. The IMBC interface has dedicated Kazakh, Russian and English copy.
