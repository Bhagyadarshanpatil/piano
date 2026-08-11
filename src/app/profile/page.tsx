import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import LogOutButton from './LogOutButton'
import { 
  UserCircle, Sparkles, Settings, CreditCard, 
  Bell, Shield, ChevronRight, ArrowLeft 
} from 'lucide-react'
import Link from 'next/link'

export default async function ProfilePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col md:flex-row font-sans">
      
      {/* ── Sidebar Navigation ────────────────────────────────────── */}
      <aside className="w-full md:w-72 bg-white/5 border-r border-white/10 p-6 flex flex-col hidden md:flex shrink-0 z-20 backdrop-blur-xl">
        <Link href="/" className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-200 to-cyan-200 mb-12">
          Sonaris Piano
        </Link>
        
        <nav className="flex-1 space-y-2">
          <div className="px-3 py-2 text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Settings</div>
          <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/10 text-white font-medium">
            <span className="flex items-center gap-3"><Settings className="w-4 h-4 text-emerald-400" /> Account</span>
          </button>
          <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-white/60 hover:bg-white/5 hover:text-white font-medium transition-colors">
            <span className="flex items-center gap-3"><CreditCard className="w-4 h-4" /> Subscription</span>
          </button>
          <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-white/60 hover:bg-white/5 hover:text-white font-medium transition-colors">
            <span className="flex items-center gap-3"><Bell className="w-4 h-4" /> Preferences</span>
          </button>
        </nav>

        <div className="mt-auto">
          <Link href="/visualizer" className="flex items-center gap-2 text-sm text-white/60 hover:text-emerald-300 transition-colors py-4">
            <ArrowLeft className="w-4 h-4" /> Back to Visualizer
          </Link>
          <LogOutButton />
        </div>
      </aside>

      {/* ── Main Content Area ─────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto relative p-6 md:p-12 z-10">
        
        {/* Background Magic */}
        <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
          <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-fuchsia-900/20 via-transparent to-transparent" />
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-900/10 rounded-full blur-[120px]" />
        </div>

        <div className="max-w-3xl mx-auto relative z-10">
          
          {/* Mobile Nav */}
          <div className="md:hidden flex justify-between items-center mb-8 border-b border-white/10 pb-4">
            <Link href="/" className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-200 to-cyan-200">
              Sonaris Piano
            </Link>
            <Link href="/visualizer" className="text-sm text-white/60 hover:text-white">
              Visualizer
            </Link>
          </div>

          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Account Settings</h1>
            <p className="text-white/50">Manage your profile, security preferences, and magical connections.</p>
          </div>

          <div className="space-y-8">
            
            {/* Profile Section */}
            <section className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md">
              <div className="p-6 md:p-8 flex flex-col md:flex-row items-center md:items-start gap-6">
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-fuchsia-500/20 to-purple-600/20 border border-fuchsia-500/30 flex items-center justify-center shrink-0 shadow-[0_0_30px_rgba(217,70,239,0.15)] relative">
                  <UserCircle className="w-12 h-12 text-fuchsia-300" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 bg-emerald-500 rounded-full border-2 border-neutral-900 flex items-center justify-center" title="Online">
                    <Sparkles className="w-3 h-3 text-white" />
                  </div>
                </div>
                <div className="flex-1 text-center md:text-left">
                  <h2 className="text-xl font-semibold mb-1">Mage Scholar</h2>
                  <p className="text-white/50 mb-4">{user.email}</p>
                  <button className="px-4 py-2 bg-white/10 hover:bg-white/20 text-sm font-medium rounded-lg transition-colors border border-white/5">
                    Change Avatar
                  </button>
                </div>
              </div>
            </section>

            {/* Security Section */}
            <section className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md">
              <div className="p-6 md:p-8">
                <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-emerald-400" /> Security
                </h3>
                
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">Email Address</p>
                      <p className="text-sm text-white/50">Used to sign in to Sonaris Piano.</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-white/70">{user.email}</span>
                      <button className="text-sm text-emerald-400 hover:text-emerald-300 font-medium px-3 py-1.5 rounded-lg hover:bg-emerald-400/10 transition-colors">
                        Edit
                      </button>
                    </div>
                  </div>
                  
                  <div className="h-px bg-white/10" />
                  
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">Password</p>
                      <p className="text-sm text-white/50">Ensure your account uses a long, random password.</p>
                    </div>
                    <button className="text-sm text-emerald-400 hover:text-emerald-300 font-medium px-4 py-2 rounded-lg bg-emerald-400/10 hover:bg-emerald-400/20 transition-colors whitespace-nowrap border border-emerald-400/20">
                      Update Password
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Subscription Section */}
            <section className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-teal-500/5 pointer-events-none" />
              <div className="p-6 md:p-8">
                <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-teal-400" /> Subscription Plan
                </h3>
                
                <div className="bg-black/40 border border-white/5 rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h4 className="font-bold text-lg text-teal-300">Free Tier</h4>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-xs font-semibold text-white/70">Current</span>
                    </div>
                    <p className="text-sm text-white/60">Access to standard tracks and visualizer features.</p>
                  </div>
                  <button className="w-full md:w-auto px-6 py-2.5 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-emerald-500/25 border border-white/10">
                    Upgrade to Premium
                  </button>
                </div>
              </div>
            </section>

          </div>
        </div>
      </main>
    </div>
  )
}
