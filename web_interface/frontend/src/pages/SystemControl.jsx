import React, { useState, useEffect } from 'react';
import { 
  MdShowChart, 
  MdAccessTime, 
  MdCalendarToday,
  MdStorage,
  MdWifi,
  MdNetworkCheck,
  MdMonitor,
  MdPowerSettingsNew,
  MdRefresh,
  MdWarning,
  MdCheckCircle,
  MdBolt,
  MdActivity
} from 'react-icons/md';
import { systemAPI, sendIntent } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

const SystemControl = () => {
  const [systemData, setSystemData] = useState({
    status: null,
    time: null,
    date: null
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [pingDomain, setPingDomain] = useState('google.com');
  const [pingResult, setPingResult] = useState(null);

  useEffect(() => {
    loadSystemData();
    
    // Update time every second
    const timer = setInterval(() => {
      updateTimeAndDate();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const loadSystemData = async () => {
    setLoading(true);
    try {
      const [status, time, date] = await Promise.all([
        systemAPI.getStatus().catch(err => ({ message: 'Status unavailable' })),
        systemAPI.getTime().catch(err => ({ message: new Date().toLocaleTimeString() })),
        systemAPI.getDate().catch(err => ({ message: new Date().toLocaleDateString() }))
      ]);

      setSystemData({ status, time, date });
    } catch (err) {
      setError('Failed to load system data');
    } finally {
      setLoading(false);
    }
  };

  const updateTimeAndDate = async () => {
    try {
      const [time, date] = await Promise.all([
        systemAPI.getTime().catch(() => ({ message: new Date().toLocaleTimeString() })),
        systemAPI.getDate().catch(() => ({ message: new Date().toLocaleDateString() }))
      ]);
      
      setSystemData(prev => ({ ...prev, time, date }));
    } catch (err) {
      // Silent fail for time updates
    }
  };

  const handleSystemAction = async (action, actionName) => {
    if (action === 'shutdown' && !window.confirm('Are you sure you want to shutdown Ziggy? This will stop the system.')) {
      return;
    }
    if (action === 'restart' && !window.confirm('Are you sure you want to restart Ziggy? This will temporarily interrupt service.')) {
      return;
    }

    setActionLoading(action);
    try {
      let result;
      if (action === 'restart') {
        result = await systemAPI.restart();
      } else if (action === 'shutdown') {
        result = await systemAPI.shutdown();
      }
      
      setSuccess(`${actionName} command sent successfully`);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleNetworkAction = async (intent, params = {}) => {
    setActionLoading(intent);
    try {
      const result = await sendIntent(intent, params);
      setSuccess(result.message || `${intent} completed`);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setActionLoading(null);
    }
  };

  const handlePingTest = async () => {
    if (!pingDomain.trim()) return;
    
    const result = await handleNetworkAction('ping_test', { domain: pingDomain });
    setPingResult(result);
  };

  const systemActions = [
    {
      id: 'restart',
      name: 'Restart Ziggy',
      icon: MdRefresh,
      color: 'bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600',
      description: 'Restart the Ziggy system'
    },
    {
      id: 'shutdown',
      name: 'Shutdown Ziggy',
      icon: MdPowerSettingsNew,
      color: 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600',
      description: 'Shutdown the Ziggy system'
    }
  ];

  const networkActions = [
    {
      id: 'get_ip_address',
      name: 'IP Address',
      icon: MdNetworkCheck,
      color: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
    },
    {
      id: 'get_disk_usage',
      name: 'Disk Usage',
      icon: MdStorage,
      color: 'bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600'
    },
    {
      id: 'get_wifi_status',
      name: 'WiFi Status',
      icon: MdWifi,
      color: 'bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600'
    },
    {
      id: 'get_network_adapters',
      name: 'Network Adapters',
      icon: MdMonitor,
      color: 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600'
    }
  ];

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
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-6">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
            <MdActivity className="w-8 h-8 mr-3 text-green-600 dark:text-green-400" />
            System Control Panel
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Monitor system status and control Ziggy operations
          </p>
        </div>
        <button
          onClick={loadSystemData}
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors"
        >
          <MdRefresh className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <Alert
          type="error"
          message={error}
          onClose={() => setError(null)}
        />
      )}
      {success && (
        <Alert
          type="success"
          message={success}
          onClose={() => setSuccess(null)}
        />
      )}

      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* System Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <MdCheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">System Status</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {systemData.status?.message || 'Online'}
              </p>
            </div>
          </div>
        </div>

        {/* Current Time */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <MdAccessTime className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Current Time</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {systemData.time?.message || 'Loading...'}
              </p>
            </div>
          </div>
        </div>

        {/* Current Date */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <MdCalendarToday className="w-8 h-8 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Current Date</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {systemData.date?.message || 'Loading...'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* System Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
          <MdBolt className="w-6 h-6 mr-2 text-orange-500" />
          System Actions
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {systemActions.map((action) => {
            const Icon = action.icon;
            const isLoading = actionLoading === action.id;
            
            return (
              <button
                key={action.id}
                onClick={() => handleSystemAction(action.id, action.name)}
                disabled={isLoading || actionLoading !== null}
                className={`${action.color} text-white p-4 rounded-lg flex items-center space-x-3 transition-colors disabled:opacity-50`}
              >
                {isLoading ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Icon className="w-6 h-6" />
                )}
                <div className="text-left">
                  <div className="font-semibold">{action.name}</div>
                  <div className="text-xs opacity-90">{action.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Network Tools */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
          <MdNetworkCheck className="w-6 h-6 mr-2 text-blue-500" />
          Network Tools
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {networkActions.map((action) => {
            const Icon = action.icon;
            const isLoading = actionLoading === action.id;
            
            return (
              <button
                key={action.id}
                onClick={() => handleNetworkAction(action.id)}
                disabled={isLoading || actionLoading !== null}
                className={`${action.color} text-white p-4 rounded-lg flex flex-col items-center space-y-2 transition-colors disabled:opacity-50`}
              >
                {isLoading ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Icon className="w-6 h-6" />
                )}
                <span className="text-sm font-medium">{action.name}</span>
              </button>
            );
          })}
        </div>

        {/* Ping Test */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Ping Test</h3>
          <div className="flex space-x-3">
            <input
              type="text"
              value={pingDomain}
              onChange={(e) => setPingDomain(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter domain (e.g., google.com)"
            />
            <button
              onClick={handlePingTest}
              disabled={actionLoading === 'ping_test' || !pingDomain.trim()}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50"
            >
              {actionLoading === 'ping_test' ? (
                <LoadingSpinner size="sm" />
              ) : (
                <MdBolt className="w-4 h-4" />
              )}
              <span>Ping</span>
            </button>
          </div>
          
          {pingResult && (
            <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <strong>Result:</strong> {pingResult.message}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* System Information */}
      <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-yellow-900 dark:text-yellow-200 mb-2 flex items-center">
          <MdWarning className="w-5 h-5 mr-2" />
          Important Notes
        </h3>
        <ul className="text-sm text-yellow-800 dark:text-yellow-300 space-y-1">
          <li>• System actions will affect the Ziggy instance running on your local machine</li>
          <li>• Restart will temporarily interrupt all Ziggy services</li>
          <li>• Shutdown will completely stop Ziggy until manually restarted</li>
          <li>• Network tools help diagnose connectivity issues</li>
          <li>• All system information is retrieved in real-time</li>
        </ul>
      </div>
    </div>
  );
};

export default SystemControl;