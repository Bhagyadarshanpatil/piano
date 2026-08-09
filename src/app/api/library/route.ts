import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize the Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  try {
    // Fetch the list of files from the 'midi-files' storage bucket
    const { data: files, error } = await supabase.storage
      .from('midi-files')
      .list('');
      
    console.log('Raw files from bucket:', files);

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Format the response to match the expected LibrarySong type
    const songs = files
      .filter((file) => file.name.endsWith('.mid') || file.name.endsWith('.midi'))
      .map((file) => {
        const { data } = supabase.storage.from('midi-files').getPublicUrl(file.name);
        return {
          id: file.id || file.name,
          title: file.name.replace(/\.midi?$/, ''),
          file_url: data.publicUrl,
        };
      });

    // Return the JSON list of songs
    return NextResponse.json(songs, { status: 200 });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
