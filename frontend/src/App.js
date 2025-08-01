import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

// Theme Context
import { ThemeProvider } from "./contexts/ThemeContext";

// Layout
import Layout from "./components/Layout";

// Pages
import Dashboard from "./pages/Dashboard";
import TaskManager from "./pages/TaskManager";
import MemoryManager from "./pages/MemoryManager";
import SmartHomeDashboard from "./pages/SmartHomeDashboard";
import NotesManager from "./pages/NotesManager";
import SystemControl from "./pages/SystemControl";
import ChatPanel from "./pages/ChatPanel";
import ClockPage from "./pages/ClockPage";

function App() {
  return (
    <div className="App">
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="tasks" element={<TaskManager />} />
              <Route path="memory" element={<MemoryManager />} />
              <Route path="smarthome" element={<SmartHomeDashboard />} />
              <Route path="notes" element={<NotesManager />} />
              <Route path="system" element={<SystemControl />} />
              <Route path="chat" element={<ChatPanel />} />
              <Route path="clock" element={<ClockPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </div>
  );
}

export default App;
