import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  FileText, 
  Search, 
  Trash2, 
  Edit3,
  Save,
  X
} from 'lucide-react';
import { notesAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

const NotesManager = () => {
  const [notes, setNotes] = useState([]);
  const [filteredNotes, setFilteredNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingNote, setEditingNote] = useState(null);
  const [newNote, setNewNote] = useState({
    title: '',
    content: ''
  });

  useEffect(() => {
    loadNotes();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const filtered = notes.filter(note =>
        note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        note.content.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredNotes(filtered);
    } else {
      setFilteredNotes(notes);
    }
  }, [notes, searchTerm]);

  const loadNotes = async () => {
    setLoading(true);
    try {
      const data = await notesAPI.getAll();
      setNotes(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNote.title.trim() || !newNote.content.trim()) return;

    setSubmitting(true);
    try {
      const note = await notesAPI.create(newNote);
      setNotes([note, ...notes]); // Add to beginning for newest first
      setNewNote({ title: '', content: '' });
      setShowAddForm(false);
      setEditingNote(null);
      setSuccess('Note saved successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditNote = (note) => {
    setNewNote({
      title: note.title,
      content: note.content
    });
    setEditingNote(note);
    setShowAddForm(true);
  };

  const handleUpdateNote = async (e) => {
    e.preventDefault();
    if (!newNote.title.trim() || !newNote.content.trim()) return;

    setSubmitting(true);
    try {
      // Since we don't have an update endpoint, we'll create a new note and delete the old one
      await notesAPI.delete(editingNote.id);
      const updatedNote = await notesAPI.create(newNote);
      
      setNotes(notes.map(note => 
        note.id === editingNote.id ? updatedNote : note
      ));
      
      setNewNote({ title: '', content: '' });
      setShowAddForm(false);
      setEditingNote(null);
      setSuccess('Note updated successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!window.confirm('Are you sure you want to delete this note?')) return;

    try {
      await notesAPI.delete(noteId);
      setNotes(notes.filter(note => note.id !== noteId));
      setSuccess('Note deleted successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelEdit = () => {
    setNewNote({ title: '', content: '' });
    setEditingNote(null);
    setShowAddForm(false);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Notes Manager</h1>
          <p className="text-gray-600 mt-1">
            Create and manage your personal notes
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors mt-1"
        >
          <Plus className="w-4 h-4" />
          <span>Add Note</span>
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
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search notes by title or content..."
          />
        </div>
      </div>

      {/* Add/Edit Note Form */}
      {showAddForm && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {editingNote ? 'Edit Note' : 'Add New Note'}
          </h2>
          <form onSubmit={editingNote ? handleUpdateNote : handleAddNote} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title *
              </label>
              <input
                type="text"
                value={newNote.title}
                onChange={(e) => setNewNote({...newNote, title: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter note title..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Content *
              </label>
              <textarea
                value={newNote.content}
                onChange={(e) => setNewNote({...newNote, content: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows="10"
                placeholder="Write your note content here..."
                required
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center space-x-2 transition-colors"
              >
                <X className="w-4 h-4" />
                <span>Cancel</span>
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50"
              >
                {submitting && <LoadingSpinner size="sm" />}
                <Save className="w-4 h-4" />
                <span>{editingNote ? 'Update Note' : 'Save Note'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Notes Statistics */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center">
          <FileText className="w-8 h-8 text-blue-600 mr-3" />
          <div>
            <p className="text-2xl font-bold text-gray-900">{notes.length}</p>
            <p className="text-sm text-gray-600">Total Notes</p>
          </div>
          {filteredNotes.length !== notes.length && (
            <div className="ml-8">
              <p className="text-lg font-semibold text-blue-600">{filteredNotes.length}</p>
              <p className="text-sm text-gray-600">Search Results</p>
            </div>
          )}
        </div>
      </div>

      {/* Notes Grid */}
      {filteredNotes.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          {searchTerm ? (
            <>
              <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No notes found</h3>
              <p className="text-gray-600 mb-4">
                No notes match your search term "{searchTerm}".
              </p>
              <button
                onClick={() => setSearchTerm('')}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Clear search
              </button>
            </>
          ) : (
            <>
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No notes yet</h3>
              <p className="text-gray-600 mb-4">
                Create your first note to get started.
              </p>
              <button
                onClick={() => setShowAddForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg inline-flex items-center space-x-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add Your First Note</span>
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredNotes.map((note) => (
            <div key={note.id} className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-900 line-clamp-2">
                  {note.title}
                </h3>
                <div className="flex items-center space-x-1 ml-2">
                  <button
                    onClick={() => handleEditNote(note)}
                    className="text-gray-400 hover:text-blue-600 transition-colors"
                    title="Edit note"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="text-gray-400 hover:text-red-600 transition-colors"
                    title="Delete note"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="mb-4">
                <p className="text-gray-700 text-sm leading-relaxed line-clamp-6">
                  {note.content}
                </p>
              </div>

              <div className="text-xs text-gray-500 border-t border-gray-100 pt-3">
                <div>Created: {formatDate(note.created_at)}</div>
                {note.updated_at !== note.created_at && (
                  <div>Updated: {formatDate(note.updated_at)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notes Guidelines */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-green-900 mb-2">📝 Notes Tips</h3>
        <ul className="text-sm text-green-800 space-y-1">
          <li>• Use descriptive titles to easily find your notes later</li>
          <li>• Notes support plain text formatting</li>
          <li>• Use the search function to quickly find specific content</li>
          <li>• Notes are stored locally and synced with Ziggy's file system</li>
          <li>• Consider organizing notes by topic or date for better management</li>
        </ul>
      </div>
    </div>
  );
};

export default NotesManager;