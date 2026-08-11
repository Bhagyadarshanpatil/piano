'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { LogOut } from 'lucide-react'

export default function LogOutButton() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)

  const handleLogOut = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogOut}
      disabled={loading}
      className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 rounded-xl transition-all font-medium disabled:opacity-50"
    >
      <LogOut className="w-4 h-4" />
      {loading ? 'Disconnecting...' : 'Log Out'}
    </button>
  )
}
