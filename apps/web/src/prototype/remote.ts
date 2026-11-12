import { useSyncExternalStore } from "react";

/**
 * Синхронизация хранилища прототипа с сервером стенда: один документ на всех пользователей и браузеры
 * (`GET`/`PUT /api/v1/prototype/state`, оптимистичная блокировка по версии). Сервер документ не
 * разбирает — правила ролей и журнал прототипа остаются в web; любой вошедший пользователь стенда
 * читает и перезаписывает документ целиком, данные в нём вымышленные.
 *
 * Режим решается при открытии кабинета: `GET` ответил 200 — общий режим, 404 — локальный (только
 * `localStorage`, как без сервера). Правка применяется к состоянию в памяти сразу и копится в очереди
 * неподтверждённых; очередь уходит одним `PUT` с версией сервера. 409 — состояние сервера, очередь
 * применяется к нему заново (до трёх повторов); правка, которая к нему не применяется, отбрасывается.
 * Чужие правки приходят опросом раз в `POLL_MS` и при возврате на вкладку — только когда своих
 * неподтверждённых правок нет и запись не в пути.
 */
export const PROTOTYPE_STATE_URL = "/api/v1/prototype/state";
export const POLL_MS = 5000;
export const MAX_CONFLICT_RETRIES = 3;

export type SyncMode = "unknown" | "local" | "shared";

export interface SyncStatus {
  mode: SyncMode;
  /** Последний запрос к серверу не прошёл: правки целы в браузере, повтор по опросу. */
  offline: boolean;
  /** На сервере документ более новой схемы: эта вкладка устарела и ничего не пишет. */
  outdated: boolean;
  /** Правка не применена: запись, которую она меняла, исчезла (`dropped`) или повторы кончились. */
  notice: "dropped" | "conflict" | null;
}

/** Неподтверждённая правка: из состояния-основы — новое. `seed` — исходные данные на пустой сервер. */
export interface Change<S> {
  apply: (base: S) => S;
  seed?: boolean;
}

/** Что синхронизации нужно от хранилища (`store.ts`). */
export interface SyncHost<S> {
  current(): S;
  /** Состояние в память и `localStorage`, перерисовка; без записи на сервер. */
  replace(next: S): void;
  initial(): S;
  /** Документ сервера: этой схемы, более новой (сборка устарела) или непригоден (пусто, старая схема). */
  classify(doc: unknown): "usable" | "newer" | "unusable";
}

const IDLE: SyncStatus = { mode: "unknown", offline: false, outdated: false, notice: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const body: unknown = await res.json().catch(() => null);
  return isRecord(body) ? body : null;
}

const request = (init: RequestInit = {}) =>
  fetch(PROTOTYPE_STATE_URL, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
  });

export class StateSync<S> {
  private status: SyncStatus = IDLE;
  private readonly listeners = new Set<() => void>();
  private pending: Change<S>[] = [];
  private version = 0;
  private started = false;
  private writing = false;
  private polling = false;
  private conflicts = 0;
  /** Растёт с каждой записью: ответ опроса, начатого до неё, устарел. */
  private epoch = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Растёт при `reset`: ответы и таймеры прежней синхронизации ничего не меняют. */
  private generation = 0;

  constructor(private readonly host: SyncHost<S>) {}

