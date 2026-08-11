import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // ── Protect /profile and /onboarding — must be logged in ─────────────────
  if (!user && (path.startsWith('/profile') || path.startsWith('/onboarding'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // ── Logged-in users visiting /login or /signup → check onboarding ────────
  if (user && (path.startsWith('/login') || path.startsWith('/signup'))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_complete')
      .eq('id', user.id)
      .maybeSingle()

    const url = request.nextUrl.clone()
    url.pathname = (!profile || !profile.onboarding_complete) ? '/onboarding' : '/visualizer'
    return NextResponse.redirect(url)
  }

  // ── Logged-in users on /visualizer who haven't completed onboarding ───────
  if (user && path.startsWith('/visualizer')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_complete')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || !profile.onboarding_complete) {
      const url = request.nextUrl.clone()
      url.pathname = '/onboarding'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
