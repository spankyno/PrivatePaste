import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/hooks/useAuth'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { CreatePastePage } from '@/pages/CreatePaste'
import { ViewPastePage }   from '@/pages/ViewPaste'
import { EditPastePage }   from '@/pages/EditPaste'
import { AuthPage }        from '@/pages/Auth'
import { DashboardPage }   from '@/pages/Dashboard'
import { AboutPage }       from '@/pages/About'

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
              <Route path="/p/:id/edit" element={<EditPastePage />} />
              <Route path="/auth"       element={<AuthPage />} />
              <Route path="/dashboard"  element={<DashboardPage />} />
              <Route path="/about"      element={<AboutPage />} />
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

          <Footer />
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
