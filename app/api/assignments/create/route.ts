import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/prisma';
import {
  getAcsAssignmentByAssignmentId,
  getUploadedFilesByResourceIds,
  insertUploadedFiles,
  upsertAcsAssignment,
} from '@/lib/db2/acs-repo';
import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';

export async function POST(request: NextRequest) {
  try {
    // 1. Auth Check
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate Instructor Role
    const userDetails = await prisma.app_user.findUnique({
      where: { id: parseInt(session.user.id) },
      include: { app_user_role: { include: { enumeration: true } } },
    });

    const isInstructor = userDetails?.app_user_role?.some(
      role => (role.enumeration?.name === 'TEACHER' || role.enumeration?.name === 'ADMIN') && role.is_active
    );

    if (!isInstructor) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // 3. Parse Body
    const body = await request.json();
    const { assignmentId, courseId, rubric, resourceIds } = body;

    if (!assignmentId || !courseId || !rubric) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // resourceIds is required — user must explicitly choose which materials to use
    const selectedResourceIds: number[] = Array.isArray(resourceIds) ? resourceIds : [];
    if (selectedResourceIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No materials selected', details: 'Select at least one course material file to use as grading reference.' },
        { status: 422 }
      );
    }

    const existingAssignment = await getAcsAssignmentByAssignmentId(assignmentId.toString());
    const isRerun = Boolean(existingAssignment);

    // 4. Fetch only the selected resources from LMS DB
    const courseResources = await prisma.resources.findMany({
      where: { id: { in: selectedResourceIds } },
      select: { id: true, file_url: true, file_name: true, file_type: true },
    });

    if (courseResources.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid resources found for the given IDs' },
        { status: 422 }
      );
    }

    const openai = new OpenAI();

    // 5. Cross-assignment dedup: look up existing OpenAI files by resource_id
    //    This avoids re-uploading the same course material for different assignments.
    const existingUploads = await getUploadedFilesByResourceIds(selectedResourceIds);
    const existingByResourceId = new Map(existingUploads.map(f => [f.resource_id!, f.file_id]));

    const allFileIds: string[] = [];
    const newFileRecords: { resource_id: number; file_id: string; filename: string; type_file: string }[] = [];

    for (const resource of courseResources) {
      // Check if this resource was already uploaded to OpenAI (by any assignment)
      if (existingByResourceId.has(resource.id)) {
        const existingId = existingByResourceId.get(resource.id)!;
        try {
          await openai.files.retrieve(existingId);
          allFileIds.push(existingId);
          continue; // still valid on OpenAI, reuse
        } catch {
          console.warn(`OpenAI file ${existingId} for resource ${resource.id} no longer exists, re-uploading`);
        }
      }

      // Upload file
      const localFilePath = path.join(process.cwd(), 'public', resource.file_url);
      if (!fs.existsSync(localFilePath)) {
        console.warn(`File not found on disk: ${localFilePath}`);
        continue;
      }

      try {
        const openaiFile = await openai.files.create({
          file: fs.createReadStream(localFilePath),
          purpose: 'assistants',
        });
        allFileIds.push(openaiFile.id);
        const ext = path.extname(resource.file_name).toLowerCase();
        newFileRecords.push({
          resource_id: resource.id,
          file_id: openaiFile.id,
          filename: resource.file_name,
          type_file: resource.file_type ?? ext.replace('.', '') ?? 'unknown',
        });
      } catch (err) {
        console.error(`Failed to upload resource ${resource.id} to OpenAI:`, err);
      }
    }

    // 6. Guard: abort if no files are available
    if (allFileIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No course materials available', details: 'None of the selected files could be loaded or uploaded.' },
        { status: 422 }
      );
    }

    // 7. Delete old Vector Store if rerun
    if (isRerun && existingAssignment?.vector_store_id) {
      try {
        await openai.vectorStores.delete(existingAssignment.vector_store_id);
      } catch (e) {
        console.warn('Failed to delete old vector store during rerun:', e);
      }
    }

    // 8. Create new Vector Store
    const vectorStore = await openai.vectorStores.create({
      name: `VS_${courseId}_${assignmentId}`,
    });

    // 9. Attach files and wait for indexing
    let filesIndexed = 0;
    let filesFailed = 0;
    try {
      const batch = await openai.vectorStores.fileBatches.createAndPoll(vectorStore.id, {
        file_ids: allFileIds,
      });
      filesIndexed = batch.file_counts.completed;
      filesFailed = batch.file_counts.failed;
    } catch (e) {
      console.error('Failed to attach files to vector store:', e);
      await openai.vectorStores.delete(vectorStore.id);
      return NextResponse.json(
        { success: false, error: 'Failed to index course materials', details: String(e) },
        { status: 502 }
      );
    }

    if (filesIndexed === 0) {
      await openai.vectorStores.delete(vectorStore.id);
      return NextResponse.json(
        {
          success: false,
          error: 'Course materials could not be indexed',
          details: `${filesFailed} file(s) failed to be processed by OpenAI.`,
        },
        { status: 502 }
      );
    }

    // 10. Save to DB
    const rerunFields = isRerun
      ? { rerun_grading: true, rerun_grading_at: new Date().toISOString(), archived_at: null }
      : { rerun_grading: false, rerun_grading_at: null, archived_at: null };

    let data;
    try {
      data = await upsertAcsAssignment({
        assignment_id: assignmentId.toString(),
        course_id: courseId.toString(),
        vector_store_id: vectorStore.id,
        rubric,
        created_by: session.user.id,
        status: 'setup',
        ...rerunFields,
      });
    } catch (error: any) {
      await openai.vectorStores.delete(vectorStore.id);
      console.error('DB2 error:', error);
      return NextResponse.json(
        { success: false, error: 'Database error', details: error?.message ?? String(error) },
        { status: 500 }
      );
    }

    // 11. Save newly uploaded file records (with resource_id for future dedup)
    if (newFileRecords.length > 0) {
      try {
        await insertUploadedFiles(
          newFileRecords.map(rec => ({
            assignment_id: assignmentId.toString(),
            resource_id: rec.resource_id,
            file_id: rec.file_id,
            filename: rec.filename,
            type_file: rec.type_file,
          }))
        );
      } catch (fileError) {
        console.error('Failed to record uploaded files in DB:', fileError);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        acs_assignment_id: data.id,
        vector_store_id: vectorStore.id,
        files_reused: allFileIds.length - newFileRecords.length,
        files_uploaded: newFileRecords.length,
        files_indexed: filesIndexed,
        files_failed: filesFailed,
        ...(filesFailed > 0 && {
          warning: `${filesFailed} file(s) failed to index and will not be used during grading.`,
        }),
      },
    });

  } catch (error: any) {
    console.error('Error creating assignment setup:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
