import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getAcsAssignmentByAssignmentId } from '@/lib/db2/acs-repo';
import { gradeStudentAnswer } from '@/lib/grading-service';
import { canUseFeature } from '@/lib/feature-access';
import { Rubric } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { assignmentId, studentId, questionId, studentAnswer } = body;

    // 1. Get ACS Config & Rubric
    const acsData = await getAcsAssignmentByAssignmentId(assignmentId);

    if (!acsData) {
      return NextResponse.json({ success: false, error: 'ACS configuration not found' }, { status: 404 });
    }

    const access = await canUseFeature(acsData.course_id, 'ai_grading');
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.reason }, { status: 403 });
    }

    // Type assertion for the stored JSONB
    const rawRubric = acsData.rubric;
    let questionRubric: any = null;

    if (Array.isArray(rawRubric)) {
      // Use == (loose) to handle number/string mismatch from JSONB vs DB
      questionRubric = rawRubric.find((r: any) => r.questionId == questionId) ?? null;
    } else if (rawRubric) {
      questionRubric = rawRubric;
    }

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
      vectorStoreId: acsData.vector_store_id,
      teacherId: session.user.id,
      teacherName: session.user.name ?? undefined,
    });

    return NextResponse.json({ success: true, data: result });

  } catch (error: any) {
    console.error('Error in run-single:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
