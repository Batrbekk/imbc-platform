import type { OrganizationType, Role, Scope } from '@imbc/contracts';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  organizationId: string;
  organizationType: OrganizationType;
  locale: string;
}

export interface AuthContext {
  sessionId: string;
  user: AuthUser;
  mfaPassed: boolean;
  responsibilityAccepted: boolean;
  /** Условие доступа из PolicyMatrix для текущего действия (выставляет PolicyGuard). */
  scope?: Scope;
}

declare module 'express' {
  interface Request {
    auth?: AuthContext;
  }
}
