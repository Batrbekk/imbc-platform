import { destinationFor, type Role } from '@imbc/contracts';

/**
 * Страница после входа: сохранённая, если роль вправе её открыть, иначе стартовая страница
 * роли (OPR-31). Правило одно с интерфейсом — `destinationFor` из @imbc/contracts (GEN-08).
 */
export function postLoginPath(role: Role, saved: unknown): string {
  return destinationFor(role, saved);
}
