
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = (session.user.role || '').toUpperCase();
    if (!role.includes('GURU') && !role.includes('TEACHER') && !role.includes('ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { flag_id, action, notes, is_false_positive } = body;

    if (!flag_id || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Update Flag
    const { data: updatedFlag, error: flagError } = await supabaseAdmin
      .from('pds_flags')
      .update({
        reviewed: true,
        reviewed_at: new Date().toISOString(),
        reviewed_by: session.user.id,
        status: is_false_positive ? 'false_positive' : 'reviewed',
        is_false_positive: !!is_false_positive,
        teacher_notes: notes,
        action_taken: action
      })
      .eq('id', flag_id)
      .select()
      .single();

    if (flagError) {
      throw new Error(`Failed to update flag: ${flagError.message}`);
    }

    // 2. Log Teacher Action
    const { error: actionError } = await supabaseAdmin
      .from('pds_teacher_actions')
      .insert({
        flag_id: flag_id,
        teacher_id: session.user.id,
        action: action, // e.g., 'marked_false_positive', 'warning_sent'
        notes: notes
      });

    if (actionError) {
       console.error('Failed to log teacher action:', actionError);
       // Non-blocking error, we continue
    }

    // 3. Log Audit
    await supabaseAdmin.from('pds_audit_logs').insert({
      user_id: session.user.id,
      action: 'update_flag',
      entity_type: 'flag',
      entity_id: flag_id,
      metadata: { action, is_false_positive }
    });

    return NextResponse.json({ success: true, flag: updatedFlag });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
