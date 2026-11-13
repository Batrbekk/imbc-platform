-- Данные этапа 2. Только вставка того, чего нет: повторное выполнение ничего не меняет (NFR-06).
-- 1. Двенадцать справочников ADM-08 (коды DBML `dictionary.code`, порядок требования; `DICTIONARY_CODES`).
-- 2. Семнадцать правил писем NOT-01…NOT-17 (раздел 8.2): получатели — части через `+`; правила меняются
--    только релизом.
-- 3. Письма, отправленные предыдущей версией (notifications_sent), — в журнал notification (NOT-18):
--    dedup_key = <код>\n<ключ события>\n<адрес в нижнем регистре>, тот же формат строит notificationDedupKey;
--    аккаунт находится по адресу без учёта регистра; язык вне kk, ru, en — kk (NOT-19); коды вне правил
--    не переносятся. Сама notifications_sent остаётся до contract: в неё пишет предыдущая версия.
INSERT INTO dictionary (code, name) VALUES
  ('region','Regions'),('legal_form','Legal forms'),('oked','OKED'),('tn_ved','TN VED'),('kpved','KPVED'),
  ('commodity_group','Commodity groups'),('commodity_type','Commodity types'),('process','Processes'),
  ('equipment_type','Equipment types'),('contact_role','Contact roles'),('certificate_type','Certificate types'),
  ('document_type','Document types')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO notification_rule (code, event, recipient_rule) VALUES
  ('NOT-01','password_link','person'),('NOT-02','sign_in_code','person'),('NOT-03','account_locked','person'),
  ('NOT-04','profile_submitted','imbc_mailbox'),('NOT-05','review_result','manufacturer_account+focal_point'),
  ('NOT-06','certificate_expiry_threshold','manufacturer_account+imbc_mailbox'),
  ('NOT-07','imbc_request_received','imbc_mailbox'),('NOT-08','imbc_request_replied','person'),
  ('NOT-09','export_file_ready','person'),('NOT-10','profile_unlocked_in_review','assigned_sme_or_imbc_mailbox'),
  ('NOT-11','profile_site_surveyed','operator_accounts_not_blocked'),
  ('NOT-12','quarter_confirmation_request','manufacturer_account+focal_point'),
  ('NOT-13','operator_request_sent','manufacturer_contacts+imbc_mailbox'),('NOT-14','operator_request_replied','person'),
  ('NOT-15','second_missed_quarter','manufacturer_account+focal_point'),
  ('NOT-16','profile_unresponsive','manufacturer_account+focal_point'),('NOT-17','subscriptions_pause_warning','person')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO notification (rule_code, recipient_email, user_account_id, language, dedup_key, sent_at)
  SELECT ns.code, ns.recipient, ua.id,
         CASE WHEN ns.locale IN ('kk','ru','en') THEN ns.locale::locale ELSE 'kk'::locale END,
         ns.code || E'\n' || ns.dedupe_key || E'\n' || lower(ns.recipient), ns.sent_at
  FROM notifications_sent ns LEFT JOIN user_accounts ua ON lower(ua.email) = lower(ns.recipient)
  WHERE ns.code IN (SELECT code FROM notification_rule)
ON CONFLICT (dedup_key) DO NOTHING;
