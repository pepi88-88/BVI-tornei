// app/admin/layout.tsx
// ❌ niente AdminNav: lo togliamo per eliminare la colonna riservata
// import AdminNav from '../../components/AdminNav'  // <-- RIMUOVI QUESTA RIGA

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // ⚠️ niente <html>/<body> qui (sono nel root layout)
  return (
    <div className="min-h-screen">
      {/* contenitore centrale che si centra grazie a .container-admin in globals.css */}
      <div className="container-admin">
       <main className="pt-[72px] pb-6">
  {children}
</main>
     </div>
    </div>
  )
}
