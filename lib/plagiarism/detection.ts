
import { queryLMS } from '@/lib/lms-db';
import { supabaseAdmin } from '@/lib/supabase/server'; // Use admin client for writes
import { chunkText } from '@/lib/plagiarism/text-processor';
import { generateEmbeddingsBatch } from '@/lib/plagiarism/embeddings';
import { 
  calculateCosineSimilarity, 
  calculateJaccardSimilarity, 
  calculateCombinedScore, 
  calculateRiskLevel,
  SIMILARITY_THRESHOLDS
} from '@/lib/plagiarism/similarity';

interface SubmissionData {
  submission_id: string;
  student_id: string;
  content: string;
  chunks?: {
    id?: string; // from DB insertion
    content: string;
    chunk_index: number;
    start_char: number;
    end_char: number;
    token_count: number;
    embedding?: number[];
  }[];
}

export async function detectPlagiarism(assignmentId: string, userId: string) {
  let detectionId: string | null = null;

  try {
    // 1. Create Detection Record
    const { data: detectionData, error: detectionError } = await supabaseAdmin
      .from('pds_detections')
      .insert({
        assignment_id: assignmentId,
        status: 'processing',
        created_by: userId
      })
      .select('id')
      .single();

    if (detectionError) throw new Error(`Failed to create detection record: ${detectionError.message}`);
    detectionId = detectionData.id;

    // 2. Fetch Submissions from LMS
    // Aggregate all answer texts for each submission
    const sql = `
      SELECT 
        s.id::text as submission_id, 
        s.student_id::text as student_id,
        string_agg(a.answer_text, '\n\n') as content
      FROM assignment_submissions s
      JOIN assignment_answers a ON s.id = a.submission_id
      WHERE s.assignment_id = $1
      GROUP BY s.id, s.student_id
      HAVING length(string_agg(a.answer_text, '')) > 50
    `;
    
    // assignmentId might be string in code but Int in DB, usually parameter binding handles this, 
    // but if strict, we might need parseInt(assignmentId). 
    // Given the schema uses Int for ID, let's parse it safely.
    const numericAssignmentId = parseInt(assignmentId, 10);
    if (isNaN(numericAssignmentId)) throw new Error('Invalid Assignment ID format');

    const submissions = await queryLMS<SubmissionData>(sql, [numericAssignmentId]);
    
    await supabaseAdmin
      .from('pds_detections')
      .update({ total_submissions: submissions.length })
      .eq('id', detectionId);

    console.log(`[PDS] Processing ${submissions.length} submissions for assignment ${assignmentId}`);

    // 3. Process each submission (Chunk -> Embed -> Store)
    const processedSubmissions: SubmissionData[] = [];
    let processedCount = 0;

    for (const sub of submissions) {
      if (!sub.content) continue;

      // a. Chunk Text
      const chunks = chunkText(sub.content);
      if (chunks.length === 0) continue;

      // Prepare chunks for DB insert
      const chunksForDb = chunks.map(c => ({
        submission_id: sub.submission_id,
        content: c.content,
        chunk_index: c.chunk_index,
        start_char: c.start_char,
        end_char: c.end_char,
        token_count: c.token_count
      }));

      // Insert chunks
      const { data: insertedChunks, error: chunkError } = await supabaseAdmin
        .from('pds_chunks')
        .insert(chunksForDb)
        .select('id, chunk_index'); // Select ID to map back
      
      if (chunkError) throw new Error(`Failed to insert chunks: ${chunkError.message}`);

      // Map DB IDs back to chunks
      const chunksWithIds = chunks.map(c => {
        const dbChunk = insertedChunks.find(ic => ic.chunk_index === c.chunk_index);
        return { ...c, id: dbChunk?.id };
      });

      // b. Generate Embeddings
      const chunkTexts = chunks.map(c => c.content);
      const { vectors, totalTokens } = await generateEmbeddingsBatch(chunkTexts);

      // c. Store Embeddings
      const embeddingsForDb = chunksWithIds.map((c, idx) => ({
        chunk_id: c.id,
        vector: vectors[idx],
        model: 'text-embedding-3-small'
      }));

      const { error: embedError } = await supabaseAdmin
        .from('pds_embeddings')
        .insert(embeddingsForDb);
      
      if (embedError) throw new Error(`Failed to store embeddings: ${embedError.message}`);

      // Store in memory for comparison step
      processedSubmissions.push({
        ...sub,
        chunks: chunksWithIds.map((c, idx) => ({ ...c, embedding: vectors[idx] }))
      });

      processedCount++;
      // Update progress every 5 submissions
      if (processedCount % 5 === 0) {
        await supabaseAdmin
          .from('pds_detections')
          .update({ processed_submissions: processedCount })
          .eq('id', detectionId);
      }
    }

    // 4. Comparison Phase
    // Compare every pair (A vs B)
    // Avoid duplicates: compare i with j where j > i
    const comparisons = [];
    const flags = [];

    for (let i = 0; i < processedSubmissions.length; i++) {
      for (let j = i + 1; j < processedSubmissions.length; j++) {
        const source = processedSubmissions[i];
        const target = processedSubmissions[j];

        if (source.student_id === target.student_id) continue; // Skip same student (if multiple submissions) 

        // Lexical Similarity (Jaccard) on full text
        const lexicalScore = calculateJaccardSimilarity(source.content, target.content);

        // Semantic Similarity (Max Cosine of Chunk Pairs)
        // Heuristic: Average of top 3 best chunk matches? Or just best single match?
        // AGENTS.md says: "Compare each source chunk with each target chunk... Keep matches >70%... Return average score"
        // Let's implement a robust version:
        // Find best match for each chunk in Source, then average those best matches.
        
        let totalMaxSim = 0;
        let matchedChunkCount = 0;
        const matchedChunksData: any[] = [];

        // For each chunk in Source, find best match in Target
        if (source.chunks && target.chunks) {
            for (const sChunk of source.chunks) {
                if (!sChunk.embedding) continue;
                
                let bestSimForThisChunk = 0;
                let bestTargetChunk = null;

                for (const tChunk of target.chunks) {
                    if (!tChunk.embedding) continue;
                    const sim = calculateCosineSimilarity(sChunk.embedding, tChunk.embedding);
                    if (sim > bestSimForThisChunk) {
                        bestSimForThisChunk = sim;
                        bestTargetChunk = tChunk;
                    }
                }

                if (bestSimForThisChunk > 0.7) { // Only count meaningful matches
                    totalMaxSim += bestSimForThisChunk;
                    matchedChunkCount++;
                    matchedChunksData.push({
                        source_chunk_id: sChunk.id,
                        target_chunk_id: bestTargetChunk?.id,
                        similarity: bestSimForThisChunk,
                        source_text: sChunk.content,
                        target_text: bestTargetChunk?.content,
                        // Add other metadata for UI
                    });
                }
            }
        }

        // Calculate Semantic Score
        // If no matches > 0.7, score is 0. Or maybe we should allow lower threshold for overall score?
        // Let's use the average of the matched chunks, or 0 if none.
        const semanticScore = matchedChunkCount > 0 ? (totalMaxSim / matchedChunkCount) : 0;
        
        // If lexical is high but semantic is 0 (maybe distinct wording but same keywords?), we still want to capture it.
        // But if semanticScore is based ONLY on >0.7 matches, it might be too strict for the "Combined Score" formula if we have 0.
        // Let's soften it: if matchedChunkCount is 0, try to use a global average or just 0.
        // Better: Combined Score = (0.7 * Semantic) + (0.3 * Lexical)
        // If Semantic is 0 because no chunks > 0.7, the score relies on Lexical.
        
        const combinedScore = calculateCombinedScore(semanticScore, lexicalScore);
        const riskLevel = calculateRiskLevel(combinedScore);

        if (combinedScore >= SIMILARITY_THRESHOLDS.LOW) {
           const comparisonId = crypto.randomUUID(); // Generate ID for FK reference
           comparisons.push({
             id: comparisonId,
             source_submission_id: source.submission_id,
             target_submission_id: target.submission_id,
             semantic_score: semanticScore,
             lexical_score: lexicalScore,
             combined_score: combinedScore,
             risk_level: riskLevel,
             matched_chunks: matchedChunksData, // Store evidence
             compared_at: new Date().toISOString()
           });

           if (riskLevel === 'HIGH' || riskLevel === 'MEDIUM') {
             flags.push({
               comparison_id: comparisonId,
               submission_id: source.submission_id, // Flag source
               status: 'pending',
               is_false_positive: false
             });
             // Optionally flag target too? Usually one flag per pair is enough to alert, 
             // but UI might look for flags by submission_id. 
             // Let's flag BOTH to ensure it shows up on both students' dashboards.
             flags.push({
                comparison_id: comparisonId,
                submission_id: target.submission_id,
                status: 'pending',
                is_false_positive: false
             });
           }
        }
      }
    }

    // Bulk Insert Comparisons
    if (comparisons.length > 0) {
        const { error: compError } = await supabaseAdmin
            .from('pds_comparisons')
            .insert(comparisons);
        if (compError) throw new Error(`Failed to insert comparisons: ${compError.message}`);
    }

    // Bulk Insert Flags
    if (flags.length > 0) {
         const { error: flagError } = await supabaseAdmin
            .from('pds_flags')
            .insert(flags);
         if (flagError) throw new Error(`Failed to insert flags: ${flagError.message}`);
    }

    // 5. Complete
    await supabaseAdmin
      .from('pds_detections')
      .update({ 
        status: 'completed', 
        completed_at: new Date().toISOString(),
        processed_submissions: processedCount 
      })
      .eq('id', detectionId);
    
    // Audit Log
    await supabaseAdmin.from('pds_audit_logs').insert({
        user_id: userId,
        action: 'run_detection',
        entity_type: 'detection',
        entity_id: detectionId!,
        metadata: { assignment_id: assignmentId, matches_found: comparisons.length }
    });

    return { success: true, detectionId, matches: comparisons.length };

  } catch (error: any) {
    console.error('[PDS] Detection failed:', error);
    
    if (detectionId) {
      await supabaseAdmin
        .from('pds_detections')
        .update({ 
            status: 'failed', 
            error_message: error.message 
        })
        .eq('id', detectionId);
    }
    throw error;
  }
}
