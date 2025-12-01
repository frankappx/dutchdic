import React, { useState } from 'react';
import { DictionaryEntry } from '../types';
import { fetchTTS, playAudio, initAudio } from '../services/geminiService';

interface ResultViewProps {
  entry: DictionaryEntry;
  onSave: (entry: DictionaryEntry) => void;
  onUpdate: (entry: DictionaryEntry) => void;
  isSaved: boolean;
  sourceLang: string;
  targetLang: string;
  labels: {
    pronounce: string;
    examples: string;
    quickTip: string;
    pos?: string;
    plural?: string;
    forms?: string;
    synonyms?: string;
    antonyms?: string;
  };
}

// Helper to check if a grammar field is valid (not null/undefined/empty string/"null")
const isValid = (text?: string | null) => {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return t !== 'null' && t !== 'undefined' && t !== 'n/a' && t !== 'none' && t !== '';
};

// Helper to normalize text for comparison (remove punctuation, lower case)
const cleanText = (text: string) => text.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();

const ResultView: React.FC<ResultViewProps> = ({ entry, onSave, onUpdate, isSaved, sourceLang, targetLang, labels }) => {
  
  // Audio state
  const [audioCache, setAudioCache] = useState<Record<string, string>>({});
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);

  // Share feedback state
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);

  const handleAudio = async (text: string, id: string) => {
    if (loadingAudio) return; // Prevent multiple clicks

    // CRITICAL FIX: Initialize audio context immediately on user click
    // This prevents browser autoplay policies from blocking audio after the async fetch
    initAudio();

    // 1. Check Cache
    if (audioCache[text]) {
      playAudio(audioCache[text]);
      return;
    }

    // 2. Fetch
    setLoadingAudio(id);
    const base64 = await fetchTTS(text);
    setLoadingAudio(null);

    // 3. Play & Save
    if (base64) {
      setAudioCache(prev => ({ ...prev, [text]: base64 }));
      playAudio(base64);
    }
  };

  const handleShare = async () => {
    const shareText = `LingoPop Dictionary 🌍\n\nWord: ${entry.term}\nMeaning: ${entry.definition}\n\nTip: ${entry.usageNote}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `LingoPop: ${entry.term}`,
          text: shareText,
        });
      } catch (err) {
        console.warn("Share canceled");
      }
    } else {
      // Fallback to clipboard
      try {
        await navigator.clipboard.writeText(shareText);
        setShowCopyFeedback(true);
        setTimeout(() => setShowCopyFeedback(false), 2000);
      } catch (err) {
        console.warn("Clipboard failed");
      }
    }
  };

  return (
    <div className="pb-24 animate-fade-in">
      {/* Header / Term */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 mb-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            {/* Display term in lowercase to match dictionary style */}
            <h1 className="text-4xl font-black text-pop-dark tracking-tight mb-2">{entry.term.toLowerCase()}</h1>
            <div className="flex flex-wrap gap-2 items-center mb-3">
               <button 
                onClick={() => handleAudio(entry.term, 'term')}
                className="inline-flex items-center gap-2 px-3 py-1 bg-pop-yellow rounded-full text-xs font-bold shadow-sm active:scale-95 transition-transform"
               >
                 {loadingAudio === 'term' ? (
                   <i className="fa-solid fa-spinner fa-spin"></i>
                 ) : (
                   <i className="fa-solid fa-volume-high"></i> 
                 )}
                 {labels.pronounce}
               </button>

               {/* Part of Speech & Gender Badges */}
               {isValid(entry.grammar?.partOfSpeech) && (
                 <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-600 rounded-md text-xs font-bold font-mono">
                   {entry.grammar!.partOfSpeech}
                 </span>
               )}
               {isValid(entry.grammar?.article) && (
                 <span className="inline-flex items-center px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-bold">
                   {entry.grammar!.article} {entry.term.toLowerCase()}
                 </span>
               )}
            </div>
          </div>
          <div className="flex gap-3 relative">
            {showCopyFeedback && (
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs py-1 px-2 rounded-lg whitespace-nowrap animate-fade-in">
                Copied!
              </div>
            )}
            <button 
              onClick={handleShare}
              className="w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all shadow-sm bg-gray-100 text-gray-500 hover:bg-gray-200"
              title="Share"
            >
              <i className="fa-solid fa-share-nodes"></i>
            </button>
            <button 
              onClick={() => onSave(entry)}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all shadow-sm ${isSaved ? 'bg-pop-pink text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
              title="Save to Notebook"
            >
              <i className={`fa-solid ${isSaved ? 'fa-heart' : 'fa-bookmark'}`}></i>
            </button>
          </div>
        </div>

        {/* GRAMMAR & MORPHOLOGY SECTION */}
        {entry.grammar && (
          <div className="mb-6 space-y-3">
             {/* Plural */}
             {isValid(entry.grammar.plural) && (
               <div className="flex gap-2 text-sm">
                 <span className="text-gray-400 font-bold uppercase tracking-wide w-20 flex-shrink-0">{labels.plural || "Plural"}:</span>
                 <span className="font-medium text-pop-dark">{entry.grammar.plural}</span>
               </div>
             )}
             
             {/* Verbs */}
             {isValid(entry.grammar.verbForms) && (
               <div className="flex gap-2 text-sm">
                 <span className="text-gray-400 font-bold uppercase tracking-wide w-20 flex-shrink-0">{labels.forms || "Forms"}:</span>
                 <span className="font-medium text-pop-dark">{entry.grammar.verbForms}</span>
               </div>
             )}

             {/* Adjectives */}
             {isValid(entry.grammar.adjectiveForms) && (
               <div className="flex gap-2 text-sm">
                 <span className="text-gray-400 font-bold uppercase tracking-wide w-20 flex-shrink-0">{labels.forms || "Forms"}:</span>
                 <span className="font-medium text-pop-dark">{entry.grammar.adjectiveForms}</span>
               </div>
             )}

             {/* Synonyms */}
             {entry.grammar.synonyms && entry.grammar.synonyms.length > 0 && (
               <div className="flex gap-2 text-sm">
                 <span className="text-gray-400 font-bold uppercase tracking-wide w-20 flex-shrink-0">{labels.synonyms || "Synonyms"}:</span>
                 <div className="flex flex-wrap gap-1">
                    {entry.grammar.synonyms.map(s => (
                      <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium">{s}</span>
                    ))}
                 </div>
               </div>
             )}

             {/* Antonyms */}
             {entry.grammar.antonyms && entry.grammar.antonyms.length > 0 && (
               <div className="flex gap-2 text-sm">
                 <span className="text-gray-400 font-bold uppercase tracking-wide w-20 flex-shrink-0">{labels.antonyms || "Antonyms"}:</span>
                 <div className="flex flex-wrap gap-1">
                    {entry.grammar.antonyms.map(s => (
                      <span key={s} className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs font-medium">{s}</span>
                    ))}
                 </div>
               </div>
             )}
          </div>
        )}

        {/* Image - Full Width Bleed (-mx-6) */}
        {entry.imageUrl && (
          <div className="-mx-6 mb-6 overflow-hidden shadow-sm border-t border-b border-gray-100">
            <img src={`data:image/png;base64,${entry.imageUrl}`} alt={entry.term} className="w-full h-48 md:h-96 object-cover transition-all" />
          </div>
        )}

        {/* Definition */}
        <div className="prose prose-lg mb-6">
          <p className="text-xl font-medium text-pop-dark leading-relaxed">{entry.definition}</p>
        </div>

        {/* Examples */}
        <div className="space-y-3 mb-6">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{labels.examples}</h3>
          {entry.examples.map((ex, idx) => (
            <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-100">
              <div className="flex justify-between items-start gap-2 mb-2">
                <p className="text-pop-purple font-semibold text-lg leading-tight">{ex.target}</p>
                <button 
                  onClick={() => handleAudio(ex.target, `ex-${idx}`)} 
                  className="w-8 h-8 flex items-center justify-center bg-white rounded-full text-pop-purple shadow-sm hover:scale-110 transition-transform shrink-0 ml-2"
                >
                  {loadingAudio === `ex-${idx}` ? (
                    <i className="fa-solid fa-spinner fa-spin text-xs"></i>
                  ) : (
                    <i className="fa-solid fa-volume-high text-xs"></i>
                  )}
                </button>
              </div>
              {/* Only show translation if it exists, isn't empty, and isn't identical to target */}
              {ex.source && ex.source.trim() !== '' && cleanText(ex.source) !== cleanText(ex.target) && (
                 <p className="text-gray-600 text-sm italic">{ex.source}</p>
              )}
            </div>
          ))}
        </div>

        {/* Usage Note */}
        <div className="bg-pop-teal/10 p-5 rounded-2xl border border-pop-teal/20">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-pop-teal font-bold text-sm uppercase tracking-wider">
              <i className="fa-solid fa-lightbulb mr-2"></i> {labels.quickTip}
            </h3>
            <button 
              onClick={() => handleAudio(entry.usageNote, 'tip')}
              className="w-8 h-8 flex items-center justify-center bg-white rounded-full text-pop-purple shadow-sm hover:scale-110 transition-transform"
            >
               {loadingAudio === 'tip' ? (
                  <i className="fa-solid fa-spinner fa-spin text-xs"></i>
               ) : (
                  <i className="fa-solid fa-volume-high text-xs"></i>
               )}
            </button>
          </div>
          <p className="text-pop-dark/80 text-sm leading-relaxed">{entry.usageNote}</p>
        </div>
      </div>
    </div>
  );
};

export default ResultView;