import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getGradingResultsByJobId, getGradingJobById } from '@/lib/db2/acs-repo';
import { SubmissionStatus } from '@/lib/enumeration-service';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { jobId, assignmentId } = body;

    if (!jobId || !assignmentId) {
      return NextResponse.json({ success: false, error: 'Missing jobId or assignmentId' }, { status: 400 });
    }

    // Verify job exists and is completed
    const job = await getGradingJobById(jobId);
    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }
    if (job.status !== 'completed') {
      return NextResponse.json({ success: false, error: 'Job is not completed yet' }, { status: 400 });
    }

    // Fetch all grading results for this job
    const results = await getGradingResultsByJobId(jobId);
    if (results.length === 0) {
      return NextResponse.json({ success: false, error: 'No grading results found' }, { status: 404 });
    }

    // Fetch GRADED status ID using the enumeration service (category: SUBMISSION_STATUS)
    const gradedStatusId = await SubmissionStatus.getGradedId();

    const numericAssignmentId = parseInt(assignmentId.toString(), 10);
    let updatedCount = 0;

    // Load each question's configured max points so we can rescale the AI's 0-100
    // output back into the assignment's own grading scale. The AI prompt always
    // returns scores on a 0-100 scale, but each question can be worth any number
    // of points (set at assignment creation), so a raw write would produce totals
    // like 370/100.
    const questions = await prisma.assignment_questions.findMany({
      where: { assignment_id: numericAssignmentId },
      select: { id: true, points: true },
    });
    const questionPointsById = new Map<number, number>(
      questions.map(q => [q.id, q.points ?? 0])
    );

    // Apply scores to LMS database using a transaction
    await prisma.$transaction(async (tx) => {
      for (const result of results) {
        if (result.score === null) continue;

        const studentId = parseInt(result.student_id, 10);
        const questionId = parseInt(result.question_id, 10);

        if (isNaN(studentId) || isNaN(questionId)) continue;

        // Find the submission for this student and assignment
        const submission = await tx.assignment_submissions.findFirst({
          where: {
            assignment_id: numericAssignmentId,
            student_id: studentId,
          },
          orderBy: { submitted_at: 'desc' },
        });

        if (!submission) continue;

        // Scale the AI score (0..max_score, typically 0..100) into the question's
        // configured point value. Round to 2 decimals.
        const aiMax = result.max_score && result.max_score > 0 ? result.max_score : 100;
        const questionPoints = questionPointsById.get(questionId) ?? 0;
        const scaledPoints = Math.round((result.score / aiMax) * questionPoints * 100) / 100;

        // Update the answer with the scaled AI score
        const updateResult = await tx.assignment_answers.updateMany({
          where: {
            submission_id: submission.id,
            question_id: questionId,
          },
          data: {
            points_earned: scaledPoints,
            feedback: result.feedback || null,
          },
        });

        updatedCount += updateResult.count;
      }

      // Now recalculate total_score for each affected submission
      const submissions = await tx.assignment_submissions.findMany({
        where: { assignment_id: numericAssignmentId },
        include: {
          assignment_answers: {
            include: {
              assignment_questions: true,
            },
          },
        },
      });

      for (const sub of submissions) {
        const totalScore = sub.assignment_answers.reduce(
          (sum, ans) => sum + (parseFloat(ans.points_earned?.toString() || '0') || 0),
          0
        );

        await tx.assignment_submissions.update({
          where: { id: sub.id },
          data: {
            total_score: totalScore,
            graded_by: parseInt(session.user.id),
            graded_at: new Date(),
            feedback: 'Graded by AI Auto-Grading System',
            ...(gradedStatusId ? { status_id: gradedStatusId } : {}),
          },
        });
      }
    });

    return NextResponse.json({
      success: true,
      updated: updatedCount,
      message: `Applied ${updatedCount} AI grading results to the gradebook`,
    });
  } catch (error: any) {
    console.error('Error applying grades:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
