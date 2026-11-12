/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" — сборка с прототипом кабинетов ролей (`src/prototype`); иначе прототипа в сборке нет. */
  readonly VITE_PROTOTYPE_CABINETS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
