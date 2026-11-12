-- Đề xuất: bạn tự chạy trên Supabase (SQL editor). Lưu cấu hình giao diện dùng chung.
BEGIN;
CREATE SCHEMA IF NOT EXISTS siris_admin;
REVOKE ALL ON SCHEMA siris_admin FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS siris_admin.ui_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON siris_admin.ui_settings FROM PUBLIC, anon, authenticated;
COMMIT;
