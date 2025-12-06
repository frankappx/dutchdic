import React, { useState } from 'react';
import { DictionaryEntry } from '../types';
import { playTTS, playFlipSound } from '../services/geminiService';

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
    try {
      // FIX: Pass entry.audioUrl to prioritize DB audio over API generation
      await playTTS(entry.term, entry.audioUrl);
    } catch (e) {
      console.warn("Flashcard audio failed");
    } finally {
      setIsLoadingAudio(false);
    }
  };

  // Safety checks for data
  const examples = entry.examples || [];
  const firstExample = examples[0];

  return (
    <div 
      // Adjusted height for desktop (md:h-[25rem]) to prevent overlap with bottom menu on laptops
      className="group w-full max-w-sm md:max-w-md h-96 md:h-[25rem] cursor-pointer perspective-1000 mx-auto transition-all duration-300"
      onClick={handleFlip}
    >
      <div className={`relative w-full h-full transition-transform duration-500 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
        
        {/* Front Face */}
        <div className="absolute w-full h-full bg-white rounded-3xl shadow-xl border-b-4 border-pop-purple p-4 flex flex-col items-center justify-center backface-hidden">
            
            {/* Image Area - FIXED 16:9 ASPECT RATIO */}
            <div className="w-full aspect-video flex items-center justify-center mb-4 overflow-hidden relative rounded-2xl bg-gray-50 group-hover:shadow-inner transition-shadow shadow-sm">
               {entry.imageUrl ? (
                  <img 
                    src={entry.imageUrl.startsWith('http') || entry.imageUrl.startsWith('data:') ? entry.imageUrl : `data:image/jpeg;base64,${entry.imageUrl}`}
                    alt={entry.term} 
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <i className="fa-solid fa-image text-4xl"></i>
                  </div>
                )}
            </div>

            {/* Content Section */}
            <div className="flex flex-col items-center w-full relative pb-4 flex-1 justify-center">
                <h2 className="text-3xl md:text-4xl font-black text-pop-dark text-center mb-3 leading-none break-words w-full px-2 line-clamp-2">
                  {entry.term.toLowerCase()}
                </h2>
                
                <button 
                  onClick={handleAudio}
                  className={`w-12 h-12 rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-sm
                    ${entry.audioUrl ? 'bg-pop-teal text-white' : 'bg-pop-yellow text-pop-dark'}
                  `}
                  aria-label="Play pronunciation"
                >
                  {isLoadingAudio ? <i className="fa-solid fa-spinner fa-spin text-lg"></i> : <i className="fa-solid fa-volume-high text-lg"></i>}
                </button>
            </div>
            
            {/* Instruction Text - Pushed to absolute bottom */}
            <div className="absolute bottom-2 left-0 w-full text-center pointer-events-none">
                <p className="text-gray-300 text-[10px] uppercase tracking-[0.2em] font-bold">
                  {labels.tapToFlip}
                </p>
            </div>
        </div>

        {/* Back Face */}
        <div className="absolute w-full h-full bg-pop-purple rounded-3xl shadow-xl p-6 flex flex-col justify-between backface-hidden rotate-y-180 text-white">
          <div className="overflow-y-auto no-scrollbar flex flex-col justify-center h-full">
            <h3 className="text-sm font-bold opacity-80 mb-1">{labels.definition}</h3>
            <p className="text-xl font-medium mb-6 leading-snug">{entry.definition}</p>
            
            {firstExample && (
              <>
                <h3 className="text-sm font-bold opacity-80 mb-1">{labels.example}</h3>
                <p className="text-lg italic font-light">"{firstExample.target}"</p>
                {firstExample.source && (
                   <p className="text-xs opacity-80 mt-2">{firstExample.source}</p>
                )}
              </>
            )}
          </div>
          <p className="text-center text-xs opacity-50 mt-2 uppercase tracking-widest absolute bottom-4 left-0 w-full">{labels.tapToFlipBack}</p>
        </div>

      </div>
    </div>
  );
};

export default Flashcard;