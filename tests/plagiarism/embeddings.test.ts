
import { generateEmbedding, generateEmbeddingsBatch } from '@/lib/plagiarism/embeddings';
import { getOpenAI } from '@/lib/openai';

const mockEmbeddingsCreate = jest.fn();

jest.mock('@/lib/openai', () => ({
  getOpenAI: jest.fn(),
}));

(getOpenAI as jest.Mock).mockResolvedValue({
  embeddings: { create: mockEmbeddingsCreate },
});

describe('generateEmbedding', () => {
  const mockCreate = mockEmbeddingsCreate;

  beforeEach(() => {
    mockCreate.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should generate an embedding successfully', async () => {
    const mockResponse = {
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      usage: { total_tokens: 10 },
    };
    mockCreate.mockResolvedValue(mockResponse);

    const result = await generateEmbedding('test text');

    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
    expect(result.tokenCount).toBe(10);
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'test text',
      encoding_format: 'float',
      dimensions: 384,
    });
  });

  it('should replace newlines with spaces', async () => {
      const mockResponse = {
        data: [{ embedding: [0.1], index: 0 }],
        usage: { total_tokens: 5 },
      };
      mockCreate.mockResolvedValue(mockResponse);

      await generateEmbedding('Line 1\nLine 2');

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
          input: 'Line 1 Line 2'
      }));
  });

  it('should retry on 429 rate limit error', async () => {
    const successResponse = {
      data: [{ embedding: [0.1], index: 0 }],
      usage: { total_tokens: 5 },
    };

    mockCreate
      .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
      .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
      .mockResolvedValue(successResponse);

    const promise = generateEmbedding('retry test');

    await jest.advanceTimersByTimeAsync(1000); 
    await jest.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result.vector).toEqual([0.1]);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('should throw error after max retries', async () => {
      mockCreate.mockRejectedValue({ status: 500, message: 'Server error' });

      const promise = generateEmbedding('fail test');
      promise.catch(() => {});

      // 1000, 2000, 4000, 8000, 16000
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);
      await jest.advanceTimersByTimeAsync(8000);
      await jest.advanceTimersByTimeAsync(16000);

      await expect(promise).rejects.toThrow(/Failed to generate embedding after 5 attempts/);
      expect(mockCreate).toHaveBeenCalledTimes(5);
  });

  it('should throw immediately on 400 bad request', async () => {
      mockCreate.mockRejectedValue({ status: 400, message: 'Bad Request' });

      await expect(generateEmbedding('bad request')).rejects.toEqual(
          expect.objectContaining({ status: 400, message: 'Bad Request' })
      );
      expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('generateEmbeddingsBatch', () => {
    const mockCreate = mockEmbeddingsCreate;

    beforeEach(() => {
        mockCreate.mockClear();
        jest.useFakeTimers();
    });
    
    afterEach(() => {
        jest.useRealTimers();
    });

    it('should generate batch embeddings successfully', async () => {
        const mockResponse = {
            data: [
                { embedding: [0.1], index: 0 },
                { embedding: [0.2], index: 1 }
            ],
            usage: { total_tokens: 20 },
        };
        mockCreate.mockResolvedValue(mockResponse);

        const texts = ['text 1', 'text 2'];
        const result = await generateEmbeddingsBatch(texts);

        expect(result.vectors).toEqual([[0.1], [0.2]]);
        expect(result.totalTokens).toBe(20);
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            input: ['text 1', 'text 2']
        }));
    });

    it('should sort results by index', async () => {
        // Simulate out-of-order response
        const mockResponse = {
            data: [
                { embedding: [0.2], index: 1 },
                { embedding: [0.1], index: 0 }
            ],
            usage: { total_tokens: 20 },
        };
        mockCreate.mockResolvedValue(mockResponse);

        const texts = ['text 1', 'text 2'];
        const result = await generateEmbeddingsBatch(texts);

        expect(result.vectors[0]).toEqual([0.1]); // Index 0
        expect(result.vectors[1]).toEqual([0.2]); // Index 1
    });
});

import { storeEmbedding } from '@/lib/plagiarism/embeddings';
import { insertEmbedding } from '@/lib/db2/pds-repo';

jest.mock('@/lib/db2/pds-repo', () => ({
  insertEmbedding: jest.fn(),
}));

describe('storeEmbedding', () => {
  const mockInsertEmbedding = insertEmbedding as jest.Mock;

  beforeEach(() => {
    mockInsertEmbedding.mockClear();
    mockInsertEmbedding.mockResolvedValue(undefined);
  });

  it('should store embedding successfully', async () => {
    await storeEmbedding('chunk-123', [0.1, 0.2, 0.3]);

    expect(mockInsertEmbedding).toHaveBeenCalledWith(
      'chunk-123',
      [0.1, 0.2, 0.3],
      'text-embedding-3-small'
    );
  });

  it('should throw error on DB2 failure', async () => {
    mockInsertEmbedding.mockRejectedValue(new Error('Database error'));

    await expect(storeEmbedding('chunk-123', [0.1])).rejects.toThrow('Failed to store embedding for chunk chunk-123: Database error');
  });
});
