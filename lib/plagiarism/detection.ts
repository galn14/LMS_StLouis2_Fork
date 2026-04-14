
import { queryLMS } from '@/lib/lms-db';
import { chunkText } from '@/lib/plagiarism/text-processor';
import { generateEmbeddingsBatch } from '@/lib/plagiarism/embeddings';
import {
  cleanupPreviousDetectionData,
  createDetection,
  insertAuditLog,
  insertChunksReturningIds,
  insertComparisons,
  insertEmbeddings,
  insertFlags,
  updateDetection,
  findSimilarChunksLateral,
  SimilarChunkMatch
} from '@/lib/db2/pds-repo';
import {
  calculateCosineSimilarity,
  calculateJaccardSimilarity,
  calculateCombinedScore,
  calculateRiskLevel,
  SIMILARITY_THRESHOLDS,
  BM25Stats,
  calculateBM25CorpusStats,
  calculateBM25Similarity
} from '@/lib/plagiarism/similarity';

// Minimum cosine similarity to show a chunk pair in the evidence panel.
// This is a DISPLAY threshold — it does NOT affect scoring.
const EVIDENCE_DISPLAY_THRESHOLD = 0.5;

interface ChunkData {
  id?: string;
  content: string;
  chunk_index: number;
  question_index: number;
  start_char: number;
  end_char: number;
  token_count: number;
  embedding?: number[];
}

interface SubmissionData {
  submission_id: string;
  student_id: string;
  content: string;
  chunks?: ChunkData[];
  answerTexts?: Map<number, string>;  // question_index → raw answer text for per-Q Jaccard
}

interface ProcessingSubmission extends SubmissionData {
  answers: AnswerItem[];
}

interface AnswerItem {
  question_id: string;
  text: string;
}

interface QuestionAnswerRow {
  submission_id: string;
  student_id: string;
  question_id: string;
  answer_text: string;
}

interface PerQuestionScore {
  question_index: number;
  semantic_score: number;
  lexical_score: number;
  combined_score: number;
}

interface PairScoreResult {
  combinedScore: number;
  semanticScore: number;
  lexicalScore: number;
  perQuestionScores: PerQuestionScore[];
  matchedChunksData: any[];
}

/**
 * Creates a detection record and returns the ID immediately.
 */
export async function initDetection(
  assignmentId: string,
  userId: string,
  questionIds: string[] = []
) {
  const scanned_question_ids = questionIds.length === 0 ? ['all'] : questionIds;
  const detectionData = await createDetection({
    assignment_id: assignmentId,
    status: 'processing',
    created_by: userId,
    scanned_question_ids,
  });

  return detectionData.id;
}

/**
 * Runs the full plagiarism detection pipeline.
 *
 * Scoring design:
 * - Each question is scored INDEPENDENTLY: semantic (cosine) + lexical (Jaccard)
 *   are computed per-question, then combined per-question.
 * - The overall score = average of per-question combined scores.
 * - The semantic score uses RAW cosine similarity — no hard threshold gate.
 *   A separate (lower) display threshold controls which chunks appear in evidence.
 * - This means even moderate similarity (e.g. 0.65 cosine) contributes to the
 *   score instead of being silently zeroed out.
 */
