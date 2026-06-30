import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { Navbar } from '@/components/layout/Navbar'
import { CreatePastePage } from '@/pages/CreatePaste'
import { ViewPastePage }   from '@/pages/ViewPaste'
import { AuthPage }        from '@/pages/Auth'
import { DashboardPage }   from '@/pages/Dashboard'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen flex flex-col bg-[var(--bg)]">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route path="/"           element={<CreatePastePage />} />
              <Route path="/p/:id"      element={<ViewPastePage />} />
              <Route path="/auth"       element={<AuthPage />} />
              <Route path="/dashboard"  element={<DashboardPage />} />
              {/* Catch-all */}
              <Route path="*" element={
                <div className="flex items-center justify-center min-h-[60vh] flex-col gap-4">
                  <p className="text-5xl">404</p>
                  <p className="text-[var(--text-muted)]">Page not found</p>
                  <a href="/" className="btn-primary">Go home</a>
                </div>
              } />
            </Routes>
          </main>

          {/* Footer */}
          <footer className="border-t border-[var(--border)] py-4 mt-8">
            <div className="max-w-6xl mx-auto px-4 flex items-center justify-between text-xs text-[var(--text-faint)]">
              <span>PrivatePaste — fast, private, edge-deployed</span>
              <div className="flex items-center gap-4">
                <a href="/api/health" className="hover:text-[var(--text-muted)] transition-colors">API status</a>
              </div>
            </div>
          </footer>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
