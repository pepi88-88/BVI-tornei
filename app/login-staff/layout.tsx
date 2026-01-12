// app/login-staff/layout.tsx
export const metadata = {
  title: 'Login Staff',
  description: 'Accesso area staff',
}

export default function LoginStaffLayout({ children }: { children: React.ReactNode }) {
  // ⚠️ NIENTE <html>/<body> QUI
  return (
    <div className="min-h-screen">
      {children}
    </div>
  )
}
