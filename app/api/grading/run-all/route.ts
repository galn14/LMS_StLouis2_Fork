import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/prisma';
import { supabaseAdmin } from '@/lib/supabase/server';
import { gradeStudentAnswer } from '@/lib/grading-service';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { assignmentId } = body;

    // 1. Fetch ACS Config
    const { data: acsData, error: acsError } = await supabaseAdmin
      .from('acs_assignments')
      .select('*')
      .eq('assignment_id', assignmentId)
      .single();

    if (acsError || !acsData) return NextResponse.json({ success: false, error: 'ACS Config not found' }, { status: 404 });

    // 2. Fetch All Student Submissions from LMS DB
    const submissions = await prisma.assignment_submissions.findMany({
      where: { assignment_id: parseInt(assignmentId) },
      include: {
        assignment_answers: true
      }
    });

    if (submissions.length === 0) {
         return NextResponse.json({ success: false, message: 'No submissions found to grade' });
    }

    // 3. Create Job Record
    const { data: jobData, error: jobError } = await supabaseAdmin
      .from('acs_grading_jobs')
      .insert({
        assignment_id: assignmentId,
        total_students: submissions.length,
        status: 'running'
      })
      .select()
      .single();
    
    if (jobError) throw new Error('Failed to create job record');

    // 4. Start Background Processing (Fire and Forget or Queue)
    (async () => {
        try {
            const rawRubric = acsData.rubric;

            for (const sub of submissions) {
                for (const ans of sub.assignment_answers) {
                     let questionRubric: any = null;
                     if (Array.isArray(rawRubric)) {
                        questionRubric = rawRubric.find((r: any) => r.questionId === ans.question_id) || rawRubric[0];
                     } else if (rawRubric) {
                        questionRubric = rawRubric;
                     }

                     if (!questionRubric || !ans.answer_text) continue;

                     await gradeStudentAnswer({
                         assignmentId,
                         studentId: sub.student_id.toString(),
                         questionId: ans.question_id.toString(),
                         studentAnswer: ans.answer_text,
                         rubric: questionRubric,
                         assistantId: acsData.assistant_id,
                         jobId: jobData.id
                     });
                }
            }
            await supabaseAdmin.from('acs_grading_jobs').update({ 
                status: 'completed', 
                completed_at: new Date().toISOString() 
            }).eq('id', jobData.id);

        } catch (err) {
             console.error('Background grading failed:', err);
             await supabaseAdmin.from('acs_grading_jobs').update({ status: 'failed' }).eq('id', jobData.id);
        }
    })();

    return NextResponse.json({ success: true, jobId: jobData.id, message: 'Grading started in background', submissions, gradeStudentAnswer });

  } catch (error: any) {
    console.error('Error in run-all:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
