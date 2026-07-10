-- Allow deleting users in the DB without foreign-key errors.
-- Applied manually against the live database on 2026-07-10; committed here
-- for reproducibility and to keep server/schema.ts in sync with the DB.

-- projects.created_by is no longer needed; drop it entirely.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_created_by_fkey;
ALTER TABLE projects DROP COLUMN IF EXISTS created_by;

-- Keep a task's creator field but clear it (rather than blocking deletion)
-- when the referenced user is removed.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- Assignment links, chat sessions, and citations are owned by the user;
-- remove them when the user is deleted.
ALTER TABLE task_assignees DROP CONSTRAINT IF EXISTS task_assignees_user_id_fkey;
ALTER TABLE task_assignees ADD CONSTRAINT task_assignees_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_user_id_fkey;
ALTER TABLE chat_sessions ADD CONSTRAINT chat_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE citations DROP CONSTRAINT IF EXISTS citations_user_id_fkey;
ALTER TABLE citations ADD CONSTRAINT citations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- chat_messages must also cascade so deleting a user's chat sessions doesn't
-- get blocked by that session's messages.
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_session_id_fkey;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;

-- task_comments does not exist in the live database yet (tracked separately
-- as a follow-up task). Its Drizzle definition already sets author_id to
-- ON DELETE SET NULL so that once created it needs no further migration.

-- documents.uploaded_by is intentionally left unchanged (out of scope for
-- this task per the assigned task description).
