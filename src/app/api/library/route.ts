import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Fetch directly from the "midi-files" storage bucket instead of the "tracks" table
    const { data: files, error } = await supabase
      .storage
      .from('midi-files')
      .list()

    if (error) {
      console.error('Supabase storage error:', error)
      return NextResponse.json({ error: 'Failed to fetch files from bucket' }, { status: 500 })
    }

    // Filter for .mid files and map them to the LibrarySong format
    const tracks = (files || [])
      .filter(f => f.name.toLowerCase().endsWith('.mid') || f.name.toLowerCase().endsWith('.midi'))
      .map(f => {
        const { data } = supabase.storage.from('midi-files').getPublicUrl(f.name);
        
        // Try to clean up the filename to make a nice title
        const cleanTitle = f.name
          .replace(/\.mid$|\.midi$/i, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()); // simple Title Case
          
        return {
          id: f.id || f.name,
          title: cleanTitle,
          artist: 'Unknown Artist',
          file_url: data.publicUrl
        }
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    return NextResponse.json({ tracks })
  } catch (error) {
    console.error('Unexpected error fetching library:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
