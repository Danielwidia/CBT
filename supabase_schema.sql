-- Jalankan SQL ini di Supabase Dashboard > SQL Editor
-- Buat tabel untuk menyimpan database utama (soal, siswa, dll)
CREATE TABLE IF NOT EXISTS cbt_database (
  id BIGSERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Buat tabel untuk menyimpan hasil ujian siswa
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

-- Sisipkan baris awal untuk database jika belum ada
INSERT INTO cbt_database (data)
SELECT '{
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
}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM cbt_database LIMIT 1);
