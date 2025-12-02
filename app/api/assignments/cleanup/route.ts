import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // 1. Auth Check
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

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

    // 2. Parse Body
    const body = await request.json();
    const { assignmentId } = body;

    if (!assignmentId) {
      return NextResponse.json({ success: false, error: 'Missing assignmentId' }, { status: 400 });
    }

    // 3. Get ACS Assignment details and uploaded files
    const { data: acsAssignment, error: acsError } = await supabaseAdmin
      .from('acs_assignments')
      .select('id, assistant_id, vector_store_id')
      .eq('assignment_id', assignmentId)
      .single();

    if (acsError || !acsAssignment) {
      return NextResponse.json({ success: false, error: 'ACS Assignment not found' }, { status: 404 });
    }

    const { data: uploadedFiles, error: filesError } = await supabaseAdmin
      .from('acs_uploaded_files')
      .select('file_id')
      .eq('assignment_id', assignmentId);
    
    if (filesError) {
        console.error('Error fetching uploaded files for cleanup:', filesError);
        // Continue cleanup, but log error
    }

    const filesToDelete = uploadedFiles?.map(f => f.file_id) || [];

    // 4. Delete OpenAI Resources
    const cleanupResults = {
        assistant: 'failed',
        vectorStore: 'failed',
        files: [] as { fileId: string; status: string }[],
        assignmentStatusUpdate: 'failed'
    };

    try {
        // Delete Assistant
        await (openai.beta.assistants as any).del(acsAssignment.assistant_id);
        cleanupResults.assistant = 'success';
    } catch (e: any) {
        if (e.status === 404) cleanupResults.assistant = 'not_found';
        console.warn(`Failed to delete Assistant ${acsAssignment.assistant_id}:`, e.message);
    }

    try {
        // Delete Vector Store
        await (openai.beta as any).vectorStores.del(acsAssignment.vector_store_id);
        cleanupResults.vectorStore = 'success';
    } catch (e: any) {
        if (e.status === 404) cleanupResults.vectorStore = 'not_found';
        console.warn(`Failed to delete Vector Store ${acsAssignment.vector_store_id}:`, e.message);
    }

    // Delete individual files
    for (const fileId of filesToDelete) {
        try {
            await (openai.files as any).del(fileId);
            cleanupResults.files.push({ fileId, status: 'success' });
        } catch (e: any) {
            if (e.status === 404) cleanupResults.files.push({ fileId, status: 'not_found' });
            else cleanupResults.files.push({ fileId, status: 'failed' });
            console.warn(`Failed to delete file ${fileId}:`, e.message);
        }
    }

    // 5. Update assignment status in Supabase
    const { error: updateError } = await supabaseAdmin
      .from('acs_assignments')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('assignment_id', assignmentId);

    if (updateError) {
        console.error('Failed to update ACS assignment status to archived:', updateError);
    } else {
        cleanupResults.assignmentStatusUpdate = 'success';
    }

    return NextResponse.json({ success: true, cleanupDetails: cleanupResults });

  } catch (error: any) {
    console.error('Error during cleanup:', error);
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
