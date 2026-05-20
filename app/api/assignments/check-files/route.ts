import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getOpenAI } from '@/lib/openai';
import { getUploadedFilesByResourceIds } from '@/lib/db2/acs-repo';
import path from 'path';
import fs from 'fs';

export interface FileCheckResult {
  resource_id: number;
  filename: string;
  local_path: string;
  local_exists: boolean;
  openai_file_id: string | null;
  openai_exists: boolean;
  status: 'ok' | 'missing_openai' | 'missing_local' | 'new';
}

export interface CheckFilesResponse {
  files: FileCheckResult[];
  summary: {
    ok: number;
    missing_openai: number;
    missing_local: number;
    new: number;
  };
  can_proceed: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { resourceIds } = body;

    if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Missing resourceIds' }, { status: 400 });
    }

    // 1. Fetch resource metadata from LMS DB
    const resources = await prisma.resources.findMany({
      where: { id: { in: resourceIds.map(Number) } },
      select: { id: true, file_url: true, file_name: true },
    });

    // 2. Cross-assignment lookup by resource_id
    const existingUploads = await getUploadedFilesByResourceIds(resourceIds.map(Number));
    const uploadMap = new Map(existingUploads.map(f => [f.resource_id!, f.file_id]));

    // 3. Check each resource
    const files: FileCheckResult[] = [];
    const openai = await getOpenAI();

    await Promise.all(
      resources.map(async (resource) => {
        const localPath = resource.file_url;
        const absolutePath = path.join(process.cwd(), 'public', localPath);
        const localExists = fs.existsSync(absolutePath);
        const openaiFileId = uploadMap.get(resource.id) ?? null;

        let openaiExists = false;
        if (openaiFileId) {
          try {
            await openai.files.retrieve(openaiFileId);
            openaiExists = true;
          } catch {
            openaiExists = false;
          }
        }

        let status: FileCheckResult['status'];
        if (openaiFileId && openaiExists) {
          status = 'ok';
        } else if (openaiFileId && !openaiExists && localExists) {
          status = 'missing_openai';
        } else if (openaiFileId && !openaiExists && !localExists) {
          status = 'missing_local';
        } else {
          status = 'new';
        }

        files.push({
          resource_id: resource.id,
          filename: resource.file_name,
          local_path: localPath,
          local_exists: localExists,
          openai_file_id: openaiFileId,
          openai_exists: openaiExists,
          status,
        });
      })
    );

    const summary = {
      ok: files.filter(f => f.status === 'ok').length,
      missing_openai: files.filter(f => f.status === 'missing_openai').length,
      missing_local: files.filter(f => f.status === 'missing_local').length,
      new: files.filter(f => f.status === 'new').length,
    };

    const can_proceed = files.some(f =>
      f.status === 'ok' ||
      f.status === 'missing_openai' ||
      (f.status === 'new' && f.local_exists)
    );

    return NextResponse.json({
      success: true,
      data: { files, summary, can_proceed } as CheckFilesResponse,
    });

  } catch (error: any) {
    console.error('Error in check-files:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
