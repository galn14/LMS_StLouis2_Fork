
import { initDetection, processDetection } from '@/lib/plagiarism/detection';
import { queryLMS } from '@/lib/lms-db';
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
} from '@/lib/db2/pds-repo';

// Mock dependencies
jest.mock('@/lib/lms-db', () => ({
  queryLMS: jest.fn(),
}));

jest.mock('@/lib/db2/pds-repo', () => ({
  cleanupPreviousDetectionData: jest.fn(),
  createDetection: jest.fn(),
  updateDetection: jest.fn(),
  insertChunksReturningIds: jest.fn(),
  insertEmbeddings: jest.fn(),
  insertComparisons: jest.fn(),
  insertFlags: jest.fn(),
  insertAuditLog: jest.fn(),
}));

jest.mock('@/lib/plagiarism/embeddings', () => ({
  generateEmbeddingsBatch: jest.fn(),
}));

describe('plagiarism detection', () => {
  const mockQueryLMS = queryLMS as jest.Mock;
  const mockGenerateEmbeddingsBatch = generateEmbeddingsBatch as jest.Mock;
  const mockCreateDetection = createDetection as jest.Mock;
  const mockUpdateDetection = updateDetection as jest.Mock;
  const mockCleanup = cleanupPreviousDetectionData as jest.Mock;
  const mockInsertChunksReturningIds = insertChunksReturningIds as jest.Mock;
  const mockInsertEmbeddings = insertEmbeddings as jest.Mock;
  const mockInsertComparisons = insertComparisons as jest.Mock;
  const mockInsertFlags = insertFlags as jest.Mock;
  const mockInsertAuditLog = insertAuditLog as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDetection.mockResolvedValue({ id: 'detection-123' });
    mockUpdateDetection.mockResolvedValue(undefined);
    mockCleanup.mockResolvedValue(undefined);
    mockInsertChunksReturningIds.mockImplementation((chunks) =>
      Promise.resolve(chunks.map((c: any) => ({ id: `chunk-${c.chunk_index}`, chunk_index: c.chunk_index })))
    );
    mockInsertEmbeddings.mockResolvedValue(undefined);
    mockInsertComparisons.mockResolvedValue(undefined);
    mockInsertFlags.mockResolvedValue(undefined);
    mockInsertAuditLog.mockResolvedValue(undefined);
  });

  describe('initDetection', () => {
    it('should create a detection record with all-questions scope and return the ID', async () => {
      const detectionId = await initDetection('101', 'teacher-1');

      expect(detectionId).toBe('detection-123');
      expect(mockCreateDetection).toHaveBeenCalledWith({
        assignment_id: '101',
        status: 'processing',
        created_by: 'teacher-1',
        scanned_question_ids: ['all'],
      });
    });

    it('should store specific question IDs when provided', async () => {
      await initDetection('101', 'teacher-1', ['42', '57']);

      expect(mockCreateDetection).toHaveBeenCalledWith({
        assignment_id: '101',
        status: 'processing',
        created_by: 'teacher-1',
        scanned_question_ids: ['42', '57'],
      });
    });
  });

  describe('processDetection', () => {
    it('should run detection with per-question scoring and store per_question_scores', async () => {
      // One row per (submission, question) with question_id
      mockQueryLMS.mockResolvedValue([
        { submission_id: 'sub-1', student_id: 'student-A', question_id: 'q-1', answer_text: 'Apple banana cherry is a fruit.' },
        { submission_id: 'sub-1', student_id: 'student-A', question_id: 'q-2', answer_text: 'Second essay answer here.' },
        { submission_id: 'sub-2', student_id: 'student-B', question_id: 'q-1', answer_text: 'Apple banana cherry is a fruit.' },
        { submission_id: 'sub-2', student_id: 'student-B', question_id: 'q-2', answer_text: 'Second essay answer here.' },
      ]);

      // Identical vectors → cosine = 1.0 per question
      mockGenerateEmbeddingsBatch.mockResolvedValue({
        vectors: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        totalTokens: 20,
      });

      await processDetection('detection-123', '101', 'teacher-1');

      expect(mockCleanup).toHaveBeenCalledWith(['sub-1', 'sub-2']);
      expect(mockQueryLMS).toHaveBeenCalled();
      expect(mockInsertEmbeddings).toHaveBeenCalled();

      // Verify comparison was created with the new matched_chunks format
      expect(mockInsertComparisons).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            source_submission_id: 'sub-1',
            target_submission_id: 'sub-2',
            // matched_chunks is now { chunks: [...], per_question_scores: [...] }
            matched_chunks: expect.objectContaining({
              per_question_scores: expect.arrayContaining([
                expect.objectContaining({ question_index: 0 }),
                expect.objectContaining({ question_index: 1 }),
              ]),
            }),
          }),
        ])
      );

      expect(mockInsertFlags).toHaveBeenCalled();
      expect(mockInsertAuditLog).toHaveBeenCalled();
      expect(mockUpdateDetection).toHaveBeenCalledWith('detection-123', expect.objectContaining({
        status: 'completed',
      }));
    });

    it('should detect similarity even with moderate cosine (no 0.7 hard gate)', async () => {
      // Simulate two students with somewhat different embeddings (cosine ~0.65)
      // that share most of their text (high Jaccard)
      mockQueryLMS.mockResolvedValue([
        { submission_id: 'sub-1', student_id: 'student-A', question_id: 'q-1', answer_text: 'Model bahasa tidak menggunakan kata sebagai unit pemrosesan karena dua masalah utama.' },
        { submission_id: 'sub-2', student_id: 'student-B', question_id: 'q-1', answer_text: 'Model bahasa tidak menggunakan kata sebagai unit pemrosesan karena dua masalah utama.' },
      ]);

      // Vectors that give moderate cosine similarity (~0.65)
      // vec1 = [1, 0, 0], vec2 = [0.65, 0.76, 0] → cosine ≈ 0.65
      mockGenerateEmbeddingsBatch
        .mockResolvedValueOnce({ vectors: [[1, 0, 0]], totalTokens: 10 })
        .mockResolvedValueOnce({ vectors: [[0.65, 0.76, 0]], totalTokens: 10 });

      await processDetection('detection-123', '101', 'teacher-1');

      // With the old 0.7 gate, this would NOT create a comparison (semantic=0, combined=0.3*jaccard<0.4)
      // With the fix, semantic=0.65, combined = 0.7*0.65 + 0.3*1.0 = 0.755 → flagged as MEDIUM+
      expect(mockInsertComparisons).toHaveBeenCalled();
      const comparisonArg = mockInsertComparisons.mock.calls[0][0][0];
      expect(comparisonArg.combined_score).toBeGreaterThan(0.4);
    });

    it('should handle errors gracefully and mark detection as failed', async () => {
      mockQueryLMS.mockRejectedValue(new Error('DB Connection Failed'));

      await processDetection('detection-123', '101', 'teacher-1');

      expect(mockUpdateDetection).toHaveBeenCalledWith('detection-123', {
        status: 'failed',
        error_message: 'DB Connection Failed',
      });
    });
  });
});
