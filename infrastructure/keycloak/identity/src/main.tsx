import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { KcContext } from "./login/KcContext";
import KcPage from "./login/KcPage";
import "./styles.css";

async function start() {
  let kcContext = (window as unknown as { kcContext?: KcContext }).kcContext;
  if (!kcContext && import.meta.env.DEV) {
    const { createPreviewContext } = await import("./preview");
    kcContext = createPreviewContext();
  }
  if (
    !import.meta.env.DEV &&
    kcContext?.pageId === "login.ftl" &&
    kcContext.client.clientId === "imbc-bff" &&
    /^\/kc\/realms\/[^/]+\/(?:protocol\/openid-connect\/auth|login-actions\/authenticate)\/?$/.test(window.location.pathname)
  ) {
    // Only the displayed address changes. Native form actions and the BFF PKCE cookie stay intact.
    // Reloading or sharing /login starts a fresh sign-in; email action links keep their original URL.
    try {
      window.history.replaceState(window.history.state, "", new URL("/login", window.location.origin));
    } catch {
      // Address cleanup must never prevent the native sign-in form from rendering.
    }
  }
  createRoot(document.getElementById("root")!).render(<StrictMode>{kcContext ? <KcPage kcContext={kcContext} /> : <main className="grid min-h-svh place-items-center bg-background p-6 text-foreground"><a className="text-primary underline" href="/api/auth/login">IMBC — Кіру / Войти / Sign in</a></main>}</StrictMode>);
}
void start();
