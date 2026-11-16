import { describe, expect, it } from 'vitest';
import enMessages from '../messages/en.json';
import ruMessages from '../messages/ru.json';
import kkMessages from '../messages/kk.json';
const en = enMessages.siteSurvey, ru = ruMessages.siteSurvey, kk = kkMessages.siteSurvey;
function leaves(value: object, prefix = ''): [string, string][] {
  return Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? [[`${prefix}${key}`, item] as [string, string]] : leaves(item as object, `${prefix}${key}.`));
}
describe('Survey draft EN/RU/KK contract', () => {
  it.each([ru, kk])('has the same nonempty translated keys and argument placeholders as English', locale => {
    const source = leaves(en), translated = leaves(locale); expect(translated.map(([key]) => key)).toEqual(source.map(([key]) => key));
    translated.forEach(([key, text], index) => { expect(text.trim(), key).not.toBe(''); expect(text.match(/\{[^}]+\}/g) ?? [], key).toEqual(source[index]![1].match(/\{[^}]+\}/g) ?? []); });
  });
});
