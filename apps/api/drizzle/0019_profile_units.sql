-- MAN-23: the quantity is annual; per_year is not a fifth quantity unit.
INSERT INTO dictionary(code, name) VALUES ('unit', 'Units') ON CONFLICT (code) DO NOTHING;
