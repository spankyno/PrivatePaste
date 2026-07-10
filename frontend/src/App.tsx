import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { CreatePastePage } from '@/pages/CreatePaste'
import { ViewPastePage }   from '@/pages/ViewPaste'
import { AuthPage }        from '@/pages/Auth'
import { DashboardPage }   from '@/pages/Dashboard'
import { AboutPage }       from '@/pages/About'
import { Loader2 } from 'lucide-react'

/**
 * Vista de "/". No es una página en sí — redirige según el estado de
 * sesión: con cuenta va a /dashboard, sin cuenta a /about. El flujo de
 * creación de paste anónimo sigue disponible en /new.
 */
function HomeRoute() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-faint)]" />
      </div>
    )
  }
  return <Navigate to={user ? '/dashboard' : '/about'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen flex flex-col bg-[var(--bg)]">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route path="/"          element={<HomeRoute />} />
              <Route path="/new"       element={<CreatePastePage />} />
              <Route path="/p/:id"     element={<ViewPastePage />} />
              <Route path="/auth"          element={<AuthPage />} />
              <Route path="/dashboard"     element={<DashboardPage />} />
              <Route path="/about"     element={<AboutPage />} />
              <Route path="*" element={
                <div className="flex items-center justify-center min-h-[60vh] flex-col gap-4">
                  <p className="text-5xl">404</p>
                  <p className="text-[var(--text-muted)]">Page not found</p>
                  <a href="/" className="btn-primary">Go home</a>
                </div>
              } />
            </Routes>
          </main>
          <Footer />
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
