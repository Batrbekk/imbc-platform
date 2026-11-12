# IMBC identity screens

React + shadcn/ui screens for IMBC sign-in, password recovery and required account actions. Password forms submit directly to the signed action URLs supplied by the identity service. The BFF continues to use Authorization Code + PKCE; this package does not introduce a password API or store credentials.

The isolated npm package is outside the pnpm workspace. Its own `package-lock.json` makes the theme build independent of changes in the web app (`apps/web`, React + Vite) and the API.

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

The official shadcn MCP `login-01` example informed the card/form structure. Button, Input, Label, Card, Alert, Checkbox, Separator, DropdownMenu and Select were installed from the official `new-york` registry with the shadcn CLI.

Kazakh server messages come from the native Keycloak 26.4.0 community bundle (Apache-2.0): https://github.com/keycloak/keycloak/blob/26.4.0/themes/src/main/resources-community/theme/base/login/messages/messages_kk.properties. Keycloakify supplies compatible message keys under MIT. The IMBC interface has dedicated Kazakh, Russian and English copy.

## Same look as the web app

- **Frame.** Every screen goes through `Frame` in `src/login/KcPage.tsx`, which repeats the web app's `AuthLayout` (`apps/web/src/routes/auth/layout.tsx`): header with the logo on its plate, the platform name and the language switcher; on wide screens the logo, the registry title, the description and the security note on the left and the card on the right; footer. The frame texts are the web app's `common.appName` and `authLayout.*` (`apps/web/messages/{kk,ru,en}.json`) copied into `src/login/translations.ts`; change them in both places.
- **Design tokens.** `src/styles.css` has the same colour variables, radius scale and Inter font as `apps/web/src/index.css`. Change them in both places.
- **Logo.** `src/assets/imbc-logo.png` is a copy of the customer's file `apps/web/src/assets/imbc-logo.png` (NFR-15: used as supplied, not redrawn or cropped). The Docker build context is this directory, so the theme cannot import the web app's file. The two files must stay identical: `shasum -a 256 apps/web/src/assets/imbc-logo.png infrastructure/keycloak/identity/src/assets/imbc-logo.png`. The logo is silver, so it always sits on the dark plate (`bg-sidebar`).
- **Tab icon.** The theme's pages are served from the web app's origin, so they use the web app's icon `/favicon.png` (`apps/web/public/favicon.png`). The link is added at runtime in `src/main.tsx`: the Keycloakify build rewrites root-absolute links of `index.html` to the theme's resource path, where the file does not exist. The icon is temporary until IMBC supplies a square mark: the whole logo, scaled to 240 px wide and centred on a 256×256 square in the plate colour (`--sidebar`, `#051531`). Regenerate it from the repository root with ImageMagick 7:

  ```sh
  magick apps/web/src/assets/imbc-logo.png -resize 240x -background '#051531' -gravity center -extent 256x256 -alpha remove -alpha off -strip apps/web/public/favicon.png
  ```

## Follow-up

- The web app uses shadcn/ui on Base UI with the `base-nova` preset; this package still uses `new-york` on Radix. Move it to `base-nova` (re-add the components with the shadcn CLI, then check every form name, id, action URL, hidden input and `autocomplete` value against the current screens) in a separate change.