export async function processDetection(
  detectionId: string,
  assignmentId: string,
  userId: string,
  questionIds: string[] = []
) {
  try {
    const numericAssignmentId = parseInt(assignmentId, 10);
    if (isNaN(numericAssignmentId)) throw new Error('Invalid Assignment ID format');

    const params: unknown[] = [numericAssignmentId];
    let questionFilter = '';
    if (questionIds.length > 0) {
      const numericIds = questionIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
      if (numericIds.length > 0) {
        params.push(numericIds);
        questionFilter = `AND q.id = ANY($${params.length}::int[])`;
      }
    }

    const sql = `
      SELECT
        s.id::text        AS submission_id,
        s.student_id::text AS student_id,
        q.id::text        AS question_id,
        a.answer_text
      FROM assignment_submissions s
      JOIN assignment_answers   a ON s.id = a.submission_id
      JOIN assignment_questions q ON a.question_id = q.id
      JOIN enumeration          e ON q.question_type_id = e.id
      WHERE s.assignment_id = $1
        AND a.answer_text IS NOT NULL
        AND a.answer_text <> ''
        AND UPPER(e.name) IN ('ESSAY', 'FILE_UPLOAD')
        ${questionFilter}
      ORDER BY s.id, q.order_number
    `;

    const rows = await queryLMS<QuestionAnswerRow>(sql, params);

    // Stable question_id → question_index mapping
    const questionOrderMap = new Map<string, number>();
    for (const row of rows) {
      if (!questionOrderMap.has(row.question_id)) {
        questionOrderMap.set(row.question_id, questionOrderMap.size);
      }
    }

    // Group rows by submission_id
    const submissionMap = new Map<
      string,
      { student_id: string; answers: AnswerItem[] }
    >();

    for (const row of rows) {
      if (!submissionMap.has(row.submission_id)) {
        submissionMap.set(row.submission_id, { student_id: row.student_id, answers: [] });
      }
      submissionMap.get(row.submission_id)!.answers.push({
        question_id: row.question_id,
        text: row.answer_text,
      });
    }

    const submissions: ProcessingSubmission[] = [];
    for (const [submissionId, sub] of submissionMap) {
      const fullContent = sub.answers.map(a => a.text).join('\n\n');
      if (fullContent.length > 50) {
        submissions.push({
          submission_id: submissionId,
          student_id: sub.student_id,
          content: fullContent,
          chunks: [],
          answers: sub.answers,
        });
      }
    }

    await updateDetection(detectionId, { total_submissions: submissions.length });
    console.log(`[PDS] Processing ${submissions.length} submissions for assignment ${assignmentId}`);

    const submissionIds = submissions.map(s => s.submission_id);
    await cleanupPreviousDetectionData(submissionIds);

    // Process each submission: chunk per-question, embed, store
    const processedSubmissions: SubmissionData[] = [];
    let processedCount = 0;

    for (const sub of submissions) {
      const questionAnswers = sub.answers;
      if (questionAnswers.length === 0) continue;

      const chunksForDb: {
        submission_id: string;
        content: string;
        chunk_index: number;
        question_index: number;
        start_char: number;
        end_char: number;
        token_count: number;
      }[] = [];
      const allChunkTexts: string[] = [];
      let globalChunkIndex = 0;

      // Build per-question answer text map for Jaccard scoring
      const answerTextsMap = new Map<number, string>();

      for (const answer of questionAnswers) {
        const qIdx = questionOrderMap.get(answer.question_id) ?? 0;
        answerTextsMap.set(qIdx, answer.text);

        const questionChunks = chunkText(answer.text);
        for (const c of questionChunks) {
          chunksForDb.push({
            submission_id: sub.submission_id,
            content: c.content,
            chunk_index: globalChunkIndex,
            question_index: qIdx,
            start_char: c.start_char,
            end_char: c.end_char,
            token_count: c.token_count,
          });
          allChunkTexts.push(c.content);
          globalChunkIndex++;
        }
      }

      if (chunksForDb.length === 0) continue;

      const insertedChunks = await insertChunksReturningIds(chunksForDb);
      const chunksWithIds = chunksForDb.map(c => {
        const dbChunk = insertedChunks.find(ic => ic.chunk_index === c.chunk_index);
        if (!dbChunk?.id) {
          throw new Error(`Failed to map chunk index ${c.chunk_index} to a DB row`);
        }
        return { ...c, id: dbChunk.id };
      });

      const { vectors } = await generateEmbeddingsBatch(allChunkTexts);

      await insertEmbeddings(
        chunksWithIds.map((c, idx) => ({
          chunk_id: c.id,
          vector: vectors[idx],
          model: 'text-embedding-3-small',
        }))
      );

      processedSubmissions.push({
        submission_id: sub.submission_id,
        student_id: sub.student_id,
        content: sub.content,
        chunks: chunksWithIds.map((c, idx) => ({ ...c, embedding: vectors[idx] })),
        answerTexts: answerTextsMap,
      });

      processedCount++;
      if (processedCount % 5 === 0) {
        await updateDetection(detectionId, { processed_submissions: processedCount });
      }
    }

    // Comparison Phase — every unique pair (i < j)
    const processedSubmissionIds = processedSubmissions.map(s => s.submission_id);
    const dbMatches = await findSimilarChunksLateral(processedSubmissionIds, 10);
    
    // Group dbMatches by submission pair for fast lookup
    const pairMatches = new Map<string, SimilarChunkMatch[]>();
    for (const m of dbMatches) {
       const id1 = m.source_submission_id < m.target_submission_id ? m.source_submission_id : m.target_submission_id;
       const id2 = m.source_submission_id < m.target_submission_id ? m.target_submission_id : m.source_submission_id;
       const key = `${id1}:${id2}`;
       if (!pairMatches.has(key)) pairMatches.set(key, []);
       pairMatches.get(key)!.push(m);
    }
    
    // Pre-calculate BM25 corpus stats per question
    const corpusStatsPerQuestion = new Map<number, BM25Stats>();
    const allQIndices = new Set<number>();
    for (const sub of processedSubmissions) {
      if (sub.answerTexts) {
        for (const qIdx of sub.answerTexts.keys()) allQIndices.add(qIdx);
      }
    }
    for (const qi of allQIndices) {
      const textsForQ: string[] = [];
      for (const sub of processedSubmissions) {
        if (sub.answerTexts?.has(qi)) textsForQ.push(sub.answerTexts.get(qi)!);
      }
      corpusStatsPerQuestion.set(qi, calculateBM25CorpusStats(textsForQ));
    }

    const comparisons = [];
    const flags = [];

    for (let i = 0; i < processedSubmissions.length; i++) {
      for (let j = i + 1; j < processedSubmissions.length; j++) {
        const subA = processedSubmissions[i];
        const subB = processedSubmissions[j];

        if (subA.student_id === subB.student_id) continue;

        const key = subA.submission_id < subB.submission_id 
          ? `${subA.submission_id}:${subB.submission_id}` 
          : `${subB.submission_id}:${subA.submission_id}`;
          
        const matchesForPair = pairMatches.get(key) ?? [];

        const result = calculatePairScores(subA, subB, matchesForPair, corpusStatsPerQuestion);
        const riskLevel = calculateRiskLevel(result.combinedScore);

        if (result.combinedScore >= SIMILARITY_THRESHOLDS.LOW) {
          const comparisonId = crypto.randomUUID();
          comparisons.push({
            id: comparisonId,
            source_submission_id: subA.submission_id,
            target_submission_id: subB.submission_id,
            semantic_score: result.semanticScore,
            lexical_score: result.lexicalScore,
            combined_score: result.combinedScore,
            risk_level: riskLevel,
            matched_chunks: {
              chunks: result.matchedChunksData,
              per_question_scores: result.perQuestionScores,
            },
            compared_at: new Date().toISOString(),
          });

          flags.push({ comparison_id: comparisonId, submission_id: subA.submission_id, status: 'pending', is_false_positive: false });
          flags.push({ comparison_id: comparisonId, submission_id: subB.submission_id, status: 'pending', is_false_positive: false });
        }
      }
    }

    if (comparisons.length > 0) await insertComparisons(comparisons);
    if (flags.length > 0) await insertFlags(flags);

    await updateDetection(detectionId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      processed_submissions: processedCount,
    });

    await insertAuditLog({
      user_id: userId,
      action: 'run_detection',
      entity_type: 'detection',
      entity_id: detectionId,
      metadata: { assignment_id: assignmentId, matches_found: comparisons.length },
    });

  } catch (error: any) {
    console.error('[PDS] Detection failed:', error);
    await updateDetection(detectionId, {
      status: 'failed',
      error_message: error.message,
    });
  }
}

