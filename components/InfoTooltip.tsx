import React from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  content: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({ content }) => {
  return (
    <div className="relative group inline-block ml-2">
      <Info size={14} className="text-slate-500 cursor-help hover:text-slate-300 transition-colors" />
      
      {/* Tooltip - Aligned to right to prevent overflow on right edge */}
      <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none text-left">
        {content}
        {/* Arrow - Adjusted position */}
        <div className="absolute top-full right-1 border-4 border-transparent border-t-slate-700" />
      </div>
    </div>
  );
};

