
import React from 'react';
import { LANGUAGES } from '../constants';

interface LanguageSelectorProps {
  type: 'source' | 'target';
  selected: string;
  onSelect: (lang: string) => void;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ type, selected, onSelect }) => {
  return (
    <div className="mb-2 w-full">
      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 text-center">
        {type === 'source' ? 'I speak (Mother Tongue)' : 'I want to learn'}
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => onSelect(lang.name)}
            className={`
              flex items-center justify-center px-2 py-2.5 rounded-xl border transition-all
              ${selected === lang.name 
                ? 'border-pop-purple bg-purple-50 text-pop-purple shadow-sm ring-1 ring-pop-purple/20' 
                : 'border-gray-100 bg-white hover:bg-gray-50 text-gray-600'}
            `}
          >
            <span className="text-xs font-bold truncate max-w-[80px]">
              {lang.name.replace(" (Mandarin)", "")}
            </span>
            <img 
              src={`https://flagcdn.com/w40/${lang.countryCode}.png`}
              srcSet={`https://flagcdn.com/w80/${lang.countryCode}.png 2x`}
              width="20"
              height="15"
              alt={lang.name}
              className="ml-1.5 w-5 h-auto rounded-sm shadow-sm object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
};

export default LanguageSelector;
