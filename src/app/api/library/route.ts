import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { Database } from '@/types/supabase'

export type Track = Database['public']['Tables']['tracks']['Row']

export async function GET() {
  try {
    const supabase = await createClient()
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
