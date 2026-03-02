import { Outlet } from "react-router"
import { ToastProvider, TooltipProvider } from "@superserve/ui"
import { Sidebar } from "./components/layout/sidebar"

export default function App() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <div className="flex h-screen bg-background text-foreground">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </TooltipProvider>
    </ToastProvider>
  )
}
