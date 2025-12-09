/**
 * Normalizes text by:
 * - Replacing multiple whitespaces with a single space.
 * - Trimming leading/trailing whitespace.
 * - Replacing common newlines with a consistent format (e.g., '\n').
 * - Preserving paragraph breaks (double newlines).
 * @param text The input text to normalize.
 * @returns The normalized text.
 */
export function normalizeText(text: string): string {
  // Replace all types of line breaks with a consistent newline
  let normalized = text.replace(/\r\n|\r/g, '\n');
  // Replace multiple newlines with at most two (to preserve paragraph breaks)
  normalized = normalized.replace(/\n\s*\n/g, '\n\n');
  // Trim leading/trailing whitespace from each line
  normalized = normalized.split('\n').map(line => line.trim()).join('\n');
  // Replace multiple spaces/tabs with a single space globally AFTER trimming and newline normalization
  normalized = normalized.replace(/[ \t]+/g, ' ');
  // Trim leading/trailing whitespace from the whole text
  normalized = normalized.trim();
  return normalized;
}

/**
 * Estimates the number of tokens in a given text.
 * Rough estimate: 1 token ~ 4 characters.
 * @param text The text to estimate tokens for.
 * @returns The estimated token count.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Chunks a given text into smaller pieces for embedding,
 * aiming for a target token size with a specified overlap.
 * Tries to break at sentence boundaries.
 *
 * @param text The full text content to chunk.
 * @param targetTokens The desired token count for each chunk (default: 900).
 * @param overlapTokens The desired token overlap between chunks (default: 150).
 * @returns An array of text chunks with their content and metadata.
 */
export function chunkText(
  text: string,
  targetTokens: number = 900,
  overlapTokens: number = 150
): { content: string; chunk_index: number; start_char: number; end_char: number; token_count: number }[] {
  const normalizedText = normalizeText(text);
  const textLength = normalizedText.length;
  const chunks: { content: string; chunk_index: number; start_char: number; end_char: number; token_count: number }[] = [];

  if (textLength === 0) {
    return [];
  }

  const targetChars = targetTokens * 4; // Estimate characters per target token
  const overlapChars = overlapTokens * 4; // Estimate characters per overlap token

  let currentChunkIndex = 0;
  let currentPos = 0;

  // Handle very short texts as a single chunk
  // If text is less than half targetTokens, treat as single chunk
  if (estimateTokens(normalizedText) < targetTokens / 2) { 
    chunks.push({
      content: normalizedText,
      chunk_index: 0,
      start_char: 0,
      end_char: textLength - 1,
      token_count: estimateTokens(normalizedText),
    });
    return chunks;
  }

  while (currentPos < textLength) {
    let proposedEndPos = Math.min(currentPos + targetChars, textLength);
    let finalChunkEnd = proposedEndPos;

    // Minimum chars for a chunk before we consider a sentence boundary break
    const MIN_CHARS_BEFORE_SENTENCE_BREAK = Math.floor(targetChars * 0.5); // At least 50% of targetChars

    // Search for a sentence boundary starting from after MIN_CHARS_BEFORE_SENTENCE_BREAK,
    // up to proposedEndPos + a small buffer (e.g., 50 chars)
    const searchStartForBoundary = Math.max(currentPos + MIN_CHARS_BEFORE_SENTENCE_BREAK, currentPos + 1); // Ensure we move forward
    const searchEndForBoundary = Math.min(textLength, proposedEndPos + 50); // Look slightly beyond to catch a boundary

    const sentenceBoundaryRegex = /[.?!](\s+|$)/g; // Sentence ending followed by one or more spaces or end of string
    sentenceBoundaryRegex.lastIndex = searchStartForBoundary; // Start search from this position

    let match;
    let foundBoundary = -1;

    // Find the first sentence boundary after searchStartForBoundary, but before searchEndForBoundary
    while ((match = sentenceBoundaryRegex.exec(normalizedText)) !== null && match.index < searchEndForBoundary) {
      foundBoundary = match.index + match[0].length;
      if (foundBoundary > currentPos) { // Ensure the boundary is not before the current chunk start
          break; // Take the first one found in the valid range
      }
    }

    if (foundBoundary !== -1 && foundBoundary > currentPos && foundBoundary <= searchEndForBoundary) {
      // Ensure the boundary doesn't result in a tiny chunk, unless it's the very first chunk and text is short
      if (foundBoundary - currentPos > MIN_CHARS_BEFORE_SENTENCE_BREAK || chunks.length === 0) {
        finalChunkEnd = foundBoundary;
      }
    } else {
        // Fallback to breaking at last space if no suitable sentence boundary
        const tempChunkContent = normalizedText.substring(currentPos, proposedEndPos);
        const lastSpaceIndex = tempChunkContent.lastIndexOf(' ');
        // Only use if reasonably far into the chunk, and not just a single word
        if (lastSpaceIndex > (targetChars * 0.8) && lastSpaceIndex !== -1 && (currentPos + lastSpaceIndex) > currentPos + (targetChars * 0.5)) {
            finalChunkEnd = currentPos + lastSpaceIndex;
        }
    }

    let chunkContent = normalizedText.substring(currentPos, finalChunkEnd).trim(); // Trim to remove any trailing spaces from sentence break

    // If chunkContent is empty after trimming (e.g., only spaces were cut), extend it minimally
    if (chunkContent.length === 0 && currentPos < textLength) {
        finalChunkEnd = Math.min(currentPos + 50, textLength); // Take at least 50 chars or to end
        chunkContent = normalizedText.substring(currentPos, finalChunkEnd).trim();
    }
    
    // Ensure the chunk is not empty, if it is, advance currentPos and continue
    if (chunkContent.length === 0) {
      currentPos = Math.min(currentPos + targetChars, textLength); // Skip ahead to avoid infinite loop on bad data
      continue;
    }

    chunks.push({
      content: chunkContent,
      chunk_index: currentChunkIndex,
      start_char: currentPos,
      end_char: currentPos + chunkContent.length - 1,
      token_count: estimateTokens(chunkContent),
    });

    currentChunkIndex++;
    // Move currentPos back by overlapChars for the next chunk
    currentPos = finalChunkEnd - overlapChars;
    if (currentPos < 0) currentPos = 0; // Prevent negative position

    // If we've reached the end, or the next chunk would be too small without overlap
    if (finalChunkEnd >= textLength) {
        break;
    }
  }

  // Edge case: if the last chunk is too small, merge it with the previous one
  // const MIN_CHUNK_CHARS = 50; // Roughly 12-13 tokens
  // if (chunks.length > 1) {
  //   const lastChunk = chunks[chunks.length - 1];
  //   if (lastChunk.content.length < MIN_CHUNK_CHARS) {
  //     const secondLastChunk = chunks[chunks.length - 2];
  //     // Append the last chunk's content to the second to last one
  //     secondLastChunk.content += (secondLastChunk.content.endsWith(' ') ? '' : ' ') + lastChunk.content;
  //     secondLastChunk.end_char = lastChunk.end_char; // Update end_char to cover the merged content
  //     secondLastChunk.token_count = estimateTokens(secondLastChunk.content);
  //     chunks.pop(); // Remove the small last chunk
  //   }
  // }

  return chunks;
}
