import React from 'react';
import { MdCheckCircle, MdCancel, MdWarning, MdInfo } from 'react-icons/md';

const Alert = ({ type = 'info', message, onClose }) => {
  const alertConfig = {
    success: {
      icon: MdCheckCircle,
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      textColor: 'text-green-800',
      iconColor: 'text-green-600'
    },
    error: {
      icon: MdCancel,
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      textColor: 'text-red-800',
      iconColor: 'text-red-600'
    },
    warning: {
      icon: MdWarning,
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      textColor: 'text-yellow-800',
      iconColor: 'text-yellow-600'
    },
    info: {
      icon: MdInfo,
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      textColor: 'text-blue-800',
      iconColor: 'text-blue-600'
    }
  };

  const config = alertConfig[type];
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-start">
        <Icon className={`w-5 h-5 mr-3 mt-0.5 ${config.iconColor}`} />
        <div className="flex-1">
          <p className={`text-sm ${config.textColor}`}>{message}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className={`ml-2 ${config.textColor} hover:opacity-75`}
          >
            <MdCancel className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default Alert;