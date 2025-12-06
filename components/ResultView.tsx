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
    feedbackCorrect: string;
    feedbackIncorrect: string;
    heard: string;
  };
}

const isValid = (text?: string | null) => {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  
  // Standard empty/null checks
  if (['null', 'undefined', 'n/a', 'none', '', '-'].includes(t)) return false;

  // Robust check for Dutch "n.v.t." (not applicable) variants
  // Removes dots and spaces: "n.v.t." -> "nvt", "n.v.t" -> "nvt"
  const clean = t.replace(/[\.\s]/g, '');
  if (clean === 'nvt' || clean === 'nietvantoepassing' || clean === 'geen') return false;

  return true;
};

const cleanText = (text: string) => text.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();

const ResultView: React.FC<ResultViewProps> = ({ entry, onSave, onUpdate, isSaved, sourceLang, targetLang, labels }) => {
  
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [practiceFeedback, setPracticeFeedback] = useState<'idle' | 'listening' | 'correct' | 'incorrect'>('idle');
  const [heardText, setHeardText] = useState('');
  const [showMicModal, setShowMicModal] = useState(false);
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);
  const [quotaError, setQuotaError] = useState(false);

  // UPDATED: Accept optional audioUrl from DB
  const handleAudio = async (text: string, id: string, audioUrl?: string) => {
    if (loadingAudio) return;
    setQuotaError(false);
    setLoadingAudio(id);
    
    try {
      // The service will prefer playing this URL over generating new TTS.
      await playTTS(text, audioUrl);
    } catch (e: any) {
      console.error("Audio playback failed", e);
      if (e.message.includes('Quota') || e.message.includes('429')) {
        setQuotaError(true);
      }
    } finally {
      setLoadingAudio(null);
    }
  };

  const handlePracticePronunciation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser not supported for speech recognition. Please use Chrome/Edge/Safari.");
      return;
    }

    initAudio();

    const recognition = new SpeechRecognition();
    recognition.lang = 'nl-NL';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setPracticeFeedback('listening');
      setHeardText('');
    };

    recognition.onend = () => {
      setIsListening(false);
      if (practiceFeedback === 'listening') {
         setPracticeFeedback('idle');
      }
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setHeardText(transcript);
      
      const normalizedTranscript = cleanText(transcript);
      const normalizedTarget = cleanText(entry.term);

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
      } catch (err) {}
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        setShowCopyFeedback(true);
        setTimeout(() => setShowCopyFeedback(false), 2000);
      } catch (err) {}
    }
  };

  return (
    <div className="pb-24 animate-fade-in relative">
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 mb-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-4xl font-black text-pop-dark tracking-tight mb-2">{entry.term.toLowerCase()}</h1>
            <div className="flex flex-wrap gap-2 items-center mb-3">
               <button 
                // Pass entry.audioUrl here
                onClick={() => handleAudio(entry.term, 'term', entry.audioUrl)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold active:scale-95 transition-all
                  ${entry.audioUrl 
                     ? 'bg-pop-teal text-white shadow-sm' // Saved (Solid)
                     : 'bg-white text-pop-dark border-2 border-pop-yellow hover:bg-yellow-50' // API (Outline/Hollow)
                  }
                `}
                title={entry.audioUrl ? "Plays stored audio" : "Generates audio from AI"}
               >
                 {loadingAudio === 'term' ? (
                   <i className="fa-solid fa-spinner fa-spin"></i>
                 ) : (
                   entry.audioUrl 
                     ? <i className="fa-solid fa-volume-high"></i> // Solid Icon
                     : <i className="fa-solid fa-wifi text-pop-yellow"></i> // Signal Icon (Online)
                 )}
                 {labels.pronounce}
               </button>

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

            {practiceFeedback !== 'idle' && practiceFeedback !== 'listening' && (
              <div className={`mt-2 mb-2 p-2 rounded-lg text-sm flex items-center gap-2 ${
                practiceFeedback === 'correct' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                 {practiceFeedback === 'correct' ? <i className="fa-solid fa-circle-check"></i> : <i className="fa-solid fa-circle-xmark"></i>}
                 <div>
                    <span className="font-bold">{practiceFeedback === 'correct' ? labels.feedbackCorrect : labels.feedbackIncorrect}</span>
                    {heardText && <span className="ml-1 opacity-80">- {labels.heard} "{heardText}"</span>}
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

        {entry.grammar && (
          <div className="mb-6 space-y-3">
             {isValid(entry.grammar.plural) && (
               <div className="flex gap-2 text-sm">
                 <span className="text-gray-400 font-bold uppercase tracking-wide w-20 flex-shrink-0">{labels.plural || "Plural"}:</span>
                 <span className="font-medium text-pop-dark">{entry.grammar.plural}</span>
               </div>
             )}
             
             {isValid(entry.grammar.verbForms) && (
               <div className="flex gap-2 text-sm">
                 <span className="text-gray-400 font-bold uppercase tracking-wide w-20 flex-shrink-0">{labels.forms || "Forms"}:</span>
                 <span className="font-medium text-pop-dark">{entry.grammar.verbForms}</span>
               </div>
             )}

             {isValid(entry.grammar.adjectiveForms) && (
               <div className="flex gap-2 text-sm">
                 <span className="text-gray-400 font-bold uppercase tracking-wide w-20 flex-shrink-0">{labels.forms || "Forms"}:</span>
                 <span className="font-medium text-pop-dark">{entry.grammar.adjectiveForms}</span>
               </div>
             )}

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

        {/* IMAGE DISPLAY: Centered, Rounded, No Crop */}
        {entry.imageUrl ? (
          <div className="mb-6 flex justify-center w-full">
            <img 
               src={entry.imageUrl.startsWith('http') || entry.imageUrl.startsWith('data:') ? entry.imageUrl : `data:image/jpeg;base64,${entry.imageUrl}`} 
               alt={entry.term} 
               className="rounded-xl shadow-sm border border-gray-100 w-full h-auto object-contain max-h-[500px]" 
            />
          </div>
        ) : entry.imageError ? (
          <div className="mb-6 mx-auto max-w-sm p-8 rounded-xl bg-gray-50 border border-gray-100 border-dashed flex flex-col items-center justify-center text-center gap-3 text-gray-400">
             <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center text-gray-400 mb-1">
               <i className="fa-regular fa-images text-xl"></i>
             </div>
             <span className="text-sm font-medium text-gray-500">Sorry, no image in this style yet.</span>
          </div>
        ) : null}

        <div className="prose prose-lg mb-6">
          <p className="text-xl font-medium text-pop-dark leading-relaxed">{entry.definition}</p>
        </div>

        <div className="space-y-3 mb-6">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">{labels.examples}</h3>
          {entry.examples.map((ex, idx) => (
            <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-100">
              <div className="flex justify-between items-start gap-2 mb-2">
                <p className="text-pop-purple font-semibold text-lg leading-tight">{ex.target}</p>
                <button 
                  // Pass example audioUrl here
                  onClick={() => handleAudio(ex.target, `ex-${idx}`, ex.audioUrl)} 
                  className={`w-8 h-8 flex items-center justify-center rounded-full shrink-0 ml-2 transition-transform hover:scale-110
                    ${ex.audioUrl 
                       ? 'bg-pop-teal text-white shadow-sm' 
                       : 'bg-white text-pop-purple border border-pop-purple'
                    }
                  `}
                  aria-label="Listen to example"
                >
                  {loadingAudio === `ex-${idx}` ? (
                    <i className="fa-solid fa-spinner fa-spin text-xs"></i>
                  ) : (
                    ex.audioUrl 
                      ? <i className="fa-solid fa-volume-high text-xs"></i>
                      : <i className="fa-solid fa-wifi text-[10px]"></i>
                  )}
                </button>
              </div>
              {ex.source && ex.source.trim() !== '' && cleanText(ex.source) !== cleanText(ex.target) && (
                 <p className="text-gray-600 text-sm italic">{ex.source}</p>
              )}
            </div>
          ))}
        </div>

        <div className="bg-pop-teal/10 p-5 rounded-2xl border border-pop-teal/20">
          <div className="flex items-center mb-2">
            <h3 className="text-pop-teal font-bold text-sm uppercase tracking-wider">
              <i className="fa-solid fa-lightbulb mr-2"></i> {labels.quickTip}
            </h3>
          </div>
          <p className="text-pop-dark/80 text-sm leading-relaxed">{entry.usageNote}</p>
        </div>
      </div>

      {showMicModal && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full text-center relative">
            <button 
              onClick={() => setShowMicModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center"
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

      {quotaError && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full text-center relative">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4 text-yellow-500">
              <i className="fa-solid fa-clock text-3xl"></i>
            </div>
            
            <h3 className="text-xl font-black text-pop-dark mb-2">Daily Quota Reached</h3>
            <p className="text-gray-500 mb-6 text-sm leading-relaxed">
              The daily limit for AI-generated audio has been reached. Please wait, or ask the admin to batch-generate audio for this word.
            </p>
            
            <button 
              onClick={() => setQuotaError(false)}
              className="w-full bg-pop-dark text-white font-bold py-3 rounded-xl hover:scale-[1.02] transition-transform shadow-md"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultView;