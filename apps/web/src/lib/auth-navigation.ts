import { destinationFor, type Role } from "@imbc/contracts";

/**
 * Страница после входа и шлюз роли в оболочке: сохранённый локальный адрес, если роль вправе его
 * открыть, иначе стартовая страница роли. Правило одно с сервером — `destinationFor` (OPR-31, GEN-08).
 */
export function authDestination(me: { user: { role: Role } }, returnTo: unknown = "/"): string {
  return destinationFor(me.user.role, returnTo);
}
