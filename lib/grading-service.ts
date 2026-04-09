import { openai } from '@/lib/openai';
import { insertGradingResult, insertTokenUsage } from '@/lib/db2/acs-repo';
import { GradingResult, Rubric } from '@/lib/types';
import fs from 'fs';
import path from 'path';

const systemPrompt = fs.readFileSync(
  path.join(process.cwd(), 'prompts', 'grading-system-prompt.txt'),
  'utf-8'
);

interface GradeStudentParams {
  assignmentId: string;
  studentId: string;
  questionId: string;
  studentAnswer: string;
  rubric: Rubric;
  vectorStoreId: string;
  jobId?: string;
}

export async function gradeStudentAnswer({
  assignmentId,
  studentId,
  questionId,
  studentAnswer,
  rubric,
  vectorStoreId,
  jobId,
}: GradeStudentParams) {
  try {
    const messagePayload = {
      question_id: questionId,
      student_answer: studentAnswer,
      rubric: rubric,
      output_format: 'json',
    };

    // Single Responses API call replaces thread/message/run/poll flow
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      instructions: systemPrompt,
      input: JSON.stringify(messagePayload),
      tools: [
        {
          type: 'file_search' as const,
          vector_store_ids: [vectorStoreId],
        },
      ],
      store: false,
      text: {
        format: {
          type: 'json_object' as const,
        },
      },
    });

    let gradingResult: GradingResult | null = null;
    let totalTokens = 0;

    if (response.status === 'completed') {
      const rawResponse = response.output_text;
      try {
        // Clean up markdown code blocks if present
        const jsonString = rawResponse.replace(/```json\n?|```/g, '').trim();
        gradingResult = JSON.parse(jsonString) as GradingResult;
      } catch (e) {
        console.error('Failed to parse AI response:', rawResponse);
        gradingResult = {
          score: null,
          max_score: rubric.max_score,
          qualitative_grade: null,
          feedback: 'Error parsing AI response. Please review manually.',
          citations: [],
          confidence: 'low',
          rubric_alignment: {},
          language_detected: 'en',
          token_usage_estimate: 0,
        };
      }

      // Track token usage
      if (response.usage) {
        totalTokens = response.usage.total_tokens;
      }
    } else {
      console.error('Response failed:', response.status, response.error);
      gradingResult = {
        score: null,
        max_score: rubric.max_score,
        qualitative_grade: null,
        feedback: `Grading failed. Status: ${response.status}. Error: ${response.error?.message || 'Unknown'}`,
        citations: [],
        confidence: 'low',
        rubric_alignment: {},
        language_detected: 'en',
        token_usage_estimate: 0,
      };
    }

    // Save Result to DB2
    if (gradingResult) {
      await insertGradingResult({
        job_id: jobId,
        assignment_id: assignmentId,
        student_id: studentId,
        question_id: questionId,
        score: gradingResult.score,
        max_score: gradingResult.max_score,
        qualitative_grade: gradingResult.qualitative_grade,
        feedback: gradingResult.feedback,
        citations: gradingResult.citations,
        confidence: gradingResult.confidence,
        rubric_alignment: gradingResult.rubric_alignment,
        language_detected: gradingResult.language_detected,
      });
    }

    // Track Token Usage
    if (totalTokens > 0) {
      const cost = (totalTokens / 1000000) * 10;

      await insertTokenUsage({
        job_id: jobId,
        assignment_id: assignmentId,
        student_id: studentId,
        tokens_used: totalTokens,
        estimated_cost: cost,
      });
    }

    return gradingResult;
  } catch (error) {
    console.error('Fatal error in gradeStudentAnswer:', error);
    throw error;
  }
}