/**
 * Per-question pair scoring.
 *
 * For each shared question:
 * 1. Semantic: raw best-match cosine (NO hard threshold gate).
 *    The cosine similarity always contributes to the score, even at 0.5–0.7.
 * 2. Lexical: Jaccard on per-question answer text (not the full concatenated text).
 * 3. Combined: 0.7×semantic + 0.3×lexical, per question.
 *
 * Overall = average of per-question combined scores.
 *
 * Evidence chunks use a separate DISPLAY threshold (0.5) that only controls
 * which chunks appear in the side-by-side panel — it never affects scoring.
 */
function calculatePairScores(
  subA: SubmissionData,
  subB: SubmissionData,
  matchesForPair: SimilarChunkMatch[],
  corpusStatsPerQuestion: Map<number, BM25Stats>
): PairScoreResult {
  const chunksA = subA.chunks ?? [];
  const chunksB = subB.chunks ?? [];
  const matchedChunksData: any[] = [];
  const perQuestionScores: PerQuestionScore[] = [];

  if (chunksA.length === 0 || chunksB.length === 0) {
    return { combinedScore: 0, semanticScore: 0, lexicalScore: 0, perQuestionScores: [], matchedChunksData: [] };
  }

  // Group chunks by question_index
  const groupA = new Map<number, ChunkData[]>();
  const groupB = new Map<number, ChunkData[]>();
  for (const c of chunksA) {
    if (!groupA.has(c.question_index)) groupA.set(c.question_index, []);
    groupA.get(c.question_index)!.push(c);
  }
  for (const c of chunksB) {
    if (!groupB.has(c.question_index)) groupB.set(c.question_index, []);
    groupB.get(c.question_index)!.push(c);
  }

  const allQIs = new Set([...groupA.keys(), ...groupB.keys()]);
  let totalSemanticSum = 0;
  let totalLexicalSum = 0;
  let totalCombinedSum = 0;
  let totalQuestions = 0;

  for (const qi of allQIs) {
    const qChunksA = groupA.get(qi) ?? [];
    const qChunksB = groupB.get(qi) ?? [];
    if (qChunksA.length === 0 || qChunksB.length === 0) continue;

    totalQuestions++;

    // ── Semantic: raw cosine best-matches, NO gate ──
    let sumBestCosine = 0;
    const evidenceMap = new Map<string, any>();

    const tryRegisterEvidence = (simScore: number, sourceId: string, targetId: string, sourceText: string, targetText: string) => {
      if (simScore <= EVIDENCE_DISPLAY_THRESHOLD) return;
      const key = `${sourceId}:${targetId}`;
      const existing = evidenceMap.get(key);
      if (!existing || simScore > existing.similarity) {
        evidenceMap.set(key, {
          similarity: simScore,
          sourceText,
          targetText,
          sourceChunkId: sourceId,
          targetChunkId: targetId,
        });
      }
    };

    const aToBMatches = matchesForPair.filter(m => m.source_submission_id === subA.submission_id && m.target_submission_id === subB.submission_id && m.question_index === qi);
    const bToAMatches = matchesForPair.filter(m => m.source_submission_id === subB.submission_id && m.target_submission_id === subA.submission_id && m.question_index === qi);

    for (const cA of qChunksA) {
      const m = aToBMatches.find(x => x.source_chunk_id === cA.id);
      if (m) {
        sumBestCosine += m.similarity;
        tryRegisterEvidence(m.similarity, cA.id!, m.target_chunk_id, cA.content, m.target_content);
      }
    }

    for (const cB of qChunksB) {
      const m = bToAMatches.find(x => x.source_chunk_id === cB.id);
      if (m) {
        tryRegisterEvidence(m.similarity, m.target_chunk_id, cB.id!, m.target_content, cB.content);
      }
    }

    const semanticQ = sumBestCosine / Math.max(qChunksA.length, qChunksB.length);

    // ── Lexical: BM25 on per-question answer text ──
    const textA = subA.answerTexts?.get(qi) ?? '';
    const textB = subB.answerTexts?.get(qi) ?? '';
    const stats = corpusStatsPerQuestion.get(qi);
    const lexicalQ = stats ? calculateBM25Similarity(textA, textB, stats) : 0;

    // ── Combined per-question ──
    const combinedQ = calculateCombinedScore(semanticQ, lexicalQ);

    perQuestionScores.push({
      question_index: qi,
      semantic_score: Math.round(semanticQ * 10000) / 10000,
      lexical_score: Math.round(lexicalQ * 10000) / 10000,
      combined_score: Math.round(combinedQ * 10000) / 10000,
    });

    totalSemanticSum += semanticQ;
    totalLexicalSum += lexicalQ;
    totalCombinedSum += combinedQ;

    for (const [, m] of evidenceMap) {
      matchedChunksData.push({
        source_chunk_id: m.sourceChunkId,
        target_chunk_id: m.targetChunkId,
        similarity: m.similarity,
        source_text: m.sourceText,
        target_text: m.targetText,
        question_index: qi,
      });
    }
  }

  const semanticScore = totalQuestions > 0 ? totalSemanticSum / totalQuestions : 0;
  const lexicalScore = totalQuestions > 0 ? totalLexicalSum / totalQuestions : 0;
  const combinedScore = totalQuestions > 0 ? totalCombinedSum / totalQuestions : 0;

  return { combinedScore, semanticScore, lexicalScore, perQuestionScores, matchedChunksData };
}
