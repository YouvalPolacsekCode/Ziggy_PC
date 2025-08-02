import React, { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { 
  MdHome, 
  MdCheckBox, 
  MdMemory, 
  MdLightbulb, 
  MdTextSnippet, 
  MdSettings, 
  MdMessage,
  MdAccessTime,
  MdMenu,
  MdClose,
  MdLightMode,
  MdDarkMode
} from 'react-icons/md';
import { useTheme } from '../contexts/ThemeContext';

const Layout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { isDarkMode, toggleDarkMode } = useTheme();

  const navItems = [
    { path: '/', icon: MdHome, label: 'Dashboard' },
    { path: '/tasks', icon: MdCheckBox, label: 'Tasks' },
    { path: '/memory', icon: MdMemory, label: 'Memory' },
    { path: '/smarthome', icon: MdLightbulb, label: 'Smart Home' },
    { path: '/notes', icon: MdTextSnippet, label: 'Notes' },
    { path: '/system', icon: MdSettings, label: 'System' },
    { path: '/chat', icon: MdMessage, label: 'Chat' },
    { path: '/clock', icon: MdAccessTime, label: 'Clock' }
  ];

  const sidebarWidth = sidebarCollapsed ? 'w-16' : 'w-44'; // Reduced from w-48 to w-44
  const mainMargin = sidebarCollapsed ? 'ml-16' : 'ml-44'; // Reduced accordingly

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex transition-colors">
      {/* Navigation Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 ${sidebarWidth} bg-gray-900 dark:bg-gray-800 flex flex-col transition-all duration-300 ease-in-out`}>
        <div className="flex flex-col h-full">
          {/* Logo & Toggle */}
          <div className="flex items-center justify-between h-16 px-3 bg-gray-800 dark:bg-gray-700 flex-shrink-0">
            {!sidebarCollapsed && (
              <h1 className="text-base font-bold text-white truncate">🤖 Ziggy</h1>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-gray-300 hover:text-white p-1 rounded transition-colors"
            >
              {sidebarCollapsed ? <MdMenu className="w-5 h-5" /> : <MdClose className="w-5 h-5" />}
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
                      : 'text-gray-300 hover:bg-gray-800 dark:hover:bg-gray-600 hover:text-white'
                  }`
                }
                title={sidebarCollapsed ? label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${sidebarCollapsed ? '' : 'mr-3'}`} />
                {!sidebarCollapsed && <span className="truncate">{label}</span>}
              </NavLink>
            ))}
          </nav>

          {/* Dark Mode Toggle & Footer */}
          <div className="px-2 py-3 border-t border-gray-800 dark:border-gray-600 flex-shrink-0 space-y-2">
            <button
              onClick={toggleDarkMode}
              className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'px-3'} py-2 text-sm font-medium rounded-md transition-colors text-gray-300 hover:bg-gray-800 dark:hover:bg-gray-600 hover:text-white`}
              title={sidebarCollapsed ? (isDarkMode ? 'Light Mode' : 'Dark Mode') : undefined}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              {!sidebarCollapsed && (
                <span className="ml-3">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
              )}
            </button>
            <p className={`text-xs text-gray-400 ${sidebarCollapsed ? 'text-center' : ''}`}>
              {sidebarCollapsed ? 'v1.0' : 'Ziggy Web v1.0'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`flex-1 ${mainMargin} transition-all duration-300 ease-in-out`}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <main className="w-full px-8 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};

export default Layout;