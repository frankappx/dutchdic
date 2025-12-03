
import React, { useState, useEffect } from 'react';
import { DictionaryEntry } from '../types';
import { playTTS, initAudio, playSuccessSound, playErrorSound } from '../services/geminiService';

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
    practice: string;
    listening: string;
    micErrorTitle: string;
    micErrorMsg: string;
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
  
  // Audio state (Cache is now global in service)
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);

  // Pronunciation Practice State
  const [isListening, setIsListening] = useState(false);
  const [practiceFeedback, setPracticeFeedback] = useState<'idle' | 'listening' | 'correct' | 'incorrect'>('idle');
  const [heardText, setHeardText] = useState('');
  
  // Error Modal State
  const [showMicModal, setShowMicModal] = useState(false);

  // Share feedback state
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);

  const handleAudio = async (text: string, id: string) => {
    if (loadingAudio) return; // Prevent multiple clicks

    // UI Loading state
    setLoadingAudio(id);
    
    // Call robust service (handles context, caching, fetching)
    await playTTS(text);
    
    setLoadingAudio(null);
  };

  const handlePracticePronunciation = () => {
    // Check browser support
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // For browser incompatibility, we might still want a simple alert or just do nothing, 
      // but let's stick to the modal for uniformity if we want.
      // But usually this means the browser is too old or Firefox (needs config).
      alert("Browser not supported for speech recognition. Please use Chrome/Edge/Safari.");
      return;
    }

    initAudio(); // Initialize audio context for sounds

    const recognition = new SpeechRecognition();
    recognition.lang = 'nl-NL'; // Target Dutch
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setPracticeFeedback('listening');
      setHeardText('');
    };

    recognition.onend = () => {
      setIsListening(false);
      // If we didn't get a result but ended, revert to idle unless we set feedback
      if (practiceFeedback === 'listening') {
         setPracticeFeedback('idle');
      }
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setHeardText(transcript);
      
      const normalizedTranscript = cleanText(transcript);
      const normalizedTarget = cleanText(entry.term);

      // Simple fuzzy match check
      if (normalizedTranscript.includes(normalizedTarget) || normalizedTarget.includes(normalizedTranscript)) {
        setPracticeFeedback('correct');
        playSuccessSound();
      } else {
        setPracticeFeedback('incorrect');
        playErrorSound();
      }
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      setPracticeFeedback('idle');
      console.warn("Speech Recognition Error:", event.error);
      
      // Specifically handle permission denied
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setShowMicModal(true);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error("Failed to start recognition", e);
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
    <div className="pb-24 animate-fade-in relative">
      {/* Header / Term */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 mb-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            {/* Display term in lowercase to match dictionary style */}
            <h1 className="text-4xl font-black text-pop-dark tracking-tight mb-2">{entry.term.toLowerCase()}</h1>
            <div className="flex flex-wrap gap-2 items-center mb-3">
               <button 
                onClick={() => handleAudio(entry.term, 'term')}
                className="inline-flex items-center gap-2 px-3 py-1 bg-pop-yellow rounded-full text-xs font-bold shadow-sm active:scale-95 transition-transform text-pop-dark"
               >
                 {loadingAudio === 'term' ? (
                   <i className="fa-solid fa-spinner fa-spin"></i>
                 ) : (
                   <i className="fa-solid fa-volume-high"></i> 
                 )}
                 {labels.pronounce}
               </button>

               {/* Pronunciation Practice Button */}
               <button 
                  onClick={handlePracticePronunciation}
                  disabled={isListening}
                  className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold shadow-sm active:scale-95 transition-all
                    ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}
                  `}
               >
                  <i className={`fa-solid ${isListening ? 'fa-microphone-lines' : 'fa-microphone'}`}></i>
                  {isListening ? labels.listening : labels.practice}
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

            {/* Pronunciation Feedback Area */}
            {practiceFeedback !== 'idle' && practiceFeedback !== 'listening' && (
              <div className={`mt-2 mb-2 p-2 rounded-lg text-sm flex items-center gap-2 ${
                practiceFeedback === 'correct' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                 {practiceFeedback === 'correct' ? (
                    <i className="fa-solid fa-circle-check"></i>
                 ) : (
                    <i className="fa-solid fa-circle-xmark"></i>
                 )}
                 <div>
                    <span className="font-bold">{practiceFeedback === 'correct' ? 'Great job!' : 'Try again!'}</span>
                    {heardText && <span className="ml-1 opacity-80">- I heard: "{heardText}"</span>}
                 </div>
              </div>
            )}

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
              aria-label="Share"
            >
              <i className="fa-solid fa-share-nodes"></i>
            </button>
            <button 
              onClick={() => onSave(entry)}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-all shadow-sm ${isSaved ? 'bg-pop-pink text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
              title="Save to Notebook"
              aria-label={isSaved ? "Remove from notebook" : "Save to notebook"}
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
        {entry.imageUrl ? (
          <div className="-mx-6 mb-6 overflow-hidden shadow-sm border-t border-b border-gray-100">
            {/* CHANGED: Use aspect-[2/1] for 2:1 ratio as requested, with object-cover to crop the 16:9 source */}
            <img src={`data:image/png;base64,${entry.imageUrl}`} alt={entry.term} className="w-full h-auto aspect-[2/1] object-cover transition-all" />
          </div>
        ) : entry.imageError ? (
          <div className="mb-6 p-6 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-center">
             <i className="fa-solid fa-image-slash text-4xl text-gray-300 mb-2"></i>
             <p className="text-sm font-bold text-gray-500">Image Generation Failed</p>
             <p className="text-xs text-red-500 font-mono mt-1 bg-red-50 px-2 py-1 rounded">{entry.imageError}</p>
             <p className="text-xs text-gray-400 mt-2">Try using a VPN (US) if you are in EU/UK.</p>
          </div>
        ) : null}

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
                  aria-label="Listen to example"
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
              aria-label="Listen to tip"
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

      {/* Custom Microphone Permission Modal */}
      {showMicModal && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full text-center relative">
            <button 
              onClick={() => setShowMicModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center"
              aria-label="Close"
            >
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>

            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
              <i className="fa-solid fa-microphone-slash text-3xl"></i>
            </div>
            
            <h3 className="text-xl font-black text-pop-dark mb-2">{labels.micErrorTitle}</h3>
            <p className="text-gray-500 mb-6 text-sm leading-relaxed">
              {labels.micErrorMsg}
            </p>
            
            <button 
              onClick={() => setShowMicModal(false)}
              className="w-full bg-pop-dark text-white font-bold py-3 rounded-xl hover:scale-[1.02] transition-transform shadow-md"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultView;
