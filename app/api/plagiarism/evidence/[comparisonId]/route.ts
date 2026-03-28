
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { queryLMS } from '@/lib/lms-db';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  { params }: { params: { comparisonId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { comparisonId } = await params;

    // 1. Fetch Comparison Data (Supabase)
    const { data: comparison, error } = await supabaseAdmin
      .from('pds_comparisons')
      .select('*')
      .eq('id', comparisonId)
      .single();

    if (error || !comparison) {
      return NextResponse.json({ error: 'Comparison not found' }, { status: 404 });
    }

    // 2. Fetch Flag Data (if exists)
    const { data: flag } = await supabaseAdmin
      .from('pds_flags')
      .select('*')
      .eq('comparison_id', comparisonId)
      .eq('submission_id', comparison.source_submission_id) // Get flag for source
      .single();

    // 3. Fetch Full Text Content (LMS)
    // We need the full text for display, not just chunks.
    const sourceId = parseInt(comparison.source_submission_id);
    const targetId = parseInt(comparison.target_submission_id);

    // Fetch both in one query or two. Let's do one.
    const sql = `
      SELECT 
        s.id::text as submission_id,
        u.nama_lengkap as student_name,
        string_agg(a.answer_text, '\n\n') as content
      FROM assignment_submissions s
      JOIN app_user u ON s.student_id = u.id
      JOIN assignment_answers a ON s.id = a.submission_id
      WHERE s.id IN ($1, $2)
      GROUP BY s.id, u.nama_lengkap
    `;

    const submissions = await queryLMS(sql, [sourceId, targetId]);

    const sourceSub = submissions.find(s => s.submission_id === comparison.source_submission_id);
    const targetSub = submissions.find(s => s.submission_id === comparison.target_submission_id);

    if (!sourceSub || !targetSub) {
      return NextResponse.json({ error: 'Submission content not found in LMS' }, { status: 404 });
    }

    // 4. Construct Response
    return NextResponse.json({
      comparison_id: comparison.id,
      source_student: sourceSub.student_name,
      target_student: targetSub.student_name,
      source_content: sourceSub.content,
      target_content: targetSub.content,
      overall_similarity: comparison.combined_score,
      risk_level: comparison.risk_level,
      matched_chunks: comparison.matched_chunks,
      // Flag info
      flag_id: flag?.id || null,
      reviewed: flag?.reviewed || false,
      is_false_positive: flag?.is_false_positive || false,
      teacher_notes: flag?.teacher_notes || null
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 } 
    );
  }
}
