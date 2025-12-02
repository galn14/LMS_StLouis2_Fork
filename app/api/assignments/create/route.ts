import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { supabaseAdmin } from '@/lib/supabase/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    // 1. Auth Check
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate Instructor Role (using existing prisma check)
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
    const { assignmentId, courseId, rubric } = body;

    if (!assignmentId || !courseId || !rubric) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // 3.5 Fetch existing course materials (resources)
    const courseResources = await prisma.resources.findMany({
      where: {
        sessions: {
          class_courses: {
            courses: {
              id: parseInt(courseId.toString()),
            },
          },
        },
      },
      select: {
        id: true,
        file_url: true,
        file_name: true,
        file_type: true,
      },
    });

    const supportedExtensions = ['.pdf', '.docx', '.doc', '.txt', '.md', '.pptx'];
    const uploadedFileIds: string[] = [];
    const uploadedFileRecords: { file_id: string; filename: string }[] = [];

    for (const resource of courseResources) {
      try {
        const ext = path.extname(resource.file_name).toLowerCase();
        if (!supportedExtensions.includes(ext)) continue;

        const localFilePath = path.join(process.cwd(), 'public', resource.file_url);
        if (!fs.existsSync(localFilePath)) {
            console.warn(`File not found: ${localFilePath}`);
            continue;
        }

        const fileStream = fs.createReadStream(localFilePath);
        const openaiFile = await openai.files.create({
          file: fileStream,
          purpose: 'assistants',
        });

        uploadedFileIds.push(openaiFile.id);
        uploadedFileRecords.push({
            file_id: openaiFile.id,
            filename: resource.file_name
        });

      } catch (err) {
        console.error(`Failed to upload resource ${resource.id} to OpenAI:`, err);
        // Continue with other files
      }
    }

    // 4. Create OpenAI Vector Store
    const vectorStore = await (openai.beta as any).vectorStores.create({
      name: `VS_${courseId}_${assignmentId}`,
    });

    // 4.5 Attach uploaded files to Vector Store
    // Use a loop here as the user prompt implies attaching files. 
    // For production with many files, a batch upload (fileBatches) is preferred.
    for (const fileId of uploadedFileIds) {
        try {
            await (openai.beta as any).vectorStores.files.create(vectorStore.id, {
                file_id: fileId
            });
        } catch (e) {
            console.error(`Failed to attach file ${fileId} to VS:`, e);
        }
    }

    // 5. Read System Prompt
    const promptPath = path.join(process.cwd(), 'prompts', 'grading-system-prompt.txt');
    const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

    // 6. Create OpenAI Assistant
    const assistant = await openai.beta.assistants.create({
      name: `ACS_Assistant_${assignmentId}`,
      instructions: systemPrompt,
      model: "gpt-4o-mini",
      tools: [{ type: "file_search" }],
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStore.id],
        },
      },
    });

    // 7. Save to Supabase
    const { data, error } = await supabaseAdmin
      .from('acs_assignments')
      .insert({
        assignment_id: assignmentId.toString(), // Ensure string format
        course_id: courseId.toString(),
        assistant_id: assistant.id,
        vector_store_id: vectorStore.id,
        rubric: rubric,
        created_by: session.user.id,
        status: 'setup',
      })
      .select()
      .single();

    if (error) {
        // Cleanup OpenAI resources if DB save fails
        await (openai.beta.assistants as any).del(assistant.id);
        await (openai.beta as any).vectorStores.del(vectorStore.id);
        // Note: not deleting the uploaded files here, but ideally should.
        console.error('Supabase error:', error);
        return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 });
    }

    // 7.5 Save uploaded file records to Supabase
    if (uploadedFileRecords.length > 0) {
        const fileInserts = uploadedFileRecords.map(rec => ({
            assignment_id: assignmentId.toString(),
            file_id: rec.file_id,
            filename: rec.filename
        }));
        
        const { error: fileError } = await supabaseAdmin
            .from('acs_uploaded_files')
            .insert(fileInserts);
            
        if (fileError) {
            console.error('Failed to record uploaded files in DB:', fileError);
            // Non-critical error, assignment is still created
        }
    }

    return NextResponse.json({
      success: true,
      data: {
        acs_assignment_id: data.id,
        assistant_id: assistant.id,
        vector_store_id: vectorStore.id,
      },
    });

  } catch (error: any) {
    console.error('Error creating assignment setup:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error.message,
      },
      { status: 500 }
    );
  }
}
