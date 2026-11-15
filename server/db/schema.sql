CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  members TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_groups_room_id ON groups(room_id);

-- Original student-written contributions, independently saved per bullet.
CREATE TABLE IF NOT EXISTS group_notes (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  replaces_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, id)
);

-- Backward-compatible session metadata: existing room rows remain valid.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS teacher_topic TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS discussion_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS instructor_name TEXT;
-- Optional presentation countdown only; never expires a room or blocks audio.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS discussion_timer JSONB NOT NULL
  DEFAULT '{"status":"idle","durationSeconds":600,"remainingMs":600000,"endsAt":null}'::jsonb;

-- Durable, independently polled jobs survive browser navigation and backend restarts.
CREATE TABLE IF NOT EXISTS argument_map_jobs (
  room_code VARCHAR(6) PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'Queued',
  input JSONB NOT NULL,
  result JSONB,
  error TEXT,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
