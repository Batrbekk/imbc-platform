import { readFileSync } from 'node:fs';

/** Файл репозитория по пути от его корня, текстом UTF-8. */
export const repository = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');

/** Блок сервиса `name` из `services:` (отступ два пробела) до следующего ключа того же или верхнего уровня. */
export const serviceBlock = (file: string, name: string) => {
  const lines = file.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^ {0,2}[^\s#]/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
};

/** Действующие строки clamd.conf: ключ → значение (комментарии и пустые строки отброшены). */
export const clamdSettings = (conf: string) =>
  new Map(
    conf
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [key, ...value] = line.split(/\s+/);
        return [key!, value.join(' ')] as const;
      }),
  );
