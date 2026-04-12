
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { initDetection, processDetection } from '@/lib/plagiarism/detection';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = (session.user.role || '').toUpperCase();
    if (!role.includes('GURU') && !role.includes('TEACHER') && !role.includes('ADMIN')) {
       return NextResponse.json({ error: 'Forbidden: Teachers only' }, { status: 403 });
    }

    const body = await request.json();
    const { assignmentId, questionIds } = body;

    if (!assignmentId) {
      return NextResponse.json({ error: 'Missing assignmentId' }, { status: 400 });
    }

    // questionIds: string[] — empty or missing means "all essay questions"
    const normalizedQuestionIds: string[] = Array.isArray(questionIds) ? questionIds : [];

    const detectionId = await initDetection(assignmentId, session.user.id, normalizedQuestionIds);

    processDetection(detectionId, assignmentId, session.user.id, normalizedQuestionIds).catch(err => {
      console.error('[PDS] Background detection error:', err);
    });

    return NextResponse.json({ detectionId });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
