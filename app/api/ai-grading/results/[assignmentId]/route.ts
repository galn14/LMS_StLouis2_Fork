import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import {
  getGradingResultsByJobAndStudent,
  getLatestCompletedJobByAssignment,
} from '@/lib/db2/acs-repo';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { assignmentId } = await params;
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');

  if (!assignmentId) {
    return NextResponse.json(
      { success: false, error: 'Missing assignmentId' },
      { status: 400 }
    );
  }
  if (!studentId) {
    return NextResponse.json(
      { success: false, error: 'Missing studentId query parameter' },
      { status: 400 }
    );
  }

  const job = await getLatestCompletedJobByAssignment(assignmentId);
  if (!job) {
    return NextResponse.json({
      success: true,
      data: { job: null, results: [] },
    });
  }

  const results = await getGradingResultsByJobAndStudent(job.id, studentId);

  return NextResponse.json({
    success: true,
    data: {
      job: {
        id: job.id,
        assignment_id: job.assignment_id,
        completed_at: job.completed_at,
      },
      results,
    },
  });
}
