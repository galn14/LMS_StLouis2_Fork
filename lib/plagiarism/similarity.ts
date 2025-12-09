
export const SIMILARITY_THRESHOLDS = {
  HIGH: 0.8,
  MEDIUM: 0.6,
  LOW: 0.4,
  NONE: 0.0,
};

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
const STOPWORDS = new Set([
  // English
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'is', 'are', 'was', 'were', 'been', 'has', 'had', 'does', 'did', 'can',
  'could', 'should', 'would', 'may', 'might', 'must', 'am',
  // Indonesian
  'yang', 'di', 'dan', 'itu', 'dengan', 'untuk', 'tidak', 'ini', 'dari', 'dalam',
  'akan', 'pada', 'juga', 'saya', 'adalah', 'ke', 'karena', 'kepada', 'oleh', 'saat',
  'harus', 'sementara', 'setelah', 'belum', 'kami', 'kita', 'mereka', 'dia', 'ia',
  'atau', 'bisa', 'dapat', 'sudah', 'bagi', 'namun', 'tentang', 'seperti', 'jika',
  'sehingga', 'ia', 'tapi', 'sangat', 'banyak', 'lebih'
]);

/**
 * Calculates the cosine similarity between two vectors.
 * Formula: dot(A, B) / (||A|| * ||B||)
 * 
 * @param vecA - First vector (number array)
 * @param vecB - Second vector (number array)
 * @returns Similarity score between -1.0 and 1.0 (usually 0.0 to 1.0 for text embeddings)
 */
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same dimensionality');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Tokenizes text for Jaccard similarity.
 * - Lowercase
 * - Remove punctuation
 * - Split by whitespace
 * - Filter short words (< 3 chars) and stopwords
 * 
 * @param text - Raw text
 * @returns Set of unique tokens
 */
export function tokenizeForJaccard(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, '');
  const words = normalized.split(/\s+/);
  
  const tokens = new Set<string>();
  for (const word of words) {
    if (word.length >= 3 && !STOPWORDS.has(word)) {
      tokens.add(word);
    }
  }
  return tokens;
}

/**
 * Calculates the Jaccard similarity between two texts.
 * Formula: |Intersection| / |Union|
 * 
 * @param textA - First text
 * @param textB - Second text
 * @returns Similarity score between 0.0 and 1.0
 */
export function calculateJaccardSimilarity(textA: string, textB: string): number {
  const tokensA = tokenizeForJaccard(textA);
  const tokensB = tokenizeForJaccard(textB);

  if (tokensA.size === 0 && tokensB.size === 0) return 0; // Both empty -> 0 similarity? Or 1? Usually 0 for empty content.

  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersectionCount++;
    }
  }

  const unionCount = tokensA.size + tokensB.size - intersectionCount;
  
  if (unionCount === 0) return 0;

  return intersectionCount / unionCount;
}

/**
 * Calculates the combined similarity score.
 * Formula: 0.7 * Semantic + 0.3 * Lexical
 * 
 * @param semanticScore - Cosine similarity score (0-1)
 * @param lexicalScore - Jaccard similarity score (0-1)
 * @returns Combined score (0-1)
 */
export function calculateCombinedScore(semanticScore: number, lexicalScore: number): number {
  return (0.7 * semanticScore) + (0.3 * lexicalScore);
}

/**
 * Determines the risk level based on the combined score.
 * 
 * @param score - Combined similarity score (0-1)
 * @returns Risk Level string ('HIGH', 'MEDIUM', 'LOW', 'NONE')
 */
export function calculateRiskLevel(score: number): RiskLevel {
  if (score >= SIMILARITY_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= SIMILARITY_THRESHOLDS.MEDIUM) return 'MEDIUM';
  if (score >= SIMILARITY_THRESHOLDS.LOW) return 'LOW';
  return 'NONE';
}
