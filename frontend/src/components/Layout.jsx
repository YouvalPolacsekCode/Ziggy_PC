import React, { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { 
  Home, 
  CheckSquare, 
  Brain, 
  Lightbulb, 
  FileText, 
  Settings, 
  MessageCircle,
  Clock,
  Menu,
  X
} from 'lucide-react';

const Layout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const navItems = [
    { path: '/', icon: Home, label: 'Dashboard' },
    { path: '/tasks', icon: CheckSquare, label: 'Tasks' },
    { path: '/memory', icon: Brain, label: 'Memory' },
    { path: '/smarthome', icon: Lightbulb, label: 'Smart Home' },
    { path: '/notes', icon: FileText, label: 'Notes' },
    { path: '/system', icon: Settings, label: 'System' },
    { path: '/chat', icon: MessageCircle, label: 'Chat' },
    { path: '/clock', icon: Clock, label: 'Clock' }
  ];

  const sidebarWidth = sidebarCollapsed ? 'w-16' : 'w-64';
  const mainMargin = sidebarCollapsed ? 'ml-16' : 'ml-64';

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Navigation Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 ${sidebarWidth} bg-gray-900 flex flex-col transition-all duration-300 ease-in-out`}>
        <div className="flex flex-col h-full">
          {/* Logo & Toggle */}
          <div className="flex items-center justify-between h-16 px-3 bg-gray-800 flex-shrink-0">
            {!sidebarCollapsed && (
              <h1 className="text-lg font-bold text-white truncate">🤖 Ziggy Control</h1>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-gray-300 hover:text-white p-1 rounded transition-colors"
            >
              {sidebarCollapsed ? <Menu className="w-5 h-5" /> : <X className="w-5 h-5" />}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
            {navItems.map(({ path, icon: Icon, label }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'px-3'} py-2 text-sm font-medium rounded-md transition-colors group ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${sidebarCollapsed ? '' : 'mr-3'}`} />
                {!sidebarCollapsed && <span className="truncate">{label}</span>}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="px-2 py-3 border-t border-gray-800 flex-shrink-0">
            <p className={`text-xs text-gray-400 ${sidebarCollapsed ? 'text-center' : ''}`}>
              {sidebarCollapsed ? 'v1.0' : 'Ziggy Web Interface v1.0'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`flex-1 ${mainMargin} transition-all duration-300 ease-in-out`}>
        <div className="min-h-screen">
          <main className="max-w-full mx-auto px-6 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};

export default Layout;