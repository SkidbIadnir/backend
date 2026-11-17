-- User feedback: POST /tasteep/feedback, /admin/feedback (backend PR #17).
-- Mirrors src/tasteep/entities/tasteep-feedback.entity.ts. Safe to re-run.
CREATE TABLE IF NOT EXISTS tasteep_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES tasteep_users(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  app_version text,
  platform text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasteep_feedback_user_idx ON tasteep_feedback (user_id);
CREATE INDEX IF NOT EXISTS tasteep_feedback_status_created_idx ON tasteep_feedback (status, created_at);
