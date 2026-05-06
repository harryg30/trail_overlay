import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { query } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { osmWayId, updates } = body as {
      osmWayId?: string;
      updates?: { name?: string; difficulty?: string; type?: string };
    };

    if (!osmWayId || !updates || typeof updates !== 'object') {
      return NextResponse.json(
        { error: 'Body must include osmWayId and updates' },
        { status: 400 }
      );
    }

    const allowedDifficulty = ['easy', 'intermediate', 'hard', 'pro', 'not_set'];
    const allowedType = ['mtb', 'hiking', 'mixed'];
    if (updates.difficulty && !allowedDifficulty.includes(updates.difficulty)) {
      return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
    }
    if (updates.type && !allowedType.includes(updates.type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const drafts = await query<any>(
      `SELECT trails FROM trail_import_drafts WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (drafts.length === 0) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    const trails = (drafts[0].trails ?? []) as any[];
    let found = false;
    const updated = trails.map((t) => {
      if (t.osmWayId !== osmWayId) return t;
      found = true;
      return {
        ...t,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.difficulty !== undefined ? { difficulty: updates.difficulty } : {}),
        ...(updates.type !== undefined ? { type: updates.type } : {}),
      };
    });
    if (!found) {
      return NextResponse.json(
        { error: 'Trail not found in draft' },
        { status: 404 }
      );
    }

    await query(
      `UPDATE trail_import_drafts SET trails = $1 WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(updated), id, userId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Import Draft Patch] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update draft' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Delete the draft (only if owned by user)
    const result = await query(
      `DELETE FROM trail_import_drafts
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, userId]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Draft not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Import Draft Delete] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete draft' },
      { status: 500 }
    );
  }
}
