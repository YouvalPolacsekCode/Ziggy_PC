import React from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { 
  Home, 
  CheckSquare, 
  Brain, 
  Lightbulb, 
  FileText, 
  Settings, 
  MessageCircle,
  Clock
} from 'lucide-react';

const Layout = () => {
  const location = useLocation();

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

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Navigation Sidebar */}
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 flex flex-col">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-center h-16 px-4 bg-gray-800 flex-shrink-0">
            <h1 className="text-xl font-bold text-white">🤖 Ziggy Control</h1>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
            {navItems.map(({ path, icon: Icon, label }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <Icon className="w-5 h-5 mr-3 flex-shrink-0" />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="px-4 py-4 border-t border-gray-800 flex-shrink-0">
            <p className="text-xs text-gray-400 text-center">
              Ziggy Web Interface v1.0
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 ml-64">
        <div className="min-h-screen">
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};

export default Layout;