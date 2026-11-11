import { can, roleHome, safeReturnTo, type Role } from "@imbc/contracts";

/** Honour a local return path only when the current role can open that page. */
export function authDestination(me: { user: { role: Role }; homePath?: string }, returnTo: unknown = "/"): string {
  const home = safeReturnTo(me.homePath, roleHome(me.user.role));
  const target = safeReturnTo(returnTo, home);
  const pathname = target.split(/[?#]/)[0];
  if (pathname === "/" || pathname === "/login" || pathname === "/register" || pathname?.startsWith("/auth/"))
    return home;
  if (pathname === "/catalog" && !can(me.user.role, "catalog.search")) return home;
  if (pathname === "/dashboard" && !can(me.user.role, "dashboard.read")) return home;
  if (pathname === "/profile" && me.user.role !== "manufacturer") return home;
  return target;
}
