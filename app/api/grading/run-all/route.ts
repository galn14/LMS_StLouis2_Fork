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
    const { assignmentId } = body; // LMS Assignment ID

    // 1. Fetch ACS Config
    const { data: acsData, error: acsError } = await supabaseAdmin
      .from('acs_assignments')
      .select('*')
      .eq('assignment_id', assignmentId)
      .single();

    if (acsError || !acsData) return NextResponse.json({ success: false, error: 'ACS Config not found' }, { status: 404 });

    // 2. Fetch All Student Submissions from LMS DB
    // Need to get answers for ALL students.
    // Assuming 'assignment_submissions' -> 'assignment_answers'
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
    // Since Vercel functions have timeouts (10s-60s), cannot await a loop of 50 students.
    // must process in chunks or use a background queue (like Inngest/Trigger.dev).
    // WITHOUT a queue service, can try to process a small batch or return early and let client poll/trigger batches.
    // For this prototype, will process *asynchronously* without awaiting completion in the response, 
    // BUT Vercel serverless might kill the process.
    // **Safe approach for prototype**: Process first 3-5 here to show it works, or assume user will keep tab open if running locally.
    // **Better approach**: The client should call "run-batch" with a subset, or accept the risk of timeout for small classes.
    
    // will initiate the loop but NOT await it for the response, hoping the runtime keeps it alive long enough 
    // (Note: reliable only on VPS/Container, not Serverless). 
    // For this specific request, I'll implement the loop but warn about timeouts.
    
    (async () => {
        try {
            const fullRubric = acsData.rubric as any[];

            for (const sub of submissions) {
                for (const ans of sub.assignment_answers) {
                     const questionRubric = fullRubric.find((r: any) => r.questionId === ans.question_id) || fullRubric[0];
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
            
            // Mark job complete
            await supabaseAdmin.from('acs_grading_jobs').update({ 
                status: 'completed', 
                completed_at: new Date().toISOString() 
            }).eq('id', jobData.id);

        } catch (err) {
             console.error('Background grading failed:', err);
             await supabaseAdmin.from('acs_grading_jobs').update({ status: 'failed' }).eq('id', jobData.id);
        }
    })();

    return NextResponse.json({ success: true, jobId: jobData.id, message: 'Grading started in background' });

  } catch (error: any) {
    console.error('Error in run-all:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
