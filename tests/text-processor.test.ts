import { normalizeText, chunkText } from '@/lib/plagiarism/text-processor';

describe('normalizeText', () => {
  it('should replace multiple whitespaces with a single space', () => {
    const text = 'This   is  a   test.';
    expect(normalizeText(text)).toBe('This is a test.');
  });

  it('should trim leading/trailing whitespace', () => {
    const text = '  This is a test.  ';
    expect(normalizeText(text)).toBe('This is a test.');
  });

  it('should replace various line breaks with consistent newlines and preserve paragraph breaks', () => {
    const text = 'Line 1\r\nLine 2\rLine 3\n\n  Paragraph 2 starts here.\n\n';
    expect(normalizeText(text)).toBe('Line 1\nLine 2\nLine 3\n\nParagraph 2 starts here.');
  });

  it('should handle empty string', () => {
    expect(normalizeText('')).toBe('');
  });

  it('should handle text with only whitespace', () => {
    expect(normalizeText('   \n  \t ')).toBe('');
  });
});

describe('chunkText', () => {
  // A long sample text for testing chunking
  const longText = "\n  This is the first sentence. It is followed by a second one. And a third, for good measure.\n  \n  The quick brown fox jumps over the lazy dog. This is a classic sentence for testing. It has a good rhythm.\n  \n  Another paragraph here. This one is a bit longer and will test the sentence boundary detection more thoroughly.\n  We want to ensure that chunks don't cut off in the middle of a thought. For instance, this sentence should stay together.\n  \n  Finally, a very long sentence to challenge the chunking algorithm. This sentence is designed to be longer than a typical chunk,\n  forcing the algorithm to break it gracefully, perhaps at the nearest sentence boundary before the target character limit,\n  or by simply cutting it if no suitable boundary is found, as a last resort. This should demonstrate robustness.\n  ";

  it('should return a single chunk for very short texts', () => {
    const text = 'This is a short text.';
    const chunks = chunkText(text);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe(normalizeText(text));
    expect(chunks[0].chunk_index).toBe(0);
    expect(chunks[0].start_char).toBe(0);
    expect(chunks[0].end_char).toBe(normalizeText(text).length - 1);
  });

  it('should chunk longer text with target token size and overlap', () => {
    // With default targetTokens = 900 (3600 chars) and overlapTokens = 150 (600 chars)
    const chunks = chunkText(longText, 100, 10); // Use smaller numbers for easier testing
    // console.log(chunks.map(c => c.content));
    expect(chunks.length).toBeGreaterThan(1); // Should create multiple chunks
    
    // Check overlap logic (approximate due to sentence boundary adjustments)
    if (chunks.length > 1) {
      const firstChunkEnd = chunks[0].end_char;
      const secondChunkStart = chunks[1].start_char;
      // The start of the second chunk should be within the overlap of the first
      // Allow for some flexibility due to sentence boundary detection and trimming
      const expectedOverlapMin = 10 * 4 - 20; 
      const actualOverlap = firstChunkEnd - secondChunkStart;
      expect(actualOverlap).toBeGreaterThanOrEqual(expectedOverlapMin);
    }

    // Check if chunks cover the whole text
    const normalizedLength = normalizeText(longText).length;
    // The last chunk should end very close to the end of the normalized text
    expect(chunks[chunks.length - 1].end_char).toBeGreaterThanOrEqual(normalizedLength - (10 * 4)); 
    expect(chunks[chunks.length - 1].end_char).toBeLessThanOrEqual(normalizedLength);
  });

  it('should try to break at sentence boundaries', () => {
    const text = 'This is sentence one. This is sentence two! This is sentence three. Here is another sentence to make it longer.';
    const chunks = chunkText(text, 10, 0); // Very small chunks to force sentence breaking
    expect(chunks.length).toBeGreaterThanOrEqual(3); // Expect at least 3 chunks
    expect(chunks[0].content).toMatch(/sentence one\.$/);
    expect(chunks[1].content).toMatch(/sentence two!$/);
    expect(chunks[2].content).toMatch(/sentence three\.$/);
  });

  it('should merge small last chunks with the previous one', () => {
    const text = 'This is a normal sized chunk. This is a very tiny last bit.';
    const chunks = chunkText(text, 900, 150); // Default values
    expect(chunks.length).toBe(1); // Should merge into one if last is small
  });

  it('should handle text that is exactly the chunk size', () => {
    const text = 'A'.repeat(900 * 4); // Exact target chars
    const chunks = chunkText(text, 900, 150);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content.length).toBe(text.length);
  });

  it('should handle text with leading/trailing newlines and spaces', () => {
    const text = "\n\n  Hello world.  How are you?\n\n";
    const chunks = chunkText(text);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe("Hello world. How are you?");
  });

});
