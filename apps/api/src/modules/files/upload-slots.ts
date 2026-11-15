/** Общий токен ограничителя: все маршруты загрузки используют один экземпляр на процесс (DATA-06, NFR-09). */
export const UPLOAD_SLOTS = Symbol('UPLOAD_SLOTS');

export interface UploadSlot {
  /** Освобождает место на процесс и аккаунт; повторный вызов безопасен. */
  release(): void;
}

/**
 * Занимает место до чтения тела файла: очередь не создаётся, лишняя загрузка сразу получает отказ.
 * Счётчики меняются синхронно; один экземпляр ограничивает память всех HTTP-загрузок процесса.
 */
export class UploadSlots {
  private readonly processLimit: number;
  private readonly accountLimit: number;
  private readonly accounts = new Map<string, number>();
  private used = 0;

  constructor(limits: { process: number; account: number }) {
    this.processLimit = limits.process;
    this.accountLimit = limits.account;
  }

  get inUse(): number {
    return this.used;
  }

  tryAcquire(accountId: string): UploadSlot | 'busy' | 'account_limit' {
    const accountUsed = this.accounts.get(accountId) ?? 0;
    // Сначала личный предел: клиент ждёт окончания своих загрузок, даже если общий предел тоже достигнут.
    if (accountUsed >= this.accountLimit) return 'account_limit';
    if (this.used >= this.processLimit) return 'busy';
    this.accounts.set(accountId, accountUsed + 1);
    this.used++;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.used--;
        const remaining = (this.accounts.get(accountId) ?? 1) - 1;
        if (remaining === 0) this.accounts.delete(accountId);
        else this.accounts.set(accountId, remaining);
      },
    };
  }
}
