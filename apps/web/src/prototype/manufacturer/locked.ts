import { createContext } from "react";

/** Профиль заблокирован (MAN-43): поля секции только для чтения. */
export const LockedContext = createContext(false);