  getStatus = (): SyncStatus => this.status;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<SyncStatus>) {
    const next = { ...this.status, ...patch };
    if ((Object.keys(patch) as (keyof SyncStatus)[]).every((key) => next[key] === this.status[key])) return;
    this.status = next;
    for (const listener of this.listeners) listener();
  }

  dismissNotice = () => this.set({ notice: null });

  /** Правка уже применена к состоянию в памяти; в общем режиме (и до решения о режиме) — в очередь. */
  record(change: Change<S>): void {
    if (this.status.mode === "local") return;
    this.pending.push(change);
    void this.flush();
  }

  /** Открыт кабинет: один раз на загрузку страницы спросить сервер о режиме. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.probe();
  }

  private async probe(): Promise<void> {
    const generation = this.generation;
    let body: Record<string, unknown> | null = null;
    try {
      const res = await request();
      if (generation !== this.generation) return;
      if (res.status === 404) {
        // Сервер без общего состояния: локальный режим до перезагрузки, больше запросов нет.
        this.pending = [];
        this.set({ mode: "local", offline: false });
        return;
      }
      if (res.ok) body = await readJson(res);
    } catch {
      // Нет связи — повтор ниже.
    }
    if (generation !== this.generation) return;
    if (!body || !isVersion(body.version)) {
      // Режим неизвестен: правки живут в браузере и уйдут на сервер, когда он ответит.
      if (this.pending.length > 0) this.set({ offline: true });
      setTimeout(() => {
        if (generation === this.generation) void this.probe();
      }, POLL_MS);
      return;
    }
    this.set({ mode: "shared", offline: false });
    this.rebase(body.version, body.state);
    this.timer = setInterval(this.tick, POLL_MS);
    document.addEventListener("visibilitychange", this.onVisible);
    void this.flush();
  }

  private onVisible = () => {
    if (document.visibilityState === "visible") this.tick();
  };

  /** Раз в `POLL_MS`: есть неподтверждённые правки — повтор записи, иначе — опрос. */
  private tick = () => {
    if (this.pending.length > 0) void this.flush();
    else void this.poll();
  };

  /**
   * Новая основа — документ сервера; неподтверждённые правки применяются к нему заново. Правка,
   * которая бросила (запись исчезла), отбрасывается с сообщением. Непригодный документ (пусто, старая
   * схема, повреждён) заменяется исходными данными этой сборки; более новый — не трогается.
   */
  private rebase(version: number, doc: unknown): void {
    this.version = version;
    const kind = this.host.classify(doc);
    this.set({ outdated: kind === "newer" });
    if (kind === "newer") return;
    let base: S;
    if (kind === "usable") {
      base = doc as S;
      this.pending = this.pending.filter((change) => !change.seed);
    } else {
      base = this.host.initial();
      if (!this.pending.some((change) => change.seed)) {
        this.pending.unshift({ apply: () => this.host.initial(), seed: true });
      }
    }
    let next = base;
    this.pending = this.pending.filter((change) => {
      try {
        next = change.apply(next);
        return true;
      } catch {
        this.set({ notice: "dropped" });
        return false;
      }
    });
    this.host.replace(next);
  }

  private async flush(): Promise<void> {
    if (this.status.mode !== "shared" || this.status.outdated || this.writing || this.pending.length === 0) return;
    const generation = this.generation;
    this.writing = true;
    this.epoch += 1;
    const sent = this.pending.length;
    const state = this.host.current();
    let res: Response;
    let body: Record<string, unknown> | null;
    try {
      res = await request({ method: "PUT", body: JSON.stringify({ baseVersion: this.version, state }) });
      body = await readJson(res);
    } catch {
      if (generation !== this.generation) return;
      this.writing = false;
      this.set({ offline: true });
      return;
    }
    if (generation !== this.generation) return;
    this.writing = false;
    if (res.ok && body && isVersion(body.version)) {
      this.version = body.version;
      this.pending.splice(0, sent);
      this.conflicts = 0;
      this.set({ offline: false });
      void this.flush();
      return;
    }
    if (res.status === 409 && body && isVersion(body.version)) {
      this.set({ offline: false });
      if (this.conflicts >= MAX_CONFLICT_RETRIES) {
        // Сервер меняется быстрее, чем доходит запись: правки этой вкладки не применены.
        this.conflicts = 0;
        this.pending = [];
        this.set({ notice: "conflict" });
      } else {
        this.conflicts += 1;
      }
      this.rebase(body.version, body.state);
      void this.flush();
      return;
    }
    this.set({ offline: true });
  }

  private async poll(): Promise<void> {
    if (this.status.mode !== "shared" || this.writing || this.polling || this.pending.length > 0) return;
    this.polling = true;
    const generation = this.generation;
    const epoch = this.epoch;
    let body: Record<string, unknown> | null = null;
    try {
      const res = await request();
      if (res.ok) body = await readJson(res);
    } catch {
      // Нет связи — ниже.
    }
    if (generation !== this.generation) return;
    this.polling = false;
    if (!body || !isVersion(body.version)) {
      this.set({ offline: true });
      return;
    }
    // За время опроса вкладка начала запись или правку: ответ устарел, основу даст запись.
    if (epoch !== this.epoch || this.writing || this.pending.length > 0) return;
    this.set({ offline: false });
    if (body.version === this.version && !this.status.outdated) return;
    this.rebase(body.version, body.state);
    void this.flush();
  }

  /** Для тестов: синхронизация как при загрузке страницы, без таймеров и очереди. */
  reset(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    document.removeEventListener("visibilitychange", this.onVisible);
    this.pending = [];
    this.version = 0;
    this.started = false;
    this.writing = false;
    this.polling = false;
    this.conflicts = 0;
    this.generation += 1;
    this.status = IDLE;
    for (const listener of this.listeners) listener();
  }
}

let instance: StateSync<unknown> | undefined;

/** Единственная синхронизация страницы; создаёт её `store.ts`. */
export function createSync<S>(host: SyncHost<S>): StateSync<S> {
  const sync = new StateSync(host);
  instance = sync as StateSync<unknown>;
  return sync;
}

export function getSyncStatus(): SyncStatus {
  return instance?.getStatus() ?? IDLE;
}

const noop = () => () => {};

/** Режим и состояние связи для экранов: `useSyncStatus().mode === "shared"`. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(instance?.subscribe ?? noop, getSyncStatus, getSyncStatus);
}

export function dismissSyncNotice(): void {
  instance?.dismissNotice();
}

/** Для тестов: начать с проверки режима, как после загрузки страницы. */
export function resetSyncForTests(): void {
  instance?.reset();
}
