
export enum SupportedLanguage {
  ENGLISH = 'English',
  SPANISH = 'Spanish',
  CHINESE = 'Chinese (Mandarin)',
  FRENCH = 'French',
  GERMAN = 'German',
  JAPANESE = 'Japanese',
  KOREAN = 'Korean',
  PORTUGUESE = 'Portuguese',
  RUSSIAN = 'Russian',
  ARABIC = 'Arabic',
  DUTCH = 'Dutch',
  UKRAINIAN = 'Ukrainian',
  POLISH = 'Polish'
}

export interface ExampleSentence {
  target: string;
  source: string;
  audioUrl?: string; // NEW: DB-provided audio URL
}

export interface GrammarDetails {
  partOfSpeech?: string; // zn., ww., bn., etc.
  article?: string; // de, het
  plural?: string; // huizen
  verbForms?: string; // lopen - liep - gelopen
  adjectiveForms?: string; // mooi - mooier - mooist
  synonyms?: string[];
  antonyms?: string[];
}

export interface DictionaryEntry {
  id: string; // unique ID for React keys
  term: string;
  definition: string;
  grammar?: GrammarDetails;
  examples: ExampleSentence[];
  usageNote: string;
  imageUrl?: string; // Base64 string
  imageError?: string; // NEW: Store specific image generation error message
  timestamp: number;
}

export type ViewState = 'ONBOARDING' | 'SEARCH' | 'NOTEBOOK' | 'FLASHCARDS' | 'RESULT' | 'SETTINGS';

export type ImageStyle = 'flat' | 'cartoon' | 'ghibli' | 'watercolor' | 'pixel' | 'realistic';

export type ImageContext = 'target' | 'free';
