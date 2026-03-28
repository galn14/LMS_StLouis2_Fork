
import { detectPlagiarism } from '@/lib/plagiarism/detection';
import { queryLMS } from '@/lib/lms-db';
import { generateEmbeddingsBatch } from '@/lib/plagiarism/embeddings';
import {
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

describe('detectPlagiarism', () => {
  const mockQueryLMS = queryLMS as jest.Mock;
  const mockGenerateEmbeddingsBatch = generateEmbeddingsBatch as jest.Mock;
  const mockCreateDetection = createDetection as jest.Mock;
  const mockUpdateDetection = updateDetection as jest.Mock;
  const mockInsertChunksReturningIds = insertChunksReturningIds as jest.Mock;
  const mockInsertEmbeddings = insertEmbeddings as jest.Mock;
  const mockInsertComparisons = insertComparisons as jest.Mock;
  const mockInsertFlags = insertFlags as jest.Mock;
  const mockInsertAuditLog = insertAuditLog as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDetection.mockResolvedValue({ id: 'detection-123' });
    mockUpdateDetection.mockResolvedValue(undefined);
    mockInsertChunksReturningIds.mockResolvedValue([{ id: 'chunk-1', chunk_index: 0 }]);
    mockInsertEmbeddings.mockResolvedValue(undefined);
    mockInsertComparisons.mockResolvedValue(undefined);
    mockInsertFlags.mockResolvedValue(undefined);
    mockInsertAuditLog.mockResolvedValue(undefined);
  });
  
  it('should run detection workflow successfully', async () => {
    mockQueryLMS.mockResolvedValue([
      { submission_id: 'sub-1', student_id: 'student-A', content: 'Apple banana cherry.' },
      { submission_id: 'sub-2', student_id: 'student-B', content: 'Apple banana cherry.' },
    ]);

    mockGenerateEmbeddingsBatch.mockResolvedValue({
      vectors: [[0.1, 0.2, 0.3]],
      totalTokens: 10,
    });

    const result = await detectPlagiarism('101', 'teacher-1');

    expect(result.success).toBe(true);
    expect(result.detectionId).toBe('detection-123');
    expect(mockCreateDetection).toHaveBeenCalledWith({
      assignment_id: '101',
      status: 'processing',
      created_by: 'teacher-1',
    });
    expect(mockQueryLMS).toHaveBeenCalled();
    expect(mockInsertEmbeddings).toHaveBeenCalled();
    expect(mockInsertComparisons).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          source_submission_id: 'sub-1',
          target_submission_id: 'sub-2',
        }),
      ])
    );
    expect(mockInsertFlags).toHaveBeenCalled();
    expect(mockInsertAuditLog).toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    mockQueryLMS.mockRejectedValue(new Error('DB Connection Failed'));

    await expect(detectPlagiarism('101', 'teacher-1')).rejects.toThrow('DB Connection Failed');

    expect(mockUpdateDetection).toHaveBeenCalledWith('detection-123', {
      status: 'failed',
      error_message: 'DB Connection Failed',
    });
  });
});
