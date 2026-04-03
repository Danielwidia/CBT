-- Jalankan SQL ini di Supabase Dashboard > SQL Editor
-- https://supabase.com/dashboard/project/vzrrwbaupqegzbnsqvfe/sql/new

-- 1. Buat tabel untuk database utama
CREATE TABLE IF NOT EXISTS cbt_database (
  id BIGINT PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Buat tabel untuk hasil ujian siswa
CREATE TABLE IF NOT EXISTS cbt_results (
  id BIGSERIAL PRIMARY KEY,
  student_id TEXT NOT NULL,
  mapel TEXT,
  rombel TEXT,
  date TEXT,
  score NUMERIC,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PENTING: Disable RLS agar anon key bisa baca/tulis
ALTER TABLE cbt_database DISABLE ROW LEVEL SECURITY;
ALTER TABLE cbt_results  DISABLE ROW LEVEL SECURITY;

-- 4. Sisipkan data awal (hanya jika tabel masih kosong)
INSERT INTO cbt_database (id, data)
VALUES (1, '{
  "subjects": [
    {"name":"Pendidikan Agama","locked":false},
    {"name":"Bahasa Indonesia","locked":false},
    {"name":"Matematika","locked":false},
    {"name":"IPA","locked":false},
    {"name":"IPS","locked":false},
    {"name":"Bahasa Inggris","locked":false}
  ],
  "rombels": ["VII","VIII","IX"],
  "questions": [],
  "students": [{"id":"ADM","password":"admin321","name":"Administrator","role":"admin"}],
  "results": [],
  "schedules": [],
  "timeLimits": {}
}'::jsonb)
ON CONFLICT (id) DO NOTHING;
