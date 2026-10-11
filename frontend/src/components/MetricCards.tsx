import React, { useState } from 'react';
import { MoreHorizontal, ArrowUpRight, ArrowDownRight, Settings, Info, Bell } from 'lucide-react';
import { MetricCardData } from '../types';

interface MetricCardsProps {
  cards: MetricCardData[];
  onOpenCardDetails: (card: MetricCardData) => void;
}

export const MetricCards: React.FC<MetricCardsProps> = ({ cards, onOpenCardDetails }) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const visibleCards = cards.filter((c) => c.visible);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-5">
      {visibleCards.map((card) => {
        const isMenuOpen = activeMenuId === card.id;
        const isPositive = card.changeType === 'positive';
        const isNegative = card.changeType === 'negative';

        return (
          <div
            key={card.id}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:shadow-md hover:border-slate-300/80 transition-all duration-200 relative group flex flex-col justify-between"
          >
            {/* Top Row: Title + 3 dots action */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-medium text-slate-500">
                {card.title}
              </span>

              <div className="relative">
                <button
                  onClick={() => setActiveMenuId(isMenuOpen ? null : card.id)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label={`Options for ${card.title}`}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {/* Dropdown Menu */}
                {isMenuOpen && (
                  <div 
                    className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-slate-200/90 py-1.5 z-30"
                    onMouseLeave={() => setActiveMenuId(null)}
                  >
                    <button
                      onClick={() => {
                        setActiveMenuId(null);
                        onOpenCardDetails(card);
                      }}
                      className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Info className="w-3.5 h-3.5 text-slate-400" />
                      View Analytics
                    </button>
                    <button
                      onClick={() => setActiveMenuId(null)}
                      className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Bell className="w-3.5 h-3.5 text-slate-400" />
                      Set Alert Threshold
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Middle: Big Value */}
            <div className="my-3">
              <div className="text-3xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
                {card.value}
              </div>
            </div>

            {/* Bottom: Than last day + Change pill */}
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-slate-400 font-normal">
                {card.comparisonText}
              </span>

              <div
                className={`
                  inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold
                  ${isPositive 
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' 
                    : isNegative 
                      ? 'bg-rose-50 text-rose-600 border border-rose-200'
                      : 'bg-slate-50 text-slate-600 border border-slate-200'
                  }
                `}
              >
                {isPositive ? (
                  <ArrowUpRight className="w-3 h-3 text-emerald-500 stroke-[2.5]" />
                ) : isNegative ? (
                  <ArrowUpRight className="w-3 h-3 text-rose-500 stroke-[2.5]" />
                ) : null}
                <span>{card.change}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
