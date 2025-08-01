import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  MessageCircle, 
  Bot, 
  User, 
  RotateCcw,
  Trash2,
  Volume2
} from 'lucide-react';
import { chatAPI } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import Alert from '../components/Alert';

const ChatPanel = () => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadChatHistory();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadChatHistory = async () => {
    try {
      const history = await chatAPI.getHistory(50);
      setMessages(history);
    } catch (err) {
      setError('Failed to load chat history');
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || loading) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: newMessage.trim(),
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    const messageText = newMessage.trim();
    setNewMessage('');
    setLoading(true);

    try {
      const response = await chatAPI.sendMessage(messageText);
      
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.response || 'Sorry, I didn\'t understand that.',
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setError(err.message);
      
      // Add error message to chat
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleForceIntentRecheck = async () => {
    if (!messages.length) return;
    
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) return;

    const intentMessage = `ziggy do ${lastUserMessage.content}`;
    setNewMessage(intentMessage);
    inputRef.current?.focus();
  };

  const clearChat = () => {
    if (window.confirm('Are you sure you want to clear the chat history?')) {
      setMessages([]);
    }
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const quickCommands = [
    "What's the weather like?",
    "Add task: buy groceries",
    "Turn on living room light",
    "What's the time?",
    "Show me my tasks",
    "Remember that I like coffee",
    "What do you remember about me?"
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 mb-6">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
            <MessageCircle className="w-8 h-8 mr-3 text-blue-600 dark:text-blue-400" />
            Chat with Ziggy
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Have a conversation with your AI assistant
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={handleForceIntentRecheck}
            disabled={loading || !messages.length}
            className="bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-50"
            title="Force intent recheck on last message"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Recheck</span>
          </button>
          <button
            onClick={clearChat}
            disabled={loading || !messages.length}
            className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-4">
          <Alert
            type="error"
            message={error}
            onClose={() => setError(null)}
          />
        </div>
      )}

      {/* Chat Container */}
      <div className="flex-1 bg-white rounded-lg shadow-sm flex flex-col">
        {/* Messages */}
        <div className="flex-1 p-6 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Start a conversation with Ziggy
              </h3>
              <p className="text-gray-600 mb-6">
                Ask questions, give commands, or just chat!
              </p>
              
              {/* Quick Commands */}
              <div className="max-w-2xl mx-auto">
                <p className="text-sm font-medium text-gray-700 mb-3">Try these commands:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {quickCommands.map((command, index) => (
                    <button
                      key={index}
                      onClick={() => setNewMessage(command)}
                      className="text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm text-gray-700 transition-colors"
                    >
                      "{command}"
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    <div className="flex items-start space-x-2">
                      {message.role === 'assistant' && (
                        <Bot className="w-4 h-4 mt-1 flex-shrink-0" />
                      )}
                      {message.role === 'user' && (
                        <User className="w-4 h-4 mt-1 flex-shrink-0 text-blue-200" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        <p
                          className={`text-xs mt-1 ${
                            message.role === 'user' ? 'text-blue-200' : 'text-gray-500'
                          }`}
                        >
                          {formatTimestamp(message.timestamp)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {loading && (
                <div className="flex justify-start">
                  <div className="max-w-xs lg:max-w-md px-4 py-2 rounded-lg bg-gray-100">
                    <div className="flex items-center space-x-2">
                      <Bot className="w-4 h-4" />
                      <LoadingSpinner size="sm" />
                      <span className="text-sm text-gray-600">Ziggy is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Form */}
        <div className="border-t border-gray-200 p-4">
          <form onSubmit={handleSendMessage} className="flex space-x-3">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Type your message..."
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !newMessage.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <LoadingSpinner size="sm" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
          
          <div className="mt-2 text-xs text-gray-500">
            💡 Tip: Start messages with "ziggy do" to force intent recognition
          </div>
        </div>
      </div>

      {/* Chat Info */}
      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-1">🤖 Chat Features</h3>
        <ul className="text-xs text-blue-800 space-y-1">
          <li>• Ask questions about your tasks, memories, and system status</li>
          <li>• Give commands like "turn on lights" or "add task"</li>
          <li>• Chat context is preserved with your memories and task list</li>
          <li>• Use "Recheck" button to re-process the last message as an intent</li>
        </ul>
      </div>
    </div>
  );
};

export default ChatPanel;