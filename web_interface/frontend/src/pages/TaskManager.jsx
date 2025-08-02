import React, { useState, useEffect } from 'react';
import { 
  MdAdd, 
  MdCheckBox, 
  MdCheckBoxOutlineBlank, 
  MdDelete, 
  MdCalendarToday,
  MdAccessTime,
  MdFlag,
  MdRefresh
} from 'react-icons/md';
import { taskAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

const TaskManager = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTask, setNewTask] = useState({
    task: '',
    priority: 'medium',
    due: '',
    reminder: '',
    notes: '',
    repeat: ''
  });

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await taskAPI.getAll();
      setTasks(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTask.task.trim()) return;

    setSubmitting(true);
    try {
      const task = await taskAPI.create(newTask);
      setTasks([...tasks, task]);
      setNewTask({
        task: '',
        priority: 'medium',
        due: '',
        reminder: '',
        notes: '',
        repeat: ''
      });
      setShowAddForm(false);
      setSuccess('Task added successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteTask = async (taskId) => {
    try {
      await taskAPI.complete(taskId);
      setTasks(tasks.map(task => 
        task.id === taskId ? { ...task, completed: true } : task
      ));
      setSuccess('Task marked as completed!');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;

    try {
      await taskAPI.delete(taskId);
      setTasks(tasks.filter(task => task.id !== taskId));
      setSuccess('Task deleted successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteAllTasks = async () => {
    if (!window.confirm('Are you sure you want to delete ALL tasks?')) return;

    try {
      await taskAPI.deleteAll();
      setTasks([]);
      setSuccess('All tasks deleted successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200';
      case 'low': return 'text-green-600 bg-green-50 border-green-200';
      default: return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    }
  };

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'high': return '🔴';
      case 'low': return '🟢';
      default: return '🟡';
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
      <div className="mb-6">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Task Manager</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Manage your tasks and to-do items
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors"
          >
            <MdAdd className="w-4 h-4" />
            <span>Add Task</span>
          </button>
          {tasks.length > 0 && (
            <button
              onClick={handleDeleteAllTasks}
              className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors"
            >
              <MdDelete className="w-4 h-4" />
              <span>Clear All</span>
            </button>
          )}
        </div>
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

      {/* Add Task Form */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Add New Task</h2>
          <form onSubmit={handleAddTask} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Task Description *
                </label>
                <input
                  type="text"
                  value={newTask.task}
                  onChange={(e) => setNewTask({...newTask, task: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter task description..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Priority
                </label>
                <select
                  value={newTask.priority}
                  onChange={(e) => setNewTask({...newTask, priority: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Due Date
                </label>
                <input
                  type="datetime-local"
                  value={newTask.due}
                  onChange={(e) => setNewTask({...newTask, due: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reminder
                </label>
                <input
                  type="datetime-local"
                  value={newTask.reminder}
                  onChange={(e) => setNewTask({...newTask, reminder: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Repeat
                </label>
                <select
                  value={newTask.repeat}
                  onChange={(e) => setNewTask({...newTask, repeat: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Notes
                </label>
                <textarea
                  value={newTask.notes}
                  onChange={(e) => setNewTask({...newTask, notes: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  placeholder="Additional notes..."
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50"
              >
                {submitting && <LoadingSpinner size="sm" />}
                <span>Add Task</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Task Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <MdCheckBox className="w-8 h-8 text-blue-600 dark:text-blue-400 mr-3" />
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{tasks.length}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Total Tasks</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <MdCheckBoxOutlineBlank className="w-8 h-8 text-orange-600 dark:text-orange-400 mr-3" />
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {tasks.filter(t => !t.completed).length}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Pending</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <MdCheckBox className="w-8 h-8 text-green-600 dark:text-green-400 mr-3" />
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {tasks.filter(t => t.completed).length}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Completed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            All Tasks ({tasks.length})
          </h2>
        </div>
        
        {tasks.length === 0 ? (
          <div className="p-12 text-center">
            <MdCheckBox className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No tasks yet</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Add your first task to get started with task management.
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-2 rounded-lg inline-flex items-center space-x-2 transition-colors"
            >
              <MdAdd className="w-4 h-4" />
              <span>Add Your First Task</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {tasks.map((task) => (
              <div key={task.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex items-start space-x-4">
                  <button
                    onClick={() => !task.completed && handleCompleteTask(task.id)}
                    className={`mt-1 ${task.completed ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-600 hover:text-green-600 dark:hover:text-green-400'} transition-colors`}
                    disabled={task.completed}
                  >
                    {task.completed ? (
                      <MdCheckBox className="w-5 h-5" />
                    ) : (
                      <MdCheckBoxOutlineBlank className="w-5 h-5" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-2">
                      <h3 className={`text-lg font-medium ${task.completed ? 'line-through text-gray-500 dark:text-gray-600' : 'text-gray-900 dark:text-white'}`}>
                        {task.task}
                      </h3>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getPriorityColor(task.priority)}`}>
                        {getPriorityIcon(task.priority)} {task.priority}
                      </span>
                      {task.repeat && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                          <MdRefresh className="w-3 h-3 mr-1" />
                          {task.repeat}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                      {task.due && (
                        <div className="flex items-center space-x-1">
                          <MdCalendarToday className="w-4 h-4" />
                          <span>Due: {new Date(task.due).toLocaleString()}</span>
                        </div>
                      )}
                      {task.reminder && (
                        <div className="flex items-center space-x-1">
                          <MdAccessTime className="w-4 h-4" />
                          <span>Reminder: {new Date(task.reminder).toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    {task.notes && (
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{task.notes}</p>
                    )}

                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                      Created: {new Date(task.created_at).toLocaleString()}
                    </p>
                  </div>

                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="text-gray-400 dark:text-gray-600 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  >
                    <MdDelete className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskManager;