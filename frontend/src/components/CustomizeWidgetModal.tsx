import React from 'react';
import { X, Check, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { MetricCardData } from '../types';

interface CustomizeWidgetModalProps {
  cards: MetricCardData[];
  onToggleCard: (id: string) => void;
  onReset: () => void;
  onClose: () => void;
}

export const CustomizeWidgetModal: React.FC<CustomizeWidgetModalProps> = ({
  cards,
  onToggleCard,
  onReset,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-3xl max-w-md w-full border border-slate-200/90 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Customize Dashboard Widgets</h3>
            <p className="text-xs text-slate-500 mt-0.5">Toggle visibility of KPI metric cards and analytics.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Top Metric Tiles
          </div>

          {cards.map((card) => (
            <div
              key={card.id}
              className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200/80 hover:bg-slate-50/80 transition-colors"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{card.value} ({card.change})</p>
              </div>

              <button
                onClick={() => onToggleCard(card.id)}
                className={`
                  p-2 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-semibold
                  ${card.visible 
                    ? 'bg-blue-50 text-blue-600 border border-blue-200' 
                    : 'bg-slate-100 text-slate-400 border border-slate-200'
                  }
                `}
              >
                {card.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                <span>{card.visible ? 'Visible' : 'Hidden'}</span>
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-200/50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Defaults</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs"
          >
            Save Layout
          </button>
        </div>
      </div>
    </div>
  );
};
