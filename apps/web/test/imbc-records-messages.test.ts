import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import ru from "../messages/ru.json";
import kk from "../messages/kk.json";
function leaves(value: object, prefix = ""): [string, string][] {
  return Object.entries(value).flatMap(([key, row]) =>
    typeof row === "string" ? [[prefix + key, row] as [string, string]] : leaves(row as object, prefix + key + "."),
  );
}
describe("IMBC records EN/RU/KK vocabulary", () => {
  it.each([ru.imbcRecords, kk.imbcRecords])(
    "has complete nonempty translations and matching placeholders",
    (translation) => {
      const source = leaves(en.imbcRecords),
        target = leaves(translation);
      expect(target.map(([key]) => key)).toEqual(source.map(([key]) => key));
      for (let i = 0; i < source.length; i++) {
        expect(target[i]![1].trim()).not.toBe("");
        expect(target[i]![1].match(/\{[^}]+\}/g) ?? []).toEqual(source[i]![1].match(/\{[^}]+\}/g) ?? []);
      }
    },
  );
});
