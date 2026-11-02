-- Đề xuất: chỉ áp dụng lên Siris sau khi người dùng phê duyệt cụ thể.
BEGIN;
CREATE SCHEMA siris_admin;
REVOKE ALL ON SCHEMA siris_admin FROM PUBLIC, anon, authenticated;
CREATE TABLE siris_admin.lookup_configs (
  id text PRIMARY KEY,
  source_table text NOT NULL,
  label text NOT NULL,
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, label)
);
REVOKE ALL ON siris_admin.lookup_configs FROM PUBLIC, anon, authenticated;
COMMIT;
