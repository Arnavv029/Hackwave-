import React, { useState } from 'react';
import { X, Plus, Globe, Check } from 'lucide-react';
import { ServiceItem } from '../types';

interface AddServiceModalProps {
  onAdd: (newService: ServiceItem) => void;
  onClose: () => void;
}

export const AddServiceModal: React.FC<AddServiceModalProps> = ({ onAdd, onClose }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<ServiceItem['category']>('Web');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;

    const formattedUrl = url.trim().replace(/^https?:\/\//, '');

    const newService: ServiceItem = {
      id: `srv-${Date.now()}`,
      status: 'Up',
      name: name.trim(),
      url: formattedUrl,
      uptime: '100%',
      response: `${Math.floor(Math.random() * 40 + 40)}ms`,
      uptimeNumeric: 100,
      responseNumeric: 60,
      category,
      sslExpiresIn: '90 days',
      statusMessage: 'Initial synthetic probes healthy',
    };

    onAdd(newService);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-3xl max-w-md w-full border border-slate-200/90 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Add New Service Monitor</h3>
            <p className="text-xs text-slate-500 mt-0.5">Register endpoint for automatic uptime & latency telemetry.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Service Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Payments Gateway"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200/90 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Endpoint Host / URL
            </label>
            <div className="relative">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="e.g. pay.example.com"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200/90 rounded-xl text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ServiceItem['category'])}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200/90 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="Web">Web Application</option>
              <option value="API">API Gateway / Microservice</option>
              <option value="Infrastructure">CDN / Edge Infrastructure</option>
              <option value="Database">Database Engine</option>
              <option value="Storage">Object Storage</option>
              <option value="Communication">Email / Queue</option>
            </select>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs"
            >
              Start Monitoring
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
