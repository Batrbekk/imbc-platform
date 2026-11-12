-- Справочные организации (GEN-05, раздел 8.2): организация IMBC — у неё хранится ящик для писем, —
-- и major operators NCOC, TCO, KPO. Только данные: вставка того, чего нет, и отметка major у
-- существующего оператора с тем же именем. Повторное выполнение ничего не меняет. IMBC ищется по
-- типу (на стенде её создал seed), операторы — по имени без учёта регистра среди организаций без БИН.
INSERT INTO organizations (type, name) SELECT 'imbc', 'IMBC' WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE type = 'imbc');--> statement-breakpoint
INSERT INTO organizations (type, name, is_major_operator)
  SELECT 'operator', v.name, true FROM (VALUES ('NCOC'), ('TCO'), ('KPO')) AS v(name)
  WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.type = 'operator' AND o.bin IS NULL AND lower(o.name) = lower(v.name));--> statement-breakpoint
UPDATE organizations SET is_major_operator = true
  WHERE type = 'operator' AND bin IS NULL AND lower(name) IN ('ncoc', 'tco', 'kpo') AND NOT is_major_operator;
