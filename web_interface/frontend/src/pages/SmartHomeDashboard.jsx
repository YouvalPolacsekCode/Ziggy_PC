import React, { useState, useEffect } from 'react';
import { 
  MdLightbulb, 
  MdAir, 
  MdTv, 
  MdThermostat,
  MdOpacity,
  MdPowerSettingsNew,
  MdPalette,
  MdWbSunny,
  MdRefresh
} from 'react-icons/md';
import { smartHomeAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

const SmartHomeDashboard = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [sensorData, setSensorData] = useState({});
  const [lightSettings, setLightSettings] = useState({
    room: 'living_room',
    color: 'white',
    brightness: 100
  });
  const [acSettings, setAcSettings] = useState({
    temperature: 24
  });
  const [tvSettings, setTvSettings] = useState({
    source: 1
  });

  const rooms = [
    { id: 'living_room', name: 'Living Room' },
    { id: 'bedroom', name: 'Bedroom' },
    { id: 'kitchen', name: 'Kitchen' },
    { id: 'bathroom', name: 'Bathroom' },
    { id: 'office', name: 'Office' }
  ];

  const lightColors = [
    { id: 'white', name: 'White', color: 'bg-gray-100 border-gray-300' },
    { id: 'red', name: 'Red', color: 'bg-red-500' },
    { id: 'green', name: 'Green', color: 'bg-green-500' },
    { id: 'blue', name: 'Blue', color: 'bg-blue-500' },
    { id: 'yellow', name: 'Yellow', color: 'bg-yellow-400' },
    { id: 'orange', name: 'Orange', color: 'bg-orange-500' },
    { id: 'purple', name: 'Purple', color: 'bg-purple-500' },
    { id: 'pink', name: 'Pink', color: 'bg-pink-500' }
  ];

  const tvSources = [
    { id: 1, name: 'HDMI 1' },
    { id: 2, name: 'HDMI 2' },
    { id: 3, name: 'HDMI 3' },
    { id: 4, name: 'USB' }
  ];

  useEffect(() => {
    loadSensorData();
  }, []);

  const loadSensorData = async () => {
    try {
      const sensorPromises = rooms.map(async (room) => {
        try {
          const [temperature, humidity] = await Promise.all([
            smartHomeAPI.getSensors(room.id, 'temperature'),
            smartHomeAPI.getSensors(room.id, 'humidity')
          ]);
          return {
            room: room.id,
            temperature: temperature.message || 'N/A',
            humidity: humidity.message || 'N/A'
          };
        } catch (err) {
          return {
            room: room.id,
            temperature: 'N/A',
            humidity: 'N/A'
          };
        }
      });

      const sensors = await Promise.all(sensorPromises);
      const sensorMap = {};
      sensors.forEach(sensor => {
        sensorMap[sensor.room] = {
          temperature: sensor.temperature,
          humidity: sensor.humidity
        };
      });
      setSensorData(sensorMap);
    } catch (err) {
      console.error('Error loading sensor data:', err);
    }
  };

  const handleLightToggle = async (room) => {
    setLoading(true);
    try {
      const result = await smartHomeAPI.controlLights(room, 'toggle', { turn_on: true });
      setSuccess(`Light toggled in ${room.replace('_', ' ')}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLightColor = async () => {
    setLoading(true);
    try {
      const result = await smartHomeAPI.controlLights(
        lightSettings.room, 
        'set_color', 
        { color: lightSettings.color }
      );
      setSuccess(`Light color set to ${lightSettings.color} in ${lightSettings.room.replace('_', ' ')}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLightBrightness = async () => {
    setLoading(true);
    try {
      const result = await smartHomeAPI.controlLights(
        lightSettings.room, 
        'set_brightness', 
        { brightness: lightSettings.brightness }
      );
      setSuccess(`Light brightness set to ${lightSettings.brightness}% in ${lightSettings.room.replace('_', ' ')}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleACToggle = async () => {
    setLoading(true);
    try {
      const result = await smartHomeAPI.controlAC('toggle', { turn_on: true });
      setSuccess('AC toggled');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleACTemperature = async () => {
    setLoading(true);
    try {
      const result = await smartHomeAPI.controlAC('set_temperature', { temperature: acSettings.temperature });
      setSuccess(`AC temperature set to ${acSettings.temperature}°C`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTVToggle = async () => {
    setLoading(true);
    try {
      const result = await smartHomeAPI.controlTV('toggle', { turn_on: true });
      setSuccess('TV toggled');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTVSource = async () => {
    setLoading(true);
    try {
      const result = await smartHomeAPI.controlTV('set_source', { source: tvSettings.source });
      setSuccess(`TV source set to ${tvSources.find(s => s.id === tvSettings.source)?.name}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Smart Home Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Control your lights, AC, TV, and monitor sensors
          </p>
        </div>
        <button
          onClick={loadSensorData}
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors"
        >
          <MdRefresh className="w-4 h-4" />
          <span>Refresh Sensors</span>
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

      {/* Room Sensors */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {rooms.map((room) => (
          <div key={room.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{room.name}</h3>
              <button
                onClick={() => handleLightToggle(room.id)}
                disabled={loading}
                className="bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-700 text-white p-2 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
              >
                <MdLightbulb className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between min-h-[1.5rem]">
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <MdThermostat className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-300">Temperature</span>
                </div>
                <div className="text-right min-w-0 flex-1 ml-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white block truncate">
                    {(() => {
                      const temp = sensorData[room.id]?.temperature || 'Loading...';
                      return temp.length > 15 ? 'Unavailable' : temp;
                    })()}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center justify-between min-h-[1.5rem]">
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <MdOpacity className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-300">Humidity</span>
                </div>
                <div className="text-right min-w-0 flex-1 ml-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white block truncate">
                    {(() => {
                      const humidity = sensorData[room.id]?.humidity || 'Loading...';
                      return humidity.length > 15 ? 'Unavailable' : humidity;
                    })()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Light Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
          <MdLightbulb className="w-6 h-6 mr-2 text-yellow-500" />
          Light Controls
        </h2>
        
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Room Selection */}
          <div className="flex flex-col h-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select Room
            </label>
            <div className="flex-1 flex flex-col justify-between space-y-4">
              <select
                value={lightSettings.room}
                onChange={(e) => setLightSettings({...lightSettings, room: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
              >
                {rooms.map(room => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Color Selection */}
          <div className="flex flex-col h-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Color
            </label>
            <div className="flex-1 flex flex-col justify-between space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {lightColors.map(color => (
                  <button
                    key={color.id}
                    onClick={() => setLightSettings({...lightSettings, color: color.id})}
                    className={`w-12 h-8 rounded border-2 ${color.color} ${
                      lightSettings.color === color.id ? 'ring-2 ring-yellow-500' : ''
                    } transition-all flex-shrink-0`}
                    title={color.name}
                  />
                ))}
              </div>
              <button
                onClick={handleLightColor}
                disabled={loading}
                className="w-full bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? <LoadingSpinner size="sm" /> : 'Set Color'}
              </button>
            </div>
          </div>

          {/* Brightness Control */}
          <div className="flex flex-col h-full">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Brightness: {lightSettings.brightness}%
            </label>
            <div className="flex-1 flex flex-col justify-between space-y-4">
              <input
                type="range"
                min="0"
                max="100"
                value={lightSettings.brightness}
                onChange={(e) => setLightSettings({...lightSettings, brightness: parseInt(e.target.value)})}
                className="w-full"
              />
              <button
                onClick={handleLightBrightness}
                disabled={loading}
                className="w-full bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-600 dark:hover:bg-yellow-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? <LoadingSpinner size="sm" /> : 'Set Brightness'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AC and TV Controls */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* AC Controls */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
            <MdAir className="w-6 h-6 mr-2 text-blue-500" />
            Air Conditioning
          </h2>
          
          <div className="space-y-4">
            <button
              onClick={handleACToggle}
              disabled={loading}
              className="w-full bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white py-3 rounded-lg flex items-center justify-center space-x-2 transition-colors disabled:opacity-50"
            >
              <MdPowerSettingsNew className="w-5 h-5" />
              <span>Toggle AC</span>
              {loading && <LoadingSpinner size="sm" />}
            </button>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Temperature: {acSettings.temperature}°C
              </label>
              <input
                type="range"
                min="16"
                max="30"
                value={acSettings.temperature}
                onChange={(e) => setAcSettings({...acSettings, temperature: parseInt(e.target.value)})}
                className="w-full mb-3"
              />
              <button
                onClick={handleACTemperature}
                disabled={loading}
                className="w-full bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? <LoadingSpinner size="sm" /> : 'Set Temperature'}
              </button>
            </div>
          </div>
        </div>

        {/* TV Controls */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center">
            <MdTv className="w-6 h-6 mr-2 text-gray-700 dark:text-gray-400" />
            Television
          </h2>
          
          <div className="space-y-4">
            <button
              onClick={handleTVToggle}
              disabled={loading}
              className="w-full bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 text-white py-3 rounded-lg flex items-center justify-center space-x-2 transition-colors disabled:opacity-50"
            >
              <MdPowerSettingsNew className="w-5 h-5" />
              <span>Toggle TV</span>
              {loading && <LoadingSpinner size="sm" />}
            </button>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Input Source
              </label>
              <select
                value={tvSettings.source}
                onChange={(e) => setTvSettings({...tvSettings, source: parseInt(e.target.value)})}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500 mb-3"
              >
                {tvSources.map(source => (
                  <option key={source.id} value={source.id}>{source.name}</option>
                ))}
              </select>
              <button
                onClick={handleTVSource}
                disabled={loading}
                className="w-full bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 text-white py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? <LoadingSpinner size="sm" /> : 'Set Source'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Status Information */}
      <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-2">🏠 Smart Home Status</h3>
        <p className="text-sm text-blue-800 dark:text-blue-300 mb-2">
          This dashboard controls your connected smart home devices through Ziggy's Home Assistant integration.
        </p>
        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
          <li>• Light controls work with room-specific smart bulbs</li>
          <li>• AC controls connect to your climate control system</li>
          <li>• TV controls work with compatible smart TVs or media players</li>
          <li>• Sensor data shows real-time temperature and humidity readings</li>
        </ul>
      </div>
    </div>
  );
};

export default SmartHomeDashboard;