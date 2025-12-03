
import React, { useState, useEffect } from 'react';
import { DictionaryEntry, ViewState, SupportedLanguage, ImageStyle, ImageContext } from './types';
import LanguageSelector from './components/LanguageSelector';
import ResultView from './components/ResultView';
import Flashcard from './components/Flashcard';
import { generateDefinition, generateVisualization } from './services/geminiService';
import { getAllItems, saveItem, deleteItem } from './services/storage';
import { UI_TRANSLATIONS, DEFAULT_SUGGESTIONS, LANGUAGES } from './constants';

export default function App() {
  // Helper to detect system language
  const detectSystemLanguage = () => {
    if (typeof navigator === 'undefined') return SupportedLanguage.ENGLISH;
    const lang = navigator.language.split('-')[0];
    const map: Record<string, string> = {
      'en': SupportedLanguage.ENGLISH,
      'zh': SupportedLanguage.CHINESE,
      'es': SupportedLanguage.SPANISH,
      'fr': SupportedLanguage.FRENCH,
      'de': SupportedLanguage.GERMAN,
      'ja': SupportedLanguage.JAPANESE,
      'ko': SupportedLanguage.KOREAN,
      'pt': SupportedLanguage.PORTUGUESE,
      'ru': SupportedLanguage.RUSSIAN,
      'ar': SupportedLanguage.ARABIC,
      'nl': SupportedLanguage.DUTCH,
      'uk': SupportedLanguage.UKRAINIAN,
      'pl': SupportedLanguage.POLISH,
    };
    return map[lang] || SupportedLanguage.ENGLISH;
  };

  // State
  // UPDATED: Check localStorage to determine initial view. 
  // If language is saved, skip ONBOARDING and go to SEARCH.
  const [view, setView] = useState<ViewState>(() => {
    try {
      if (localStorage.getItem('lingopop_sourceLang')) {
        return 'SEARCH';
      }
    } catch (e) {}
    return 'ONBOARDING';
  });

  const [sourceLang, setSourceLang] = useState<string>(() => {
    // Try to load from local storage first, otherwise detect
    try {
      return localStorage.getItem('lingopop_sourceLang') || detectSystemLanguage();
    } catch {
      return detectSystemLanguage();
    }
  });

  // Hardcoded Target Language: Dutch
  const targetLang = SupportedLanguage.DUTCH;
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentEntry, setCurrentEntry] = useState<DictionaryEntry | null>(null);
  const [savedItems, setSavedItems] = useState<DictionaryEntry[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // App Settings
  // FIXED: enableImages is always true, imageContext is always 'target' (Dutch culture)
  const [appSettings, setAppSettings] = useState<{
    enableImages: boolean, 
    enableSfx: boolean,
    imageStyle: ImageStyle, 
    imageContext: ImageContext
  }>({
    enableImages: true,
    enableSfx: true,
    imageStyle: 'ghibli',
    imageContext: 'target'
  });

  // State for Flashcard navigation
  const [flashcardIndex, setFlashcardIndex] = useState(0);

  // State for Notebook Pagination
  const [notebookPage, setNotebookPage] = useState(1);
  const NOTEBOOK_ITEMS_PER_PAGE = 10;

  // State for Error Modal
  const [errorModal, setErrorModal] = useState<{ show: boolean, title: string, message: string }>({
    show: false,
    title: '',
    message: ''
  });

  // Network Listener
  useEffect(() => {
    // Force Git Change Detection: Deployment v2.1 (Imagen Update)
    console.log("LingoPop: Loaded v2.1 (Imagen Support)");

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Persist Source Language
  useEffect(() => {
    try {
      localStorage.setItem('lingopop_sourceLang', sourceLang);
    } catch (e) {
      console.warn("Failed to save source language", e);
    }
  }, [sourceLang]);

  // Ensure Notebook page is valid when items change
  useEffect(() => {
    const totalPages = Math.ceil(savedItems.length / NOTEBOOK_ITEMS_PER_PAGE) || 1;
    if (notebookPage > totalPages) {
      setNotebookPage(totalPages);
    }
  }, [savedItems.length, notebookPage]);

  // Helper for UI Translations
  const getUiLabel = (key: string) => {
    const langLabels = UI_TRANSLATIONS[sourceLang] || UI_TRANSLATIONS[SupportedLanguage.ENGLISH];
    return langLabels[key] || UI_TRANSLATIONS[SupportedLanguage.ENGLISH][key];
  };

  // Get current search UI data based on selected languages (No API Call)
  const searchUiData = {
    greeting: getUiLabel('greeting'),
    suggestionLabel: getUiLabel('suggestionLabel'),
    searchPlaceholder: getUiLabel('searchPlaceholder'),
    suggestions: DEFAULT_SUGGESTIONS[targetLang] || DEFAULT_SUGGESTIONS[SupportedLanguage.ENGLISH] || ["Hallo", "Liefde", "Koffie"]
  };

  // Scroll to top whenever view changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  // Load data (migrate from localStorage to IndexedDB if needed)
  useEffect(() => {
    const loadData = async () => {
      try {
        // 1. History & Settings (Small data, keep in localStorage)
        const history = localStorage.getItem('lingopop_history');
        if (history) setSearchHistory(JSON.parse(history));
        
        const savedSettings = localStorage.getItem('lingopop_settings');
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          // Enforce defaults: Images always on, Context always target
          setAppSettings(prev => ({ 
            ...prev, 
            ...parsed,
            enableImages: true,
            imageContext: 'target'
          }));
        }

        // 2. Saved Items (Big data, use IndexedDB)
        // Migration Check: If we have data in localStorage but not in IndexedDB, migrate it.
        const localSaved = localStorage.getItem('lingopop_saved');
        let items = await getAllItems();

        if (localSaved && items.length === 0) {
           console.warn("Migrating data from localStorage to IndexedDB...");
           const parsedLocal = JSON.parse(localSaved) as DictionaryEntry[];
           for (const item of parsedLocal) {
             await saveItem(item);
           }
           items = parsedLocal;
           localStorage.removeItem('lingopop_saved'); // Clear old storage
        }

        // IndexedDB returns typically by ID (creation time), but we want newest first usually
        // Sorting by timestamp descending
        items.sort((a, b) => b.timestamp - a.timestamp);
        setSavedItems(items);

      } catch (e) {
        console.warn("Failed to load data", e);
      }
    };
    loadData();
  }, []);

  // Persist search history (LocalStorage is fine for strings)
  useEffect(() => {
    try {
      localStorage.setItem('lingopop_history', JSON.stringify(searchHistory));
    } catch (e) {
      console.warn("Failed to save history", e);
    }
  }, [searchHistory]);

  // Persist settings
  useEffect(() => {
    try {
      // Force defaults before saving
      const settingsToSave = {
        ...appSettings,
        enableImages: true,
        imageContext: 'target'
      };
      localStorage.setItem('lingopop_settings', JSON.stringify(settingsToSave));
    } catch (e) {
      console.warn("Failed to save settings", e);
    }
  }, [appSettings]);

  const handleSearch = async (termOverride?: string) => {
    const termToSearch = termOverride || searchTerm;
    if (!termToSearch.trim()) return;

    // LOCAL FIRST STRATEGY: Check if it's already in saved items
    // This allows offline viewing of saved words
    const existingEntry = savedItems.find(item => item.term.toLowerCase() === termToSearch.toLowerCase());
    
    if (existingEntry) {
      setCurrentEntry(existingEntry);
      // Move this history to top
      setSearchHistory(prev => {
        const newHistory = [termToSearch.toLowerCase(), ...prev.filter(t => t.toLowerCase() !== termToSearch.toLowerCase())].slice(0, 10);
        return newHistory;
      });
      setView('RESULT');
      setSearchTerm('');
      return;
    }

    // IF OFFLINE and not saved, show error
    if (!isOnline) {
      setErrorModal({
        show: true,
        title: getUiLabel('offlineMode'),
        message: getUiLabel('offlineError')
      });
      return;
    }

    setIsLoading(true);
    setSearchTerm(termToSearch); 
    setView('SEARCH'); // Show loading state
    
    // NOTE: generateDefinition now returns null if it fails (quota exceeded)
    // We check for null and show the custom modal
    const defData = await generateDefinition(termToSearch, sourceLang, targetLang);
    
    // CHECK FOR NON-DUTCH WORD
    if (defData && defData.definition === "NOT_DUTCH") {
      setIsLoading(false);
      setSearchTerm('');
      setErrorModal({
        show: true,
        title: "Niet Nederlands? 🇳🇱",
        message: `"${termToSearch}" appears to be non-Dutch. This dictionary is exclusive to Dutch words!`
      });
      return;
    }

    if (!defData) {
      setIsLoading(false);
      setSearchTerm('');
      setErrorModal({
        show: true,
        title: "AI Service Busy",
        message: "The AI is taking a short coffee break! ☕ (Daily quota limit reached). Please try again later."
      });
      return;
    }

    const newEntry: DictionaryEntry = {
      id: Date.now().toString(),
      term: termToSearch,
      ...defData,
      timestamp: Date.now()
    };
    
    setCurrentEntry(newEntry);
    
    // Update History (store in lowercase)
    setSearchHistory(prev => {
      const newHistory = [termToSearch.toLowerCase(), ...prev.filter(t => t.toLowerCase() !== termToSearch.toLowerCase())].slice(0, 10);
      return newHistory;
    });

    setView('RESULT');
    setIsLoading(false);
    setSearchTerm('');

    // Fetch image in background (only if image generation is enabled AND we didn't hit quota on definition)
    // Also skip if offline (though we checked earlier, network state might change)
    const isQuotaError = defData.definition.includes("(Service Busy)");
    // FORCE ENABLE IMAGES
    if (!isQuotaError && navigator.onLine) {
      // CHANGE: Use the first example sentence as context if available, otherwise fallback to definition
      const visualContext = (defData.examples && defData.examples[0] && defData.examples[0].target)
        ? defData.examples[0].target
        : defData.definition;

      // UPDATED: Handle new return signature { data, error }
      generateVisualization(termToSearch, visualContext, appSettings.imageStyle, 'target', targetLang).then(async result => {
        // Whether success or error, update the state so UI shows the image OR the error box
        setCurrentEntry(prev => {
          if (prev && prev.term === termToSearch) {
             return { 
               ...prev, 
               imageUrl: result.data || undefined,
               imageError: result.error || undefined
             };
          }
          return prev;
        });
        
        // Also update saved items if user saved it quickly before image loaded
        setSavedItems(prev => {
          return prev.map(item => {
            if (item.term === termToSearch) {
              const updatedItem = { 
                ...item, 
                imageUrl: result.data || undefined,
                imageError: result.error || undefined
              };
              saveItem(updatedItem); 
              return updatedItem;
            }
            return item;
          });
        });
      });
    }
  };

  const toggleSave = async (entry: DictionaryEntry) => {
    try {
      const exists = savedItems.find(item => item.id === entry.id);
      if (exists) {
        await deleteItem(entry.id);
        setSavedItems(prev => prev.filter(item => item.id !== entry.id));
      } else {
        await saveItem(entry);
        setSavedItems(prev => [entry, ...prev]);
      }
    } catch (error: any) {
      console.warn("Save error:", error);
      if (error.name === 'QuotaExceededError') {
         setErrorModal({
           show: true,
           title: "Storage Full",
           message: "Please delete some items from your notebook to save new ones."
         });
      }
    }
  };

  const handleUpdateEntry = async (updatedEntry: DictionaryEntry) => {
    // Update current entry if it matches
    if (currentEntry && currentEntry.id === updatedEntry.id) {
      setCurrentEntry(updatedEntry);
    }
    // Update saved items if it exists there (Update State + DB)
    const isSaved = savedItems.some(item => item.id === updatedEntry.id);
    if (isSaved) {
       try {
         await saveItem(updatedEntry);
         setSavedItems(prev => prev.map(item => item.id === updatedEntry.id ? updatedEntry : item));
       } catch (error) {
         console.warn("Update error:", error);
       }
    }
  };

  const handleNextFlashcard = () => {
    setFlashcardIndex(prev => (prev + 1) % savedItems.length);
  };

  // --- Render Helpers ---

  // Common Logo Component: Intelligent Image with Emoji Fallback
  const renderLogo = () => (
    <div className="mb-1 flex justify-center items-center select-none">
       {/* 
          Using absolute path '/logo.png' to correctly resolve from the public directory.
          If image fails (404), fallback logic handles it.
       */}
       <img 
         src="/logo.png" 
         alt="LingoPop"
         className="h-32 md:h-40 w-auto object-contain hover:scale-105 transition-transform duration-300"
         onError={(e) => {
           // If image fails to load (not found), hide it and show emojis
           e.currentTarget.style.display = 'none';
           document.getElementById('fallback-logo-emojis')!.classList.remove('hidden');
           document.getElementById('fallback-logo-emojis')!.classList.add('flex');
         }}
       />

       {/* Fallback Emojis (Hidden by default, shows if logo.png is missing) */}
       <div id="fallback-logo-emojis" className="hidden justify-center items-end gap-1">
          <span className="text-5xl">🌷</span>
          <span className="text-5xl">🌾</span>
          <span className="text-5xl">🧀</span>
          <span className="text-5xl">🚲</span>
          <span className="text-5xl">👞</span>
          <span className="text-5xl">👑</span>
       </div>
    </div>
  );

  const renderOnboarding = () => (
    <div className="flex flex-col min-h-screen p-6 justify-center max-w-md md:max-w-lg mx-auto">
      <div className="text-center mb-10">
        {renderLogo()}
        {/* Dynamic Title based on selected language */}
        <h1 className="text-4xl font-black text-pop-dark mb-2">{getUiLabel('greeting')}</h1>
        <p className="text-gray-500">
          Modern Dutch Dictionary
        </p>
      </div>
      
      <LanguageSelector type="source" selected={sourceLang} onSelect={setSourceLang} />
      
      <button 
        disabled={!sourceLang}
        onClick={() => setView('SEARCH')}
        className="mt-8 w-full bg-pop-dark text-white font-bold py-4 rounded-2xl shadow-lg disabled:opacity-50 hover:scale-[1.02] transition-transform"
      >
        {getUiLabel('startLearning')}
      </button>
    </div>
  );

  const renderSearch = () => (
    <div className="pt-20 px-6 max-w-md md:max-w-4xl mx-auto flex flex-col items-center">
      <div className="mb-8 text-center animate-fade-in relative">
        {renderLogo()}
        <h1 className="text-2xl font-black text-pop-dark mt-2">{getUiLabel('greeting')}</h1>
      </div>
      
      <div className="w-full relative">
        <input 
          id="search-input"
          name="search"
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={searchUiData.searchPlaceholder}
          // UPDATED: Responsive font size (text-xs/sm for mobile) and reduced padding for mobile to fit long placeholder text
          className="w-full bg-white border-2 border-gray-100 rounded-3xl py-4 pl-5 pr-12 md:p-5 md:pl-6 md:pr-14 text-xs sm:text-sm md:text-lg shadow-sm focus:outline-none focus:border-pop-purple transition-all placeholder:text-gray-400"
        />
        <button 
          onClick={() => handleSearch()}
          disabled={isLoading}
          // UPDATED: Adjusted button size/pos for mobile
          className="absolute right-3 top-2 md:top-3 w-9 h-9 md:w-10 md:h-10 bg-pop-yellow rounded-full flex items-center justify-center text-pop-dark shadow-sm hover:scale-105 transition-transform"
          aria-label="Search"
        >
          {isLoading ? <i className="fa-solid fa-spinner fa-spin text-xs md:text-base"></i> : <i className="fa-solid fa-arrow-right text-xs md:text-base"></i>}
        </button>
      </div>

      <div className="mt-12 text-center text-gray-400 text-sm w-full">
        {searchHistory.length > 0 && (
          <>
            <div className="flex items-center justify-center gap-2 mb-4">
               <i className="fa-solid fa-clock-rotate-left text-xs"></i>
               <p className="font-bold uppercase tracking-wider text-xs">{getUiLabel('historyLabel')}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {searchHistory.map(s => (
                <button 
                  key={s} 
                  onClick={() => handleSearch(s)} 
                  className="bg-white border border-gray-200 px-4 py-2 rounded-full hover:bg-gray-50 text-pop-dark font-medium transition-colors animate-fade-in"
                >
                  {s.toLowerCase()}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderNotebook = () => {
    // Pagination Logic
    const totalPages = Math.ceil(savedItems.length / NOTEBOOK_ITEMS_PER_PAGE) || 1;
    const startIndex = (notebookPage - 1) * NOTEBOOK_ITEMS_PER_PAGE;
    const paginatedItems = savedItems.slice(startIndex, startIndex + NOTEBOOK_ITEMS_PER_PAGE);

    return (
      <div className="pb-24 px-4 max-w-md md:max-w-4xl mx-auto pt-6">
        <div className="flex justify-between items-end mb-6">
          <h2 className="text-3xl font-black text-pop-dark">{getUiLabel('notebook')}</h2>
          <div className="flex gap-2">
              <span className="text-sm font-bold bg-pop-pink text-white px-3 py-1 rounded-full">{savedItems.length} {getUiLabel('items')}</span>
          </div>
        </div>

        {savedItems.length === 0 ? (
          <div className="text-center py-20 opacity-50">
            <i className="fa-regular fa-folder-open text-6xl mb-4"></i>
            <p>{getUiLabel('emptyNotebook')}</p>
          </div>
        ) : (
          <>
            {/* List layout ensuring full width */}
            <div className="flex flex-col gap-3 mb-8">
              {paginatedItems.map(item => (
                <div key={item.id} onClick={() => { setCurrentEntry(item); setView('RESULT'); }} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer hover:border-pop-purple transition-colors h-full w-full">
                  <div className="flex gap-4 items-center overflow-hidden w-full">
                     {item.imageUrl ? (
                       <img src={`data:image/png;base64,${item.imageUrl}`} className="w-12 h-12 rounded-lg object-cover bg-gray-100 shrink-0" alt="" />
                     ) : (
                       <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 text-gray-300">
                         <i className="fa-solid fa-image"></i>
                       </div>
                     )}
                    <div className="min-w-0 flex-1">
                      {/* Display term in lowercase to match dictionary list style for common nouns */}
                      <h3 className="font-bold text-lg truncate">{item.term.toLowerCase()}</h3>
                      <p className="text-xs text-gray-400 whitespace-normal line-clamp-2">{item.definition}</p>
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 shrink-0 ml-2">
                    <i className="fa-solid fa-chevron-right text-xs"></i>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-6">
                <button 
                  onClick={() => setNotebookPage(p => Math.max(1, p - 1))}
                  disabled={notebookPage === 1}
                  className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 text-pop-dark shadow-sm transition-all"
                  aria-label="Previous page"
                >
                  <i className="fa-solid fa-chevron-left"></i>
                </button>
                <span className="text-sm font-bold text-gray-400">
                  {notebookPage} / {totalPages}
                </span>
                <button 
                  onClick={() => setNotebookPage(p => Math.min(totalPages, p + 1))}
                  disabled={notebookPage === totalPages}
                  className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50 text-pop-dark shadow-sm transition-all"
                  aria-label="Next page"
                >
                  <i className="fa-solid fa-chevron-right"></i>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const renderFlashcards = () => {
    // Determine current item safely
    const hasItems = savedItems.length > 0;
    const currentItem = hasItems ? savedItems[flashcardIndex % savedItems.length] : null;

    return (
      <div className="pb-24 px-4 max-w-md md:max-w-4xl mx-auto pt-6 flex flex-col h-screen max-h-[800px]">
        {/* Reduced bottom margin from mb-6 to mb-2 to save space */}
        <h2 className="text-3xl font-black text-pop-dark mb-2 text-center">{getUiLabel('studyMode')}</h2>
        {!hasItems ? (
           <div className="text-center py-20 opacity-50">
             <p>{getUiLabel('emptyStudy')}</p>
             <button onClick={() => setView('SEARCH')} className="mt-4 text-pop-purple font-bold">{getUiLabel('goToSearch')}</button>
           </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
             <div className="w-full">
                {currentItem && (
                  <Flashcard 
                    entry={currentItem} 
                    enableSfx={appSettings.enableSfx}
                    labels={{
                      tapToFlip: getUiLabel('tapToFlip'),
                      tapToFlipBack: getUiLabel('tapToFlipBack'),
                      definition: getUiLabel('definition'),
                      example: getUiLabel('example')
                    }}
                  />
                )}
                
                {/* Reduced top margin from mt-8 to mt-4 to save space */}
                <div className="text-center mt-4 flex justify-center items-center gap-4">
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    {(flashcardIndex % savedItems.length) + 1} / {savedItems.length}
                  </span>
                  <button 
                    onClick={handleNextFlashcard} 
                    className="bg-gray-800 text-white px-6 py-3 rounded-full font-bold shadow-lg active:scale-95 transition-transform flex items-center"
                  >
                    {getUiLabel('nextCard')} <i className="fa-solid fa-arrow-right ml-2"></i>
                  </button>
                </div>
             </div>
          </div>
        )}
      </div>
    );
  };

  const renderSettings = () => {
    const styles: ImageStyle[] = ['flat', 'cartoon', 'ghibli', 'watercolor', 'pixel', 'realistic'];
    
    return (
      <div className="pb-24 px-4 max-w-md md:max-w-4xl mx-auto pt-6">
        <h2 className="text-3xl font-black text-pop-dark mb-6">{getUiLabel('settings')}</h2>
        
        {/* Mother Tongue Setting */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <h3 className="font-bold text-lg text-gray-800 mb-4">{getUiLabel('motherTongue')}</h3>
          <div className="relative">
            <select
              id="language-select"
              name="language"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 text-gray-700 py-3 px-4 pr-8 rounded-xl leading-tight focus:outline-none focus:bg-white focus:border-pop-purple appearance-none font-medium cursor-pointer"
            >
              {LANGUAGES.map(lang => (
                 <option key={lang.code} value={lang.name}>
                   {lang.flag} {lang.name}
                 </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-700">
              <i className="fa-solid fa-chevron-down text-xs"></i>
            </div>
          </div>
        </div>

        {/* Enable Sound Effects Setting */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-lg text-gray-800">{getUiLabel('enableSfx')}</h3>
            <button 
              onClick={() => setAppSettings(prev => ({...prev, enableSfx: !prev.enableSfx}))}
              className={`w-14 h-8 rounded-full p-1 transition-colors ${appSettings.enableSfx ? 'bg-pop-purple' : 'bg-gray-200'}`}
              aria-label={appSettings.enableSfx ? "Disable sound effects" : "Enable sound effects"}
            >
              <div className={`w-6 h-6 rounded-full bg-white shadow-sm transition-transform ${appSettings.enableSfx ? 'translate-x-6' : ''}`} />
            </button>
          </div>
        </div>

        {/* Image Style Setting */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-bold text-lg text-gray-800 mb-4">{getUiLabel('imageStyle')}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {styles.map(style => (
              <button
                key={style}
                onClick={() => setAppSettings(prev => ({...prev, imageStyle: style}))}
                className={`
                  p-3 rounded-xl border-2 text-sm font-bold text-left transition-all
                  ${appSettings.imageStyle === style 
                    ? 'border-pop-purple bg-purple-50 text-pop-purple' 
                    : 'border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100'}
                `}
              >
                {getUiLabel(`style${style.charAt(0).toUpperCase() + style.slice(1)}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Contact Section */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mt-6">
          <h3 className="font-bold text-lg text-gray-800 mb-3 text-center">{getUiLabel('contactUs')}</h3>
          <p className="text-sm text-gray-500 mb-6 text-center">{getUiLabel('contactDesc')}</p>
          
          <div className="flex flex-col items-center">
            <div className="bg-white p-2 rounded-xl border border-gray-100 shadow-sm mb-4">
              <img 
                src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://tinyurl.com/t4rxxrau" 
                alt="Contact QR" 
                className="w-32 h-32 opacity-90"
              />
            </div>
            <a 
              href="https://tinyurl.com/t4rxxrau" 
              target="_blank" 
              rel="noreferrer"
              className="text-pop-purple font-bold text-sm bg-purple-50 px-4 py-2 rounded-full hover:bg-purple-100 transition-colors"
            >
              tinyurl.com/t4rxxrau <i className="fa-solid fa-arrow-up-right-from-square ml-1 text-xs"></i>
            </a>
          </div>
        </div>
      </div>
    );
  };

  const renderErrorModal = () => {
    if (!errorModal.show) return null;
    return (
      <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
        <div className="bg-white rounded-3xl p-8 shadow-2xl max-w-sm w-full text-center relative">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
            <i className="fa-solid fa-circle-exclamation text-3xl"></i>
          </div>
          <h3 className="text-xl font-black text-pop-dark mb-2">{errorModal.title}</h3>
          <p className="text-gray-500 mb-6 leading-relaxed">{errorModal.message}</p>
          <button 
            onClick={() => setErrorModal(prev => ({ ...prev, show: false }))}
            className="w-full bg-pop-dark text-white font-bold py-3 rounded-xl hover:scale-[1.02] transition-transform"
          >
            Got it
          </button>
        </div>
      </div>
    );
  };

  // --- Main Layout ---

  if (view === 'ONBOARDING') return renderOnboarding();

  return (
    <div className="min-h-screen bg-gray-50 pb-20 relative">
      {/* Global Offline Banner (Sticky) */}
      {!isOnline && (
        <div className="sticky top-0 z-[60] bg-orange-500 text-white text-center text-sm py-2 px-4 font-bold shadow-md animate-fade-in">
           <i className="fa-solid fa-wifi-slash mr-2"></i>
           {getUiLabel('offlineError')}
        </div>
      )}

      {/* Top Bar for Results to go back */}
      {view === 'RESULT' && (
        <div className={`px-4 py-4 sticky ${!isOnline ? 'top-[36px]' : 'top-0'} bg-gray-50/90 backdrop-blur-sm z-10 max-w-md md:max-w-4xl mx-auto flex items-center transition-all duration-300`}>
          <button 
            onClick={() => setView('SEARCH')} 
            className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-gray-600"
            aria-label="Back to search"
          >
            <i className="fa-solid fa-arrow-left"></i>
          </button>
          <span className="ml-4 font-bold text-gray-400 text-sm">{getUiLabel('dictionary')}</span>
        </div>
      )}

      <main className="max-w-md md:max-w-4xl mx-auto transition-all duration-300">
        {view === 'SEARCH' && renderSearch()}
        {view === 'RESULT' && currentEntry && (
          <div className="px-4">
            <ResultView 
              entry={currentEntry} 
              onSave={toggleSave} 
              onUpdate={handleUpdateEntry}
              isSaved={savedItems.some(i => i.term === currentEntry.term)} 
              sourceLang={sourceLang}
              targetLang={targetLang}
              labels={{
                pronounce: getUiLabel('pronounce'),
                examples: getUiLabel('examples'),
                quickTip: getUiLabel('quickTip'),
                pos: getUiLabel('pos'),
                plural: getUiLabel('plural'),
                forms: getUiLabel('forms'),
                synonyms: getUiLabel('synonyms'),
                antonyms: getUiLabel('antonyms'),
                practice: getUiLabel('practice'),
                listening: getUiLabel('listening'),
                micErrorTitle: getUiLabel('micErrorTitle'),
                micErrorMsg: getUiLabel('micErrorMsg')
              }}
            />
          </div>
        )}
        {view === 'NOTEBOOK' && renderNotebook()}
        {view === 'FLASHCARDS' && renderFlashcards()}
        {view === 'SETTINGS' && renderSettings()}
      </main>

      {/* Bottom Navigation */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-[360px] md:max-w-lg bg-white rounded-full shadow-2xl border border-gray-100 p-2 flex justify-around items-center z-50 transition-all duration-300">
        <button 
          onClick={() => setView('SEARCH')}
          className={`p-3 rounded-full transition-colors ${view === 'SEARCH' || view === 'RESULT' ? 'bg-pop-yellow text-pop-dark' : 'text-gray-400 hover:bg-gray-50'}`}
          aria-label="Search"
        >
          <i className="fa-solid fa-magnifying-glass text-xl"></i>
        </button>
        <button 
          onClick={() => setView('NOTEBOOK')}
          className={`p-3 rounded-full transition-colors ${view === 'NOTEBOOK' ? 'bg-pop-purple text-white' : 'text-gray-400 hover:bg-gray-50'}`}
          aria-label="Notebook"
        >
          <i className="fa-solid fa-book text-xl"></i>
        </button>
        <button 
          onClick={() => setView('FLASHCARDS')}
          className={`p-3 rounded-full transition-colors ${view === 'FLASHCARDS' ? 'bg-pop-teal text-white' : 'text-gray-400 hover:bg-gray-50'}`}
          aria-label="Flashcards"
        >
          <i className="fa-solid fa-layer-group text-xl"></i>
        </button>
        <button 
          onClick={() => setView('SETTINGS')}
          className={`p-3 rounded-full transition-colors ${view === 'SETTINGS' ? 'bg-pop-pink text-white' : 'text-gray-400 hover:bg-gray-50'}`}
          aria-label="Settings"
        >
          <i className="fa-solid fa-gear text-xl"></i>
        </button>
      </div>

      {renderErrorModal()}
    </div>
  );
}
