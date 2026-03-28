
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  { params }: { params: { detectionId: string } }
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

    const { data, error } = await supabaseAdmin
      .from('pds_detections')
      .select('status, total_submissions, processed_submissions, completed_at, error_message')
      .eq('id', detectionId)
      .single();

    if (error) {
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
