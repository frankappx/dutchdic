
import React, { useState } from 'react';
import { DictionaryEntry } from '../types';
import { fetchTTS, playAudio, playFlipSound } from '../services/geminiService';

interface FlashcardProps {
  entry: DictionaryEntry;
  enableSfx?: boolean;
  labels: {
    tapToFlip: string;
    tapToFlipBack: string;
    definition: string;
    example: string;
  };
}

const Flashcard: React.FC<FlashcardProps> = ({ entry, enableSfx, labels }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  const handleFlip = () => {
    if (enableSfx) {
      playFlipSound();
    }
    setIsFlipped(!isFlipped);
  };

  const handleAudio = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLoadingAudio) return;

    setIsLoadingAudio(true);
    const base64 = await fetchTTS(entry.term);
    setIsLoadingAudio(false);
    
    if (base64) {
      playAudio(base64);
    }
  };

  return (
    <div 
      className="group w-full max-w-sm md:max-w-md h-96 md:h-[28rem] cursor-pointer perspective-1000 mx-auto transition-all duration-300"
      onClick={handleFlip}
    >
      <div className={`relative w-full h-full transition-transform duration-500 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
        
        {/* Front Face */}
        <div className="absolute w-full h-full bg-white rounded-3xl shadow-xl border-b-4 border-pop-purple p-6 flex flex-col items-center justify-center backface-hidden">
            {entry.imageUrl ? (
              <img 
                src={`data:image/png;base64,${entry.imageUrl}`} 
                alt={entry.term} 
                className="w-48 h-48 md:w-56 md:h-56 object-cover rounded-2xl mb-6 shadow-sm bg-gray-50 transition-all"
              />
            ) : (
              <div className="w-48 h-48 md:w-56 md:h-56 bg-gray-100 rounded-2xl mb-6 flex items-center justify-center text-gray-300 transition-all">
                <i className="fa-solid fa-image text-4xl"></i>
              </div>
            )}
            {/* Display term in lowercase */}
            <h2 className="text-3xl font-black text-pop-dark text-center mb-2">{entry.term.toLowerCase()}</h2>
            <button 
              onClick={handleAudio}
              className="mt-2 w-12 h-12 rounded-full bg-pop-yellow text-pop-dark flex items-center justify-center hover:scale-105 transition-transform shadow-sm"
            >
              {isLoadingAudio ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-volume-high"></i>}
            </button>
            <p className="text-gray-400 text-xs mt-4 uppercase tracking-widest">{labels.tapToFlip}</p>
        </div>

        {/* Back Face */}
        <div className="absolute w-full h-full bg-pop-purple rounded-3xl shadow-xl p-6 flex flex-col justify-between backface-hidden rotate-y-180 text-white">
          <div className="overflow-y-auto no-scrollbar">
            <h3 className="text-lg font-bold opacity-80 mb-1">{labels.definition}</h3>
            <p className="text-xl font-medium mb-4">{entry.definition}</p>
            
            <h3 className="text-lg font-bold opacity-80 mb-1">{labels.example}</h3>
            <p className="text-lg italic font-light">"{entry.examples[0]?.target}"</p>
            <p className="text-sm opacity-80 mt-1">{entry.examples[0]?.source}</p>
          </div>
          <p className="text-center text-xs opacity-50 mt-4 uppercase tracking-widest">{labels.tapToFlipBack}</p>
        </div>

      </div>
    </div>
  );
};

export default Flashcard;