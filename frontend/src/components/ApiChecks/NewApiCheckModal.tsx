import React, { useState } from 'react';
import { X, Plus, Globe, Check, ShieldCheck, Trash2 } from 'lucide-react';
import { ApiCheckItem, HttpMethod } from '../../types';

interface NewApiCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (newCheck: ApiCheckItem) => void;
}

export const NewApiCheckModal: React.FC<NewApiCheckModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [interval, setInterval] = useState('1 minute');
  const [assertions, setAssertions] = useState<string[]>([
    'Status code is 200 OK',
    'Response time < 500ms'
  ]);
  const [newAssertion, setNewAssertion] = useState('');

  if (!isOpen) return null;

  const handleAddAssertion = () => {
    if (!newAssertion.trim()) return;
    setAssertions([...assertions, newAssertion.trim()]);
    setNewAssertion('');
  };

  const handleRemoveAssertion = (index: number) => {
    setAssertions(assertions.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;

    let fullUrl = url.trim();
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      fullUrl = `https://${fullUrl}`;
    }

    const newCheck: ApiCheckItem = {
      id: `api-${Date.now()}`,
      name: name.trim(),
      url: fullUrl,
      method,
      status: 'Healthy',
      timeline: Array(38).fill('success'),
      successRate: '100.0%',
      successRateNumeric: 100.0,
      avgLatency: '110ms',
      avgLatencyNumeric: 110,
      assertionsPassed: assertions.length,
      assertionsTotal: assertions.length,
      lastCheck: 'Just now',
      expectedStatus,
      interval,
      assertionsList: assertions.map((rule) => ({ rule, passed: true })),
    };

    onCreate(newCheck);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-3xl max-w-lg w-full border border-slate-200/90 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Create New API Check</h3>
            <p className="text-xs text-slate-500 mt-0.5">Automated multi-region REST/GraphQL synthetic monitoring.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Check Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Checkout Cart Service"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200/90 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                HTTP Method
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as HttpMethod)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200/90 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Target Endpoint URL
              </label>
              <input
                type="text"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/v1/checkout"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200/90 rounded-xl text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Expected Status Code
              </label>
              <input
                type="number"
                value={expectedStatus}
                onChange={(e) => setExpectedStatus(parseInt(e.target.value) || 200)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Check Frequency
              </label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200/90 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="30 seconds">Every 30 seconds</option>
                <option value="1 minute">Every 1 minute</option>
                <option value="5 minutes">Every 5 minutes</option>
                <option value="15 minutes">Every 15 minutes</option>
              </select>
            </div>
          </div>

          {/* Assertions */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Assertions & Validations
            </label>
            <div className="space-y-2 mb-2">
              {assertions.map((rule, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-mono">
                  <span className="text-slate-800">{rule}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAssertion(idx)}
                    className="text-slate-400 hover:text-rose-500 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newAssertion}
                onChange={(e) => setNewAssertion(e.target.value)}
                placeholder="e.g. Body contains success: true"
                className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-mono"
              />
              <button
                type="button"
                onClick={handleAddAssertion}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
              >
                + Add
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
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
              Create API Check
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
