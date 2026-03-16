import React, { useState, useRef, useEffect } from 'react';

export interface SearchableSelectOption {
  id: string;
  name: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  /** Optional class for the trigger button (e.g. match form styling) */
  className?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  label,
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter((o) =>
    (o.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const displayValue = value || '';

  const handleSelect = (opt: SearchableSelectOption) => {
    onChange(opt.name);
    setSearchTerm('');
    setIsOpen(false);
  };

  const triggerClass = `w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-left flex items-center justify-between ${disabled ? 'bg-slate-100 cursor-not-allowed' : 'bg-white cursor-pointer'} ${className}`;

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {label && (
        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 pl-1">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((o) => !o)}
        className={triggerClass}
        disabled={disabled}
      >
        <span className={displayValue ? 'text-slate-700' : 'text-slate-400'}>
          {displayValue || placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 flex-shrink-0 ml-2 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-[100] mt-2 w-full bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-3 border-b border-slate-100 bg-slate-50/50">
            <div className="relative">
              <input
                autoFocus
                type="text"
                placeholder="Search..."
                className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white font-bold text-slate-700"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <svg
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = value === opt.name;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(opt);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm font-bold rounded-xl transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {opt.name}
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-6 text-center text-[10px] text-slate-400 font-black uppercase tracking-widest">
                {searchTerm ? 'No results found' : 'No options available'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
