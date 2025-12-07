import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Missing jobId' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('acs_grading_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
  }

  // Get progress count
  const { count } = await supabaseAdmin
    .from('acs_grading_results')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId);

  const studentGradeFeedback = await supabaseAdmin
    .from('acs_grading_results')
    .select('student_id, question_id, score, feedback')
    .eq('job_id', jobId);

  const resultData = await supabaseAdmin
    .from('acs_grading_jobs')
    .select('total_students')
    .eq('id', jobId)
    .single();

  if (resultData.error) {
    return NextResponse.json({ success: false, error: 'Could not fetch total students' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      ...data,
      items_processed: count
    },
    resultData: resultData.data,
    studentGradeFeedback: studentGradeFeedback.data
  });
}

