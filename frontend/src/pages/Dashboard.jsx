import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  CheckSquare, 
  Brain, 
  Lightbulb, 
  MessageCircle,
  Clock,
  TrendingUp,
  Sun,
  Moon,
  Globe
} from 'lucide-react';
import { taskAPI, memoryAPI, systemAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

const Dashboard = () => {
  const [stats, setStats] = useState({
    tasks: { total: 0, completed: 0, pending: 0 },
    memories: 0,
    systemStatus: null
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);

  useEffect(() => {
    loadDashboardData();
    
    // Update time every second
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [tasks, memories, systemStatus] = await Promise.all([
        taskAPI.getAll().catch(() => []),
        memoryAPI.getAll().catch(() => []),
        systemAPI.getStatus().catch(() => ({ message: 'System status unavailable' }))
      ]);

      setStats({
        tasks: {
          total: tasks.length,
          completed: tasks.filter(t => t.completed).length,
          pending: tasks.filter(t => !t.completed).length
        },
        memories: memories.length,
        systemStatus
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Welcome to Ziggy Control
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Your AI-powered smart home assistant dashboard
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert
          type="error"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Tasks Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Tasks</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.tasks.total}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {stats.tasks.completed} completed, {stats.tasks.pending} pending
              </p>
            </div>
            <CheckSquare className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          {stats.tasks.total > 0 && (
            <div className="mt-4">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full"
                  style={{
                    width: `${(stats.tasks.completed / stats.tasks.total) * 100}%`
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Memory Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Memories</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.memories}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Stored memories</p>
            </div>
            <Brain className="w-8 h-8 text-purple-600 dark:text-purple-400" />
          </div>
        </div>

        {/* System Status Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">System</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400">Online</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {stats.systemStatus?.message || 'Status unavailable'}
              </p>
            </div>
            <Activity className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
        </div>

        {/* Quick Actions Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Quick Chat</p>
              <p className="text-lg font-bold text-orange-600 dark:text-orange-400">Ready</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">AI assistant available</p>
            </div>
            <MessageCircle className="w-8 h-8 text-orange-600 dark:text-orange-400" />
          </div>
        </div>
      </div>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Recent Tasks */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Recent Tasks
          </h3>
          <div className="space-y-3">
            {stats.tasks.total === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">No tasks yet</p>
            ) : (
              <p className="text-blue-600 dark:text-blue-400 text-sm cursor-pointer hover:underline">
                View all {stats.tasks.total} tasks →
              </p>
            )}
          </div>
        </div>

        {/* Smart Home Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Smart Home
          </h3>
          <div className="flex items-center space-x-2">
            <Lightbulb className="w-5 h-5 text-yellow-500" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Lights & Controls</span>
          </div>
          <p className="text-blue-600 dark:text-blue-400 text-sm cursor-pointer hover:underline mt-2">
            Manage devices →
          </p>
        </div>

        {/* System Information */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            System Info
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-300">Status:</span>
              <span className="text-green-600 dark:text-green-400 font-medium">Operational</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-300">Uptime:</span>
              <span className="text-gray-900 dark:text-white">Active</span>
            </div>
          </div>
        </div>
      </div>

      {/* Welcome Message */}
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-sm p-6 text-white">
        <h2 className="text-xl font-semibold mb-2">
          🤖 Ready to help you manage your smart home!
        </h2>
        <p className="text-blue-100 mb-4">
          Use the navigation menu to access tasks, memory, smart home controls, chat, and more.
        </p>
        <div className="flex space-x-4">
          <button className="bg-white bg-opacity-20 hover:bg-opacity-30 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Start Chat
          </button>
          <button className="bg-white bg-opacity-20 hover:bg-opacity-30 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            Add Task
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;