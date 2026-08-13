import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Initialize Supabase client
// Note: We use the environment variables configured in .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Create client only if credentials are available
let supabase: any = null

if (supabaseUrl && supabaseAnonKey) {
  const formattedUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '')
  supabase = createClient(formattedUrl, supabaseAnonKey)
}

export type Track = {
  id: string
  title: string
  artist: string
  genre?: string
  difficulty_level?: string
  file_url: string
}

export async function GET() {
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }
  try {
    const { data: tracks, error } = await supabase
      .from('tracks')
      .select('*')
      .order('title', { ascending: true })

    if (error) {
      console.error('Supabase query error:', error)
      return NextResponse.json({ error: 'Failed to fetch tracks' }, { status: 500 })
    }

    return NextResponse.json({ tracks })
  } catch (error) {
    console.error('Server error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
