
import { 
  calculateCosineSimilarity, 
  calculateJaccardSimilarity, 
  calculateCombinedScore, 
  calculateRiskLevel,
  tokenizeForJaccard
} from '@/lib/plagiarism/similarity';

describe('Similarity Calculations', () => {

  describe('Cosine Similarity', () => {
    it('should calculate cosine similarity correctly for identical vectors', () => {
      const vecA = [1, 2, 3];
      const vecB = [1, 2, 3];
      // Dot: 1+4+9=14. NormSq: 14. Norm: sqrt(14). Denom: 14. Result: 1.
      expect(calculateCosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
    });

    it('should calculate cosine similarity for orthogonal vectors', () => {
      const vecA = [1, 0];
      const vecB = [0, 1];
      // Dot: 0. Result: 0.
      expect(calculateCosineSimilarity(vecA, vecB)).toBeCloseTo(0.0);
    });

    it('should calculate cosine similarity for opposite vectors', () => {
      const vecA = [1, 2];
      const vecB = [-1, -2];
      // Dot: -1 -4 = -5. NormA: sqrt(5). NormB: sqrt(5). Denom: 5. Result: -1.
      expect(calculateCosineSimilarity(vecA, vecB)).toBeCloseTo(-1.0);
    });

    it('should handle zero vectors gracefully', () => {
      const vecA = [0, 0];
      const vecB = [1, 1];
      expect(calculateCosineSimilarity(vecA, vecB)).toBe(0);
    });

    it('should throw error for mismatched dimensions', () => {
      expect(() => calculateCosineSimilarity([1], [1, 2])).toThrow();
    });
  });

  describe('Jaccard Similarity', () => {
    it('should calculate Jaccard similarity correctly', () => {
      const textA = "apple banana cherry";
      const textB = "banana cherry date";
      expect(calculateJaccardSimilarity(textA, textB)).toBe(0.5);
    });

    it('should handle identical texts', () => {
      const text = "apple banana cherry";
      expect(calculateJaccardSimilarity(text, text)).toBe(1.0);
    });

    it('should handle completely different texts', () => {
      const textA = "apple banana";
      const textB = "cherry date";
      expect(calculateJaccardSimilarity(textA, textB)).toBe(0.0);
    });

    it('should filter stopwords and short words', () => {
      const textA = "the is at on in a an"; 
      const textB = "different text";
      expect(tokenizeForJaccard(textA).size).toBe(0);
      expect(calculateJaccardSimilarity(textA, textB)).toBe(0);
    });

    it('should filter Indonesian stopwords', () => {
      const textA = "saya adalah yang di dan itu";
      const textB = "teks berbeda";
      expect(tokenizeForJaccard(textA).size).toBe(0);
      expect(calculateJaccardSimilarity(textA, textB)).toBe(0);
    });
    
    it('should be case insensitive and ignore punctuation', () => {
      const textA = "Apple, Banana!";
      const textB = "apple banana";
      expect(calculateJaccardSimilarity(textA, textB)).toBe(1.0);
    });
  });

  describe('Combined Score & Risk Level', () => {
    it('should calculate combined score with correct weights', () => {
      // 0.7 * 1.0 + 0.3 * 0.0 = 0.7
      expect(calculateCombinedScore(1.0, 0.0)).toBeCloseTo(0.7);
      // 0.7 * 0.5 + 0.3 * 0.5 = 0.5
      expect(calculateCombinedScore(0.5, 0.5)).toBeCloseTo(0.5);
    });

    it('should assign correct risk levels', () => {
      expect(calculateRiskLevel(0.85)).toBe('HIGH');
      expect(calculateRiskLevel(0.80)).toBe('HIGH');
      
      expect(calculateRiskLevel(0.79)).toBe('MEDIUM');
      expect(calculateRiskLevel(0.60)).toBe('MEDIUM');

      expect(calculateRiskLevel(0.59)).toBe('LOW');
      expect(calculateRiskLevel(0.40)).toBe('LOW');

      expect(calculateRiskLevel(0.39)).toBe('NONE');
      expect(calculateRiskLevel(0.00)).toBe('NONE');
    });
  });

});
