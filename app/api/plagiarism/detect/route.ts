
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { detectPlagiarism } from '@/lib/plagiarism/detection';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role check: Allow 'GURU', 'TEACHER', 'ADMIN' (case-insensitive)
    const role = (session.user.role || '').toUpperCase();
    if (!role.includes('GURU') && !role.includes('TEACHER') && !role.includes('ADMIN')) {
       return NextResponse.json({ error: 'Forbidden: Teachers only' }, { status: 403 });
    }

    const body = await request.json();
    const { assignmentId } = body;

    if (!assignmentId) {
      return NextResponse.json({ error: 'Missing assignmentId' }, { status: 400 });
    }

    // Trigger detection (this can be long-running, so we might want to just start it 
    // and return 'processing', or await if it's fast enough for <1 min. 
    // AGENTS.md says "50 submissions < 5 mins". Vercel serverless timeout is usually 10-60s.
    // Ideally this should be a background job, but for MVP we might await it 
    // or start it without awaiting (fire and forget) and user polls status.
    
    // Given MVP constraints and Next.js, "fire and forget" is risky on Vercel (process might die).
    // However, sticking to the plan: return the detectionId so user can poll.
    // We will await the *initiation* (DB record creation) inside detectPlagiarism, 
    // but maybe we should split detectPlagiarism into "init" and "process".
    // For now, I'll await the whole thing, but warn about timeout. 
    // ACTUALLY, checking AGENTS.md: "GET /api/plagiarism/status/[detectionId] Used for polling".
    // This implies async processing. 
    // To achieve async in Next.js API routes without Vercel timeout killing it, 
    // usually requires external queue (Redis/QStash) or Edge Functions.
    // For this strict budget/MVP, we'll try to execute it. 
    // If it times out, we need a better strategy (e.g. client triggers batch processing chunk by chunk).
    
    // For now, let's just call it.
    
    const result = await detectPlagiarism(assignmentId, session.user.id);

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message }, 
      { status: 500 }
    );
  }
}
