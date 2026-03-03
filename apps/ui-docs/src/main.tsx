import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router"

import App from "./app"
import { ComponentPage } from "./pages/component-page"
import { Home } from "./pages/home"
import "./styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Home />} />
          <Route path="components/:slug" element={<ComponentPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
