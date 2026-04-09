import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/prisma';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const courseId = request.nextUrl.searchParams.get('courseId');
    if (!courseId) {
      return NextResponse.json({ success: false, error: 'Missing courseId' }, { status: 400 });
    }

    const supportedExtensions = ['.pdf', '.docx', '.doc', '.txt', '.md', '.pptx'];

    // Fetch sessions with resources for this course
    const sessions = await prisma.sessions.findMany({
      where: {
        class_courses: {
          courses: { id: parseInt(courseId) },
        },
      },
      select: {
        id: true,
        title: true,
        session_number: true,
        resources: {
          select: {
            id: true,
            file_name: true,
            file_url: true,
            file_type: true,
            file_tittle: true,
          },
        },
      },
      orderBy: { session_number: 'asc' },
    });

    // Filter resources to supported file types and shape output
    const result = sessions
      .map(s => ({
        session_id: s.id,
        session_title: s.title,
        session_number: s.session_number,
        resources: s.resources
          .filter(r => supportedExtensions.includes(path.extname(r.file_name).toLowerCase()))
          .map(r => ({
            id: r.id,
            file_name: r.file_name,
            file_title: r.file_tittle || r.file_name,
            file_type: r.file_type,
          })),
      }))
      .filter(s => s.resources.length > 0); // hide sessions with no supported files

    return NextResponse.json({ success: true, data: result });

  } catch (error: any) {
    console.error('Error fetching course materials:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
