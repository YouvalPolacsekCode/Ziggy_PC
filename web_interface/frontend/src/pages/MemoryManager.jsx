import React, { useState, useEffect } from 'react';
import { 
  MdAdd, 
  MdMemory, 
  MdSearch, 
  MdDelete, 
  MdEdit,
  MdVpnKey,
  MdFormatQuote
} from 'react-icons/md';
import { memoryAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

const MemoryManager = () => {
  const [memories, setMemories] = useState([]);
  const [filteredMemories, setFilteredMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingMemory, setEditingMemory] = useState(null);
  const [newMemory, setNewMemory] = useState({
    key: '',
    value: ''
  });

  useEffect(() => {
    loadMemories();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const filtered = memories.filter(memory =>
        memory.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
        memory.value.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredMemories(filtered);
    } else {
      setFilteredMemories(memories);
    }
  }, [memories, searchTerm]);

  const loadMemories = async () => {
    setLoading(true);
    try {
      const data = await memoryAPI.getAll();
      setMemories(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMemory = async (e) => {
    e.preventDefault();
    if (!newMemory.key.trim() || !newMemory.value.trim()) return;

    setSubmitting(true);
    try {
      const memory = await memoryAPI.create(newMemory);
      
      // Update or add memory in the list
      const existingIndex = memories.findIndex(m => m.key === memory.key);
      if (existingIndex >= 0) {
        const updatedMemories = [...memories];
        updatedMemories[existingIndex] = memory;
        setMemories(updatedMemories);
        setSuccess('Memory updated successfully!');
      } else {
        setMemories([...memories, memory]);
        setSuccess('Memory added successfully!');
      }
      
      setNewMemory({ key: '', value: '' });
      setShowAddForm(false);
      setEditingMemory(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditMemory = (memory) => {
    setNewMemory({
      key: memory.key,
      value: memory.value
    });
    setEditingMemory(memory);
    setShowAddForm(true);
  };

  const handleDeleteMemory = async (key) => {
    if (!window.confirm(`Are you sure you want to delete the memory "${key}"?`)) return;

    try {
      await memoryAPI.delete(key);
      setMemories(memories.filter(memory => memory.key !== key));
      setSuccess('Memory deleted successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelEdit = () => {
    setNewMemory({ key: '', value: '' });
    setEditingMemory(null);
    setShowAddForm(false);
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Memory Manager</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Store and manage Ziggy's memories and knowledge
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors"
        >
          <MdAdd className="w-4 h-4" />
          <span>Add Memory</span>
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

      {/* Search */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <div className="relative">
          <MdSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-5 h-5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Search memories by key or value..."
          />
        </div>
      </div>

      {/* Add/Edit Memory Form */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {editingMemory ? 'Edit Memory' : 'Add New Memory'}
          </h2>
          <form onSubmit={handleAddMemory} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Key *
              </label>
              <input
                type="text"
                value={newMemory.key}
                onChange={(e) => setNewMemory({...newMemory, key: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., favorite_color, birthday, preference..."
                required
                disabled={editingMemory !== null} // Don't allow editing key of existing memory
              />
              {editingMemory && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Key cannot be changed when editing existing memory
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Value *
              </label>
              <textarea
                value={newMemory.value}
                onChange={(e) => setNewMemory({...newMemory, value: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows="3"
                placeholder="Enter the memory value..."
                required
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 text-white rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50"
              >
                {submitting && <LoadingSpinner size="sm" />}
                <span>{editingMemory ? 'Update Memory' : 'Add Memory'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Memory Statistics */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <div className="flex items-center">
          <MdMemory className="w-8 h-8 text-purple-600 dark:text-purple-400 mr-3" />
          <div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{memories.length}</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">Stored Memories</p>
          </div>
          {filteredMemories.length !== memories.length && (
            <div className="ml-8">
              <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">{filteredMemories.length}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Search Results</p>
            </div>
          )}
        </div>
      </div>

      {/* Memory List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {searchTerm ? `Search Results (${filteredMemories.length})` : `All Memories (${memories.length})`}
          </h2>
        </div>
        
        {filteredMemories.length === 0 ? (
          <div className="p-12 text-center">
            {searchTerm ? (
              <>
                <MdSearch className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No memories found</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  No memories match your search term "{searchTerm}".
                </p>
                <button
                  onClick={() => setSearchTerm('')}
                  className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium"
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <MdMemory className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No memories yet</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  Start building Ziggy's knowledge by adding your first memory.
                </p>
                <button
                  onClick={() => setShowAddForm(true)}
                  className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 text-white px-4 py-2 rounded-lg inline-flex items-center space-x-2 transition-colors"
                >
                  <MdAdd className="w-4 h-4" />
                  <span>Add Your First Memory</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredMemories.map((memory) => (
              <div key={memory.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-2">
                      <MdVpnKey className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {memory.key}
                      </h3>
                    </div>
                    
                    <div className="flex items-start space-x-2 mb-3">
                      <MdFormatQuote className="w-4 h-4 text-gray-400 dark:text-gray-600 mt-1 flex-shrink-0" />
                      <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                        {memory.value}
                      </p>
                    </div>

                    <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                      <span>Created: {new Date(memory.created_at).toLocaleString()}</span>
                      {memory.updated_at !== memory.created_at && (
                        <span>Updated: {new Date(memory.updated_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => handleEditMemory(memory)}
                      className="text-gray-400 dark:text-gray-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      title="Edit memory"
                    >
                      <MdEdit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteMemory(memory.key)}
                      className="text-gray-400 dark:text-gray-600 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      title="Delete memory"
                    >
                      <MdDelete className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Memory Guidelines */}
      <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-2">💡 Memory Tips</h3>
        <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
          <li>• Use descriptive keys like "favorite_food", "work_schedule", "family_members"</li>
          <li>• Store preferences, facts, and important information Ziggy should remember</li>
          <li>• Values can be detailed - include context and specifics</li>
          <li>• Memories help Ziggy provide more personalized responses</li>
        </ul>
      </div>
    </div>
  );
};

export default MemoryManager;