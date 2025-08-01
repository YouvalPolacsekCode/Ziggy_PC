import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  Calendar, 
  Sun, 
  Moon,
  RefreshCw,
  Globe
} from 'lucide-react';
import { systemAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

const ClockPage = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [ziggyTime, setZiggyTime] = useState(null);
  const [ziggyDate, setZiggyDate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);

  useEffect(() => {
    // Update local time every second
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Load Ziggy time initially
    loadZiggyTime();

    // Update Ziggy time every 30 seconds
    const ziggyTimer = setInterval(() => {
      loadZiggyTime();
    }, 30000);

    return () => {
      clearInterval(timer);
      clearInterval(ziggyTimer);
    };
  }, []);

  const loadZiggyTime = async () => {
    setLoading(true);
    try {
      const [time, date] = await Promise.all([
        systemAPI.getTime(),
        systemAPI.getDate()
      ]);
      
      setZiggyTime(time.message);
      setZiggyDate(date.message);
    } catch (err) {
      setError('Failed to load Ziggy time');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getDayOfWeek = (date) => {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  };

  const isNightTime = () => {
    const hour = currentTime.getHours();
    return hour < 6 || hour >= 18;
  };

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const timeZones = [
    { value: 'America/New_York', label: 'Eastern Time' },
    { value: 'America/Chicago', label: 'Central Time' },
    { value: 'America/Denver', label: 'Mountain Time' },
    { value: 'America/Los_Angeles', label: 'Pacific Time' },
    { value: 'Europe/London', label: 'London' },
    { value: 'Europe/Paris', label: 'Paris' },
    { value: 'Asia/Tokyo', label: 'Tokyo' },
    { value: 'Asia/Shanghai', label: 'Shanghai' },
    { value: 'Australia/Sydney', label: 'Sydney' }
  ];

  const getTimeInZone = (zone) => {
    return new Date().toLocaleTimeString('en-US', {
      timeZone: zone,
      hour12: true,
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-6">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
            <Clock className="w-8 h-8 mr-3 text-blue-600 dark:text-blue-400" />
            Clock & Date Tools
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            View current time, date, and timezone information
          </p>
        </div>
        <button
          onClick={loadZiggyTime}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Sync with Ziggy</span>
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert
          type="error"
          message={error}
          onClose={() => setError(null)}
        />
      )}

      {/* Main Clock Display */}
      <div className={`rounded-lg shadow-sm p-8 text-center ${
        isNightTime() 
          ? 'bg-gradient-to-br from-indigo-900 to-purple-900 text-white' 
          : 'bg-gradient-to-br from-blue-400 to-cyan-400 text-white'
      }`}>
        <div className="flex items-center justify-center mb-4">
          {isNightTime() ? (
            <Moon className="w-8 h-8 mr-3" />
          ) : (
            <Sun className="w-8 h-8 mr-3" />
          )}
          <h2 className="text-2xl font-semibold">{getGreeting()}!</h2>
        </div>
        
        <div className="mb-6">
          <div className="text-6xl md:text-8xl font-bold mb-2 font-mono">
            {formatTime(currentTime)}
          </div>
          <div className="text-xl md:text-2xl opacity-90">
            {formatDate(currentTime)}
          </div>
        </div>

        <div className="text-lg opacity-75">
          <Globe className="w-5 h-5 inline mr-2" />
          {timeZone}
        </div>
      </div>

      {/* Time Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Local Time Details */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
            <Clock className="w-6 h-6 mr-2 text-blue-600" />
            Local Time Details
          </h3>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Current Time:</span>
              <span className="font-mono text-lg text-gray-900">
                {formatTime(currentTime)}
              </span>
            </div>
            
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Date:</span>
              <span className="font-medium text-gray-900">
                {currentTime.toLocaleDateString()}
              </span>
            </div>
            
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Day of Week:</span>
              <span className="font-medium text-gray-900">
                {getDayOfWeek(currentTime)}
              </span>
            </div>
            
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Timezone:</span>
              <span className="font-medium text-gray-900">{timeZone}</span>
            </div>
            
            <div className="flex justify-between items-center py-2">
              <span className="text-gray-600">UTC Offset:</span>
              <span className="font-medium text-gray-900">
                {new Intl.DateTimeFormat('en', {timeZoneName: 'short'})
                  .formatToParts(currentTime)
                  .find(part => part.type === 'timeZoneName')?.value}
              </span>
            </div>
          </div>
        </div>

        {/* Ziggy Time */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-6 h-6 mr-2 text-purple-600" />
            Ziggy System Time
          </h3>
          
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-600">Ziggy Time:</span>
                <span className="font-mono text-lg text-gray-900">
                  {ziggyTime || 'N/A'}
                </span>
              </div>
              
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-600">Ziggy Date:</span>
                <span className="font-medium text-gray-900">
                  {ziggyDate || 'N/A'}
                </span>
              </div>
              
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-600">Sync Status:</span>
                <span className="font-medium text-green-600">
                  ✓ Connected
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* World Clock */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
          <Globe className="w-6 h-6 mr-2 text-green-600" />
          World Clock
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {timeZones.map((zone) => (
            <div key={zone.value} className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">
                {zone.label}
              </div>
              <div className="text-xl font-mono text-gray-900">
                {getTimeInZone(zone.value)}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {zone.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Clock Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">🕐 Time & Date Features</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Real-time clock updates every second</li>
          <li>• Comparison between local time and Ziggy system time</li>
          <li>• World clock showing multiple time zones</li>
          <li>• Automatic day/night theme based on current time</li>
          <li>• Time synchronization with Ziggy's internal clock</li>
        </ul>
      </div>
    </div>
  );
};

export default ClockPage;