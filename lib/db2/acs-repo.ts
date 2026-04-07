import { queryAux } from '@/lib/aux-db';

export interface AcsAssignmentRecord {
  id: string;
  assignment_id: string;
  course_id: string;
  assistant_id: string;
  vector_store_id: string;
  rubric: unknown;
  created_by: string;
  status: string;
  rerun_grading: boolean;
  rerun_grading_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcsUploadedFileRecord {
  id: string;
  assignment_id: string;
  file_id: string;
  filename: string;
  type_file: string | null;
  created_at: string;
}

export interface AcsGradingJobRecord {
  id: string;
  assignment_id: string;
  total_students: number;
  status: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UpsertAcsAssignmentInput {
  assignment_id: string;
  course_id: string;
  assistant_id: string;
  vector_store_id: string;
  rubric: unknown;
  created_by: string;
  status: string;
  rerun_grading: boolean;
  rerun_grading_at?: string | null;
  archived_at?: string | null;
}

interface UploadedFileInsert {
  assignment_id: string;
  file_id: string;
  filename: string;
  type_file?: string | null;
}

interface GradingJobInsert {
  assignment_id: string;
  total_students: number;
  status: string;
}

interface GradingResultInsert {
  job_id?: string;
  assignment_id: string;
  student_id: string;
  question_id: string;
  score: number | null;
  max_score: number;
  qualitative_grade: string | null;
  feedback: string;
  citations: unknown;
  confidence: string;
  rubric_alignment: unknown;
  language_detected: string;
}

interface TokenUsageInsert {
  job_id?: string;
  assignment_id: string;
  student_id: string;
  tokens_used: number;
  estimated_cost: number;
}

function buildBulkInsertValues<T>(
  rows: T[],
  columns: Array<keyof T>,
  startIndex = 1
) {
  const values: unknown[] = [];
  const placeholders = rows.map((row, rowIndex) => {
    const tuple = columns.map((column, columnIndex) => {
      values.push(row[column]);
      return `$${startIndex + rowIndex * columns.length + columnIndex}`;
    });

    return `(${tuple.join(', ')})`;
  });

  return { placeholders, values };
}

export async function getAcsAssignmentByAssignmentId(assignmentId: string) {
  const rows = await queryAux<AcsAssignmentRecord>(
    `
      SELECT *
      FROM acs_assignments
      WHERE assignment_id = $1
      LIMIT 1
    `,
    [assignmentId]
  );

  return rows[0] ?? null;
}

export async function upsertAcsAssignment(input: UpsertAcsAssignmentInput) {
  const rows = await queryAux<AcsAssignmentRecord>(
    `
      INSERT INTO acs_assignments (
        assignment_id,
        course_id,
        assistant_id,
        vector_store_id,
        rubric,
        created_by,
        status,
        rerun_grading,
        rerun_grading_at,
        archived_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
      ON CONFLICT (assignment_id)
      DO UPDATE SET
        course_id = EXCLUDED.course_id,
        assistant_id = EXCLUDED.assistant_id,
        vector_store_id = EXCLUDED.vector_store_id,
        rubric = EXCLUDED.rubric,
        created_by = EXCLUDED.created_by,
        status = EXCLUDED.status,
        rerun_grading = EXCLUDED.rerun_grading,
        rerun_grading_at = EXCLUDED.rerun_grading_at,
        archived_at = EXCLUDED.archived_at,
        updated_at = NOW()
      RETURNING *
    `,
    [
      input.assignment_id,
      input.course_id,
      input.assistant_id,
      input.vector_store_id,
      JSON.stringify(input.rubric),
      input.created_by,
      input.status,
      input.rerun_grading,
      input.rerun_grading_at ?? null,
      input.archived_at ?? null,
    ]
  );

  return rows[0];
}

export async function insertUploadedFiles(records: UploadedFileInsert[]) {
  if (records.length === 0) {
    return;
  }

  const columns: Array<keyof UploadedFileInsert> = ['assignment_id', 'file_id', 'filename', 'type_file'];
  const { placeholders, values } = buildBulkInsertValues(records, columns);

  await queryAux(
    `
      INSERT INTO acs_uploaded_files (
        assignment_id,
        file_id,
        filename,
        type_file
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (assignment_id, file_id) DO NOTHING
    `,
    values
  );
}

export async function getUploadedFilesByAssignmentId(assignmentId: string) {
  return queryAux<AcsUploadedFileRecord>(
    `
      SELECT *
      FROM acs_uploaded_files
      WHERE assignment_id = $1
      ORDER BY created_at ASC
    `,
    [assignmentId]
  );
}

export async function archiveAcsAssignment(assignmentId: string, archivedAt: string) {
  await queryAux(
    `
      UPDATE acs_assignments
      SET
        status = 'archived',
        archived_at = $2,
        updated_at = NOW()
      WHERE assignment_id = $1
    `,
    [assignmentId, archivedAt]
  );
}

export async function createGradingJob(input: GradingJobInsert) {
  const rows = await queryAux<AcsGradingJobRecord>(
    `
      INSERT INTO acs_grading_jobs (
        assignment_id,
        total_students,
        status
      )
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [input.assignment_id, input.total_students, input.status]
  );

  return rows[0];
}

export async function updateGradingJobStatus(
  jobId: string,
  status: string,
  completedAt?: string | null
) {
  await queryAux(
    `
      UPDATE acs_grading_jobs
      SET
        status = $2,
        completed_at = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [jobId, status, completedAt ?? null]
  );
}

export async function getGradingJobById(jobId: string) {
  const rows = await queryAux<AcsGradingJobRecord>(
    `
      SELECT *
      FROM acs_grading_jobs
      WHERE id = $1
      LIMIT 1
    `,
    [jobId]
  );

  return rows[0] ?? null;
}

export async function countGradingResultsByJobId(jobId: string) {
  const rows = await queryAux<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM acs_grading_results
      WHERE job_id = $1
    `,
    [jobId]
  );

  return Number(rows[0]?.count ?? 0);
}

export async function getGradingResultsByJobId(jobId: string) {
  return queryAux<{
    student_id: string;
    question_id: string;
    score: number | null;
    max_score: number;
    qualitative_grade: string | null;
    feedback: string;
    citations: unknown;
    confidence: string;
    rubric_alignment: unknown;
    language_detected: string;
  }>(
    `
      SELECT student_id, question_id, score, max_score, qualitative_grade,
             feedback, citations, confidence, rubric_alignment, language_detected
      FROM acs_grading_results
      WHERE job_id = $1
      ORDER BY student_id ASC, question_id ASC
    `,
    [jobId]
  );
}

export async function insertGradingResult(input: GradingResultInsert) {
  await queryAux(
    `
      INSERT INTO acs_grading_results (
        job_id,
        assignment_id,
        student_id,
        question_id,
        score,
        max_score,
        qualitative_grade,
        feedback,
        citations,
        confidence,
        rubric_alignment,
        language_detected
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12)
    `,
    [
      input.job_id ?? null,
      input.assignment_id,
      input.student_id,
      input.question_id,
      input.score,
      input.max_score,
      input.qualitative_grade,
      input.feedback,
      JSON.stringify(input.citations),
      input.confidence,
      JSON.stringify(input.rubric_alignment),
      input.language_detected,
    ]
  );
}

export async function insertTokenUsage(input: TokenUsageInsert) {
  await queryAux(
    `
      INSERT INTO acs_token_usage (
        job_id,
        assignment_id,
        student_id,
        tokens_used,
        estimated_cost
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      input.job_id ?? null,
      input.assignment_id,
      input.student_id,
      input.tokens_used,
      input.estimated_cost,
    ]
  );
}
