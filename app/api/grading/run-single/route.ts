import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/prisma';
import { supabaseAdmin } from '@/lib/supabase/server';
import { gradeStudentAnswer } from '@/lib/grading-service';
import { Rubric } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { assignmentId, studentId, questionId, studentAnswer } = body;

    // 1. Get Assistant & Rubric Config
    const { data: acsData, error: acsError } = await supabaseAdmin
      .from('acs_assignments')
      .select('assistant_id, rubric')
      .eq('assignment_id', assignmentId)
      .single();

    if (acsError || !acsData) {
      return NextResponse.json({ success: false, error: 'ACS configuration not found' }, { status: 404 });
    }

    // Find rubric for this question (assuming rubric is stored as array with question_id or order)
    // For simplicity, assuming rubric is an array of Rubric objects passed from frontend or mapped by question_id
    // Adjust logic to match how you stored `rubric` JSONB. 
    // If `rubric` is an array of objects like [{questionId: '1', ...rubric}], find it.
    // If simply the rubric object itself, use it directly.
    // Here assume the stored rubric is an array of objects which contain a `questionId` field or similar map.
    
    // Type assertion for the stored JSONB
    const fullRubric = acsData.rubric as any[]; 
    const questionRubric = fullRubric.find((r: any) => r.questionId === questionId) || fullRubric[0]; // Fallback for demo

    if (!questionRubric) {
        return NextResponse.json({ success: false, error: 'Rubric for question not found' }, { status: 400 });
    }

    // 2. Run Grading
    const result = await gradeStudentAnswer({
      assignmentId,
      studentId,
      questionId,
      studentAnswer,
      rubric: questionRubric,
      assistantId: acsData.assistant_id,
    });

    return NextResponse.json({ success: true, data: result });

  } catch (error: any) {
    console.error('Error in run-single:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
