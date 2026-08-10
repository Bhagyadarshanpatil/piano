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

    const songMap = new Map<string, any>();
    
    for (const file of files) {
      if (!file.name.endsWith('.mid') && !file.name.endsWith('.midi')) continue;
      
      const { data } = supabase.storage.from('midi-files').getPublicUrl(file.name);
      const url = data.publicUrl;
      
      let baseName = file.name.replace(/\.midi?$/, '');
      let difficulty = 'expert';
      
      if (baseName.endsWith('_easy')) {
        baseName = baseName.replace('_easy', '');
        difficulty = 'easy';
      } else if (baseName.endsWith('_medium')) {
        baseName = baseName.replace('_medium', '');
        difficulty = 'medium';
      } else if (baseName.endsWith('_expert')) {
        baseName = baseName.replace('_expert', '');
        difficulty = 'expert';
      }
      
      if (!songMap.has(baseName)) {
        // Format title nicely, e.g., "rondo_alla_turca" -> "Rondo Alla Turca"
        const formattedTitle = baseName
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
          
        songMap.set(baseName, {
          id: baseName,
          title: formattedTitle,
          versions: {}
        });
      }
      
      songMap.get(baseName).versions[difficulty] = url;
    }
    
    const songs = Array.from(songMap.values());

    // Return the JSON list of songs
    return NextResponse.json(songs, { status: 200 });
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
