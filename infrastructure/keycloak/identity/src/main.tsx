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
  createRoot(document.getElementById("root")!).render(<StrictMode>{kcContext ? <KcPage kcContext={kcContext} /> : <main className="grid min-h-svh place-items-center bg-background p-6 text-foreground"><a className="text-primary underline" href="/api/auth/login">IMBC — Кіру / Войти / Sign in</a></main>}</StrictMode>);
}
void start();
