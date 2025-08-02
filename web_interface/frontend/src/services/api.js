import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API_BASE = `${BACKEND_URL}/api`;

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging
api.interceptors.request.use((config) => {
  console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// ================================
// Intent API
// ================================

export const sendIntent = async (intent, params = {}) => {
  try {
    const response = await api.post('/intent', {
      intent,
      params,
      source: 'web_app'
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.detail || error.message);
  }
};

// ================================
// Task Management API
// ================================

export const taskAPI = {
  getAll: async () => {
    const response = await api.get('/tasks');
    return response.data;
  },

  create: async (taskData) => {
    const response = await api.post('/tasks', taskData);
    return response.data;
  },

  complete: async (taskId) => {
    const response = await api.put(`/tasks/${taskId}/complete`);
    return response.data;
  },

  delete: async (taskId) => {
    const response = await api.delete(`/tasks/${taskId}`);
    return response.data;
  },

  deleteAll: async () => {
    const response = await api.delete('/tasks');
    return response.data;
  }
};

// ================================
// Memory Management API
// ================================

export const memoryAPI = {
  getAll: async () => {
    const response = await api.get('/memory');
    return response.data;
  },

  create: async (memoryData) => {
    const response = await api.post('/memory', memoryData);
    return response.data;
  },

  get: async (key) => {
    const response = await api.get(`/memory/${key}`);
    return response.data;
  },

  delete: async (key) => {
    const response = await api.delete(`/memory/${key}`);
    return response.data;
  }
};

// ================================
// Notes API
// ================================

export const notesAPI = {
  getAll: async () => {
    const response = await api.get('/notes');
    return response.data;
  },

  create: async (noteData) => {
    const response = await api.post('/notes', noteData);
    return response.data;
  },

  delete: async (noteId) => {
    const response = await api.delete(`/notes/${noteId}`);
    return response.data;
  }
};

// ================================
// Smart Home API
// ================================

export const smartHomeAPI = {
  controlLights: async (room, action, params = {}) => {
    const response = await api.post('/smarthome/lights', {
      room,
      action,
      params
    });
    return response.data;
  },

  controlAC: async (action, params = {}) => {
    const response = await api.post('/smarthome/ac', {
      action,
      params
    });
    return response.data;
  },

  controlTV: async (action, params = {}) => {
    const response = await api.post('/smarthome/tv', {
      action,
      params
    });
    return response.data;
  },

  getSensors: async (room, sensorType = 'temperature') => {
    const response = await api.get(`/smarthome/sensors/${room}?sensor_type=${sensorType}`);
    return response.data;
  }
};

// ================================
// Chat API
// ================================

export const chatAPI = {
  sendMessage: async (message) => {
    const response = await api.post('/chat', { message });
    return response.data;
  },

  getHistory: async (limit = 50) => {
    const response = await api.get(`/chat/history?limit=${limit}`);
    return response.data;
  }
};

// ================================
// System API
// ================================

export const systemAPI = {
  getStatus: async () => {
    const response = await api.get('/system/status');
    return response.data;
  },

  getTime: async () => {
    const response = await api.get('/system/time');
    return response.data;
  },

  getDate: async () => {
    const response = await api.get('/system/date');
    return response.data;
  },

  restart: async () => {
    const response = await api.post('/system/restart');
    return response.data;
  },

  shutdown: async () => {
    const response = await api.post('/system/shutdown');
    return response.data;
  }
};

export default api;