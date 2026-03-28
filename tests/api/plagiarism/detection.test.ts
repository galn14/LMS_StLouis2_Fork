
import { detectPlagiarism } from '@/lib/plagiarism/detection';
import { queryLMS } from '@/lib/lms-db';
import { supabaseAdmin } from '@/lib/supabase/server';
import { generateEmbeddingsBatch } from '@/lib/plagiarism/embeddings';

// Mock dependencies
jest.mock('@/lib/lms-db', () => ({
  queryLMS: jest.fn(),
}));

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
  },
}));

jest.mock('@/lib/plagiarism/embeddings', () => ({
  generateEmbeddingsBatch: jest.fn(),
}));

describe('detectPlagiarism', () => {
  const mockQueryLMS = queryLMS as jest.Mock;
  const mockGenerateEmbeddingsBatch = generateEmbeddingsBatch as jest.Mock;
  const mockSupabase = supabaseAdmin;
  
  // Shared mocks for builder methods
  const mockInsert = jest.fn();
  const mockSelect = jest.fn();
  const mockUpdate = jest.fn();
  const mockEq = jest.fn();
  const mockSingle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockReturnThis();
    mockSelect.mockReturnThis();
    mockUpdate.mockReturnThis();
    mockEq.mockReturnThis();
    // Default single behavior
    mockSingle.mockResolvedValue({ data: { id: 'default-id' }, error: null });
  });

  const setupSupabaseMock = () => {
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
          // Reset specific behaviors based on table if needed, 
          // or just return the shared mocks.
          // For specific return values (like detection ID), we can control mockSingle based on call context 
          // but that's hard with shared mock.
          // Instead, let's make the shared mock return different values if needed?
          // Or just use the shared mocks for spying, and configure them per test.
          
          return {
              insert: mockInsert,
              select: mockSelect,
              update: mockUpdate,
              eq: mockEq,
              single: mockSingle,
              then: (resolve: any) => resolve({ data: { id: 'rec-1' }, error: null })
          };
      });
  };

  it('should run detection workflow successfully', async () => {
    setupSupabaseMock();

    // 1. Configure specific mock responses
    // For pds_detections insert().select().single() -> detection-123
    mockSingle.mockResolvedValueOnce({ data: { id: 'detection-123' }, error: null });
    
    // For pds_chunks insert().select() -> [{ id: 'chunk-1' }]
    // The code does: insert().select() -> returns promise with { data }
    // Our shared mockSelect returns 'this' (the builder). 
    // Wait, typical usage: await supabase.from().insert().select()
    // If select returns 'this', then 'await this' tries to resolve 'then'.
    // So we need 'then' on the builder.
    // But for chunks, we need array data.
    
    // Complex chaining: 
    // 1. Detections: insert().select().single() -> needs single() to return data.
    // 2. Chunks: insert().select() -> needs to be awaitable and return { data: [] }
    
    // Let's refine the builder to handle this.
    const builderProxy = {
        insert: mockInsert,
        select: mockSelect,
        update: mockUpdate,
        eq: mockEq,
        single: mockSingle,
        then: undefined as any // Placeholder
    };
    
    // We need dynamic behavior for 'then' or 'select' return
    // Since we reuse mocks, we can use mockImplementationOnce sequence?
    // It's getting complicated to mock the fluent API perfectly with shared mocks.
    // Alternative: Just assert on the shared mocks and don't worry about return values 
    // except where critical (detectionId).
    
    // Critical: 
    // 1. detection creation -> returns detectionId
    // 2. chunks insertion -> returns chunk IDs (needed for embedding)
    
    // Let's stick to the createMockBuilder approach but expose the spies.
    
  });
  
  // RE-REFACTOR: Use a closure to capture spies per test run
  
  it('should run detection workflow successfully', async () => {
      // Custom builder that uses the shared spies but allows custom returns
      const builder: any = {
          insert: mockInsert,
          select: mockSelect,
          update: mockUpdate,
          eq: mockEq,
          single: mockSingle,
      };
      // Make it thenable for simple awaits
      builder.then = (fn: any) => fn({ data: { id: 'rec-1' }, error: null });

      (mockSupabase.from as jest.Mock).mockImplementation((table) => {
          if (table === 'pds_detections') {
              // Special handling for initial create
              return {
                  ...builder,
                  single: jest.fn().mockResolvedValue({ data: { id: 'detection-123' }, error: null })
              };
          }
          if (table === 'pds_chunks') {
              return {
                  ...builder,
                  select: jest.fn().mockResolvedValue({ data: [{ id: 'chunk-1', chunk_index: 0 }], error: null })
              };
          }
          return builder;
      });

      // 2. Mock LMS Query
      mockQueryLMS.mockResolvedValue([
        { submission_id: 'sub-1', student_id: 'student-A', content: 'Apple banana cherry.' },
        { submission_id: 'sub-2', student_id: 'student-B', content: 'Apple banana cherry.' }, // Identical
      ]);
  
      // 3. Mock Embeddings
      mockGenerateEmbeddingsBatch.mockResolvedValue({
        vectors: [[0.1, 0.2, 0.3]], // Simplified vector
        totalTokens: 10
      });

      const result = await detectPlagiarism('101', 'teacher-1');

      expect(result.success).toBe(true);
      expect(result.detectionId).toBe('detection-123');
      expect(mockQueryLMS).toHaveBeenCalled();
      
      // Verify Insertions
      expect(mockInsert).toHaveBeenCalled(); // Should be called for embeddings, comparisons...
      
      // Verify specific calls (harder with shared mock, but we know it passed)
      // We can check arguments of the calls
      const insertCalls = mockInsert.mock.calls;
      // Should have comparisons
      const hasComparisons = insertCalls.some(call => Array.isArray(call[0]) && call[0][0]?.source_submission_id);
      expect(hasComparisons).toBe(true);
  });

  it('should handle errors gracefully', async () => {
      // Setup builder for this test
      const builder: any = {
          insert: mockInsert,
          select: mockSelect,
          update: mockUpdate,
          eq: mockEq,
          single: mockSingle,
      };
      
      (mockSupabase.from as jest.Mock).mockImplementation((table) => {
          if (table === 'pds_detections') {
              return {
                  ...builder,
                  single: jest.fn().mockResolvedValue({ data: { id: 'detection-123' }, error: null })
              };
          }
          return builder;
      });

      mockQueryLMS.mockRejectedValue(new Error('DB Connection Failed'));
  
      await expect(detectPlagiarism('101', 'teacher-1')).rejects.toThrow('DB Connection Failed');
  
      // Now we can check mockUpdate
      expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'failed', error_message: 'DB Connection Failed' })
      );
      // And ensure it was scoped to the detection ID
      expect(mockEq).toHaveBeenCalledWith('id', 'detection-123');
  });
});
