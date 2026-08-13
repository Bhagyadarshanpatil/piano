import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    
    // Authenticate user securely
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('recently_played')
      .select(`
        id,
        played_at,
        tracks (
          id,
          title,
          file_url,
          artist
        )
      `)
      .eq('user_id', user.id)
      .order('played_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Supabase error fetching recently played:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Format the data to match the frontend expectations
    const formattedData = data.map(item => ({
      id: item.tracks?.id,
      title: item.tracks?.title,
      artist: item.tracks?.artist,
      file_url: item.tracks?.file_url,
      played_at: item.played_at,
      history_id: item.id
    })).filter(item => item.id); // Filter out any null tracks

    return NextResponse.json(formattedData, { status: 200 });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    // Authenticate user securely
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { songId } = body;

    if (!songId) {
      return NextResponse.json({ error: 'songId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('recently_played')
      .insert([
        { user_id: user.id, song_id: songId }
      ])
      .select();

    if (error) {
      console.error('Supabase error inserting recently played:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
