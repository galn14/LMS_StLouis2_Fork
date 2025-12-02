-- Core assignment configuration
CREATE TABLE IF NOT EXISTS acs_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id VARCHAR NOT NULL UNIQUE,
  course_id VARCHAR NOT NULL,
  assistant_id VARCHAR NOT NULL,
  vector_store_id VARCHAR NOT NULL,
  rubric JSONB NOT NULL,
  created_by VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'setup',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

-- Track uploaded files for cleanup
CREATE TABLE IF NOT EXISTS acs_uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id VARCHAR NOT NULL REFERENCES acs_assignments(assignment_id),
  file_id VARCHAR NOT NULL,
  filename VARCHAR NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batch grading job tracking
CREATE TABLE IF NOT EXISTS acs_grading_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id VARCHAR NOT NULL REFERENCES acs_assignments(assignment_id),
  total_students INTEGER NOT NULL,
  status VARCHAR DEFAULT 'running',       -- running | completed | failed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_tokens INTEGER DEFAULT 0
);

-- Individual grading results (one row per question per student)
CREATE TABLE IF NOT EXISTS acs_grading_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES acs_grading_jobs(id),
  assignment_id VARCHAR NOT NULL,
  student_id VARCHAR NOT NULL,
  question_id VARCHAR NOT NULL,
  score NUMERIC,
  max_score NUMERIC NOT NULL,
  qualitative_grade VARCHAR,
  feedback TEXT NOT NULL,
  citations JSONB DEFAULT '[]',
  confidence VARCHAR NOT NULL,
  rubric_alignment JSONB NOT NULL,
  language_detected VARCHAR NOT NULL,
  graded_at TIMESTAMPTZ DEFAULT NOW(),
  -- Override support
  overridden BOOLEAN DEFAULT FALSE,
  override_score NUMERIC,
  override_feedback TEXT,
  overridden_by VARCHAR,
  overridden_at TIMESTAMPTZ
);

-- Token usage tracking
CREATE TABLE IF NOT EXISTS acs_token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES acs_grading_jobs(id),
  assignment_id VARCHAR NOT NULL,
  student_id VARCHAR NOT NULL,
  tokens_used INTEGER NOT NULL,
  estimated_cost NUMERIC(10,4),           -- IDR
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_grading_results_assignment ON acs_grading_results(assignment_id);
CREATE INDEX IF NOT EXISTS idx_grading_results_student ON acs_grading_results(student_id);
CREATE INDEX IF NOT EXISTS idx_grading_jobs_status ON acs_grading_jobs(status);
