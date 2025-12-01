
import React from 'react';
import { LANGUAGES } from '../constants';

interface LanguageSelectorProps {
  type: 'source' | 'target';
  selected: string;
  onSelect: (lang: string) => void;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ type, selected, onSelect }) => {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
        {type === 'source' ? 'I speak (Mother Tongue)' : 'I want to learn'}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => onSelect(lang.name)}
            className={`
              flex items-center gap-2 p-3 rounded-xl border-2 transition-all
              ${selected === lang.name 
                ? 'border-pop-purple bg-purple-50 text-pop-purple font-bold shadow-sm' 
                : 'border-transparent bg-white hover:bg-gray-100 text-gray-600'}
            `}
          >
            <span className="text-xl">{lang.flag}</span>
            <span className="text-sm">{lang.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default LanguageSelector;