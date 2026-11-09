/**
 * БИН/ИИН Республики Казахстан: 12 цифр, последняя — контрольная (MAN-02).
 * Контрольный разряд: сумма первых 11 цифр с весами 1…11 по модулю 11;
 * если результат 10 — повтор с весами 3…11,1,2; если снова 10 — номер недействителен.
 */
const WEIGHTS_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const WEIGHTS_2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2] as const;

export type BinCheck = { valid: true; bin: string } | { valid: false; reason: 'format' | 'check_digit' };

function weightedMod11(digits: number[], weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += (digits[i] ?? 0) * (weights[i] ?? 0);
  return sum % 11;
}

export function computeBinCheckDigit(first11: string): number | null {
  if (!/^\d{11}$/.test(first11)) return null;
  const digits = [...first11].map(Number);
  let control = weightedMod11(digits, WEIGHTS_1);
  if (control === 10) control = weightedMod11(digits, WEIGHTS_2);
  return control === 10 ? null : control;
}

export function checkBin(input: string): BinCheck {
  const bin = input.replace(/\s+/g, '');
  if (!/^\d{12}$/.test(bin)) return { valid: false, reason: 'format' };
  const expected = computeBinCheckDigit(bin.slice(0, 11));
  if (expected === null || expected !== Number(bin[11])) return { valid: false, reason: 'check_digit' };
  return { valid: true, bin };
}

export const isValidBin = (input: string): boolean => checkBin(input).valid;
