import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"

import PrivateRoute from "@/components/PrivateRoute"
import { AuthProvider } from "@/context/AuthProvider"
import AppPage from "@/pages/AppPage"
import Dashboard from "@/pages/Dashboard"
import Forgot from "@/pages/Forgot"
import Landing from "@/pages/Landing"
import Login from "@/pages/Login"
import NotFound from "@/pages/NotFound"
import ResetPassword from "@/pages/ResetPassword"
import Signup from "@/pages/Signup"

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<Forgot />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/app"
            element={
              <PrivateRoute>
                <AppPage />
              </PrivateRoute>
            }
          />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
