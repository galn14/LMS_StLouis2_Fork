
import { openai } from '@/lib/openai';
import { supabaseAdmin as supabase } from '@/lib/supabase/server';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;

interface EmbeddingResult {
  vector: number[];
  tokenCount: number;
}

/**
 * Delays execution for a specified number of milliseconds.
 * @param ms - The number of milliseconds to wait.
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generates an embedding for a single text string using OpenAI's API.
 * Includes exponential backoff for rate limits and error handling.
 *
 * @param text - The text to generate an embedding for.
 * @returns A promise that resolves to the embedding vector and token usage.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  let attempt = 0;
  
  while (attempt < MAX_RETRIES) {
    try {
      const cleanText = text.replace(/\n/g, ' ');

      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: cleanText,
        encoding_format: 'float',
      });

      const vector = response.data[0].embedding;
      const tokenCount = response.usage.total_tokens;

      console.log(`Embedding generated. Tokens used: ${tokenCount}. Cost estimate: $${(tokenCount / 1000000) * 0.02}`);

      return { vector, tokenCount };

    } catch (error: any) {
      attempt++;
      
      if (error?.status === 429 || (error?.status >= 500 && error?.status < 600)) {
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Failed to generate embedding after ${MAX_RETRIES} attempts: ${error.message}`);
        }
        
        const waitTime = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s...
        console.warn(`OpenAI API error ${error.status}. Retrying in ${waitTime}ms... (Attempt ${attempt}/${MAX_RETRIES})`);
        await delay(waitTime);
      } else {
        throw error;
      }
    }
  }

  throw new Error('Unexpected error in generateEmbedding loop.');
}

/**
 * Generates embeddings for a batch of text strings.
 * OpenAI supports batching inputs in a single API call for efficiency.
 *
 * @param texts - An array of text strings.
 * @returns A promise that resolves to an array of embedding vectors and total token usage.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<{ vectors: number[][], totalTokens: number }> {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const cleanTexts = texts.map(t => t.replace(/\n/g, ' '));

      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: cleanTexts,
        encoding_format: 'float',
      });

      // Sort results by index to ensure order matches input
      const sortedData = response.data.sort((a, b) => a.index - b.index);
      const vectors = sortedData.map(item => item.embedding);
      const totalTokens = response.usage.total_tokens;

      console.log(`Batch embeddings generated. Items: ${texts.length}. Total tokens: ${totalTokens}. Cost estimate: $${(totalTokens / 1000000) * 0.02}`);

      return { vectors, totalTokens };

    } catch (error: any) {
      attempt++;

      if (error?.status === 429 || (error?.status >= 500 && error?.status < 600)) {
        if (attempt >= MAX_RETRIES) {
           throw new Error(`Failed to generate batch embeddings after ${MAX_RETRIES} attempts: ${error.message}`);
        }
        
        const waitTime = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
        console.warn(`OpenAI API batch error ${error.status}. Retrying in ${waitTime}ms... (Attempt ${attempt}/${MAX_RETRIES})`);
        await delay(waitTime);
      } else {
        throw error;
      }
    }
  }
   throw new Error('Unexpected error in generateEmbeddingsBatch loop.');
}

/**
 * Stores a vector embedding in the Supabase `pds_embeddings` table.
 *
 * @param chunkId - The UUID of the chunk in `pds_chunks`.
 * @param vector - The 384-dimensional embedding vector.
 */
export async function storeEmbedding(chunkId: string, vector: number[]) {
  const { error } = await supabase
    .from('pds_embeddings')
    .insert({
      chunk_id: chunkId,
      vector: vector,
      model: EMBEDDING_MODEL
    });

  if (error) {
    throw new Error(`Failed to store embedding for chunk ${chunkId}: ${error.message}`);
  }
}
