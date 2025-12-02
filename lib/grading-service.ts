import { openai } from '@/lib/openai';
import { supabaseAdmin } from '@/lib/supabase/server';
import { GradingResult, Rubric } from '@/lib/types';

interface GradeStudentParams {
  assignmentId: string;
  studentId: string;
  questionId: string;
  studentAnswer: string;
  rubric: Rubric;
  assistantId: string;
  jobId?: string;
}

export async function gradeStudentAnswer({
  assignmentId,
  studentId,
  questionId,
  studentAnswer,
  rubric,
  assistantId,
  jobId,
}: GradeStudentParams) {
  try {
    // 1. Create Thread
    const thread = await openai.beta.threads.create();

    // 2. Prepare Message Payload
    const messagePayload = {
      question_id: questionId,
      student_answer: studentAnswer,
      rubric: rubric,
    };

    // 3. Add Message
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: JSON.stringify(messagePayload),
    });

    // 4. Run Assistant
    const run = await openai.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistantId,
    });

    let gradingResult: GradingResult | null = null;
    let totalTokens = 0;

    if (run.status === 'completed') {
      // 5. Retrieve Response
      const messages = await openai.beta.threads.messages.list(thread.id);
      const lastMessage = messages.data[0];

      if (lastMessage.content[0].type === 'text') {
        const rawResponse = lastMessage.content[0].text.value;
        // Clean up markdown code blocks if present
        const jsonString = rawResponse.replace(/```json\n?|```/g, '').trim();
        try {
          gradingResult = JSON.parse(jsonString) as GradingResult;
        } catch (e) {
            console.error('Failed to parse AI response:', rawResponse);
            // Fallback for parsing error
             gradingResult = {
                score: null,
                max_score: rubric.max_score,
                qualitative_grade: null,
                feedback: "Error parsing AI response. Please review manually.",
                citations: [],
                confidence: 'low',
                rubric_alignment: {},
                language_detected: 'en',
                token_usage_estimate: 0
            };
        }
      }

      // Track token usage
      if (run.usage) {
        totalTokens = run.usage.total_tokens;
      }
    } else {
      console.error('Run failed or expired:', run.status, run.last_error);
       // Create failed result
       gradingResult = {
            score: null,
            max_score: rubric.max_score,
            qualitative_grade: null,
            feedback: `Grading failed. Status: ${run.status}. Error: ${run.last_error?.message || 'Unknown'}`, 
            citations: [],
            confidence: 'low',
            rubric_alignment: {},
            language_detected: 'en',
            token_usage_estimate: 0
        };
    }

    // 6. Save Result to Supabase
    if (gradingResult) {
      const { error } = await supabaseAdmin.from('acs_grading_results').insert({
        job_id: jobId,
        assignment_id: assignmentId,
        student_id: studentId,
        question_id: questionId,
        score: gradingResult.score,
        max_score: gradingResult.max_score,
        qualitative_grade: gradingResult.qualitative_grade,
        feedback: gradingResult.feedback,
        citations: JSON.stringify(gradingResult.citations),
        confidence: gradingResult.confidence,
        rubric_alignment: JSON.stringify(gradingResult.rubric_alignment),
        language_detected: gradingResult.language_detected,
      });
      
      if (error) console.error('Error saving grading result:', error);
    }

    // 7. Track Token Usage
    if (totalTokens > 0) {
        // Estimate cost (rough estimate, e.g., $5.00 / 1M tokens blended)
        // Update with actual pricing for gpt-4o if needed ($5 input, $15 output)
        const cost = (totalTokens / 1000000) * 10; // Averaging to $10/1M for simplicity

        await supabaseAdmin.from('acs_token_usage').insert({
            job_id: jobId,
            assignment_id: assignmentId,
            student_id: studentId,
            tokens_used: totalTokens,
            estimated_cost: cost
        });
    }

    // Cleanup Thread (optional, but good for hygiene)
    // await openai.beta.threads.del(thread.id);

    return gradingResult;

  } catch (error) {
    console.error('Fatal error in gradeStudentAnswer:', error);
    throw error;
  }
}
