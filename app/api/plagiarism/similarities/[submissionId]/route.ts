
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { queryLMS } from '@/lib/lms-db';
import { getComparisonsBySourceSubmissionId } from '@/lib/db2/pds-repo';

interface SimilarityMatch {
  comparison_id: string;
  target_student_name: string;
  similarity_score: number; // Combined score
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  match_count: number; // Number of matched chunks
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { submissionId } = await params;

    // 1. Fetch Source Student Name (LMS)
    // To display "Similarity Report for [Student Name]"
    const numericSubId = parseInt(submissionId, 10);
    if (isNaN(numericSubId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const studentSql = `
      SELECT u.nama_lengkap as name
      FROM assignment_submissions s
      JOIN app_user u ON s.student_id = u.id
      WHERE s.id = $1
    `;
    const studentData = await queryLMS<{ name: string }>(studentSql, [numericSubId]);
    if (studentData.length === 0) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    
    const studentName = studentData[0].name;

    // 2. Fetch Comparisons from DB2
    const comparisons = await getComparisonsBySourceSubmissionId(submissionId);

    if (comparisons.length === 0) {
      return NextResponse.json({
        student_name: studentName,
        submission_id: submissionId,
        matches: []
      });
    }

    // 3. Fetch Target Student Names (LMS)
    // We have target_submission_ids, need to resolve to names
    const targetSubIds = comparisons.map(c => parseInt(c.target_submission_id, 10));
    // Use ANY($1) for array params in Postgres
    const targetSql = `
      SELECT s.id::text as submission_id, u.nama_lengkap as name
      FROM assignment_submissions s
      JOIN app_user u ON s.student_id = u.id
      WHERE s.id = ANY($1::int[])
    `;
    
    const targetStudents = await queryLMS<{ submission_id: string, name: string }>(targetSql, [targetSubIds]);
    
    // Map ID -> Name
    const targetNameMap = new Map<string, string>();
    targetStudents.forEach(t => targetNameMap.set(t.submission_id, t.name));

    // 4. Build Response
    const matches: SimilarityMatch[] = comparisons.map(comp => ({
      comparison_id: comp.id,
      target_student_name: targetNameMap.get(comp.target_submission_id) || 'Unknown Student',
      similarity_score: comp.combined_score,
      risk_level: comp.risk_level,
      match_count: Array.isArray(comp.matched_chunks) ? comp.matched_chunks.length : 0
    }));

    return NextResponse.json({
      student_name: studentName,
      submission_id: submissionId,
      matches
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
