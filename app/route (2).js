import { NextResponse } from 'next/server';
import { fetchItemNotes, addItemNote } from '../../../../../lib/monday';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const notes = await fetchItemNotes(Number(params.id));
    return NextResponse.json({ notes });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { text } = await request.json();
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Escreva algo antes de salvar.' }, { status: 400 });
    }
    await addItemNote(Number(params.id), text.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
