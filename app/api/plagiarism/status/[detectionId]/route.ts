
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getDetectionStatus } from '@/lib/db2/pds-repo';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ detectionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { detectionId } = await params;

    if (!detectionId) {
      return NextResponse.json({ error: 'Missing detection ID' }, { status: 400 });
    }

    const data = await getDetectionStatus(detectionId);

    if (!data) {
      return NextResponse.json({ error: 'Detection not found' }, { status: 404 });
    }

    return NextResponse.json(data);

  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
