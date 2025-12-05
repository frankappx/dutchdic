import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { DictionaryEntry, ImageContext } from "../types";
import { SYSTEM_INSTRUCTION_BASE } from "../constants";
import { supabase } from "./supabaseClient";

// Initialize Keys
const getEnv = (key: string) => {
  let value = '';
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      value = import.meta.env[key] || '';
    }
  } catch (e) {}
  if (!value) {
    try {
      if (typeof process !== 'undefined' && process.env) {
        value = process.env[key] || '';
      }
    } catch (e) {}
  }
  return value;
};

const apiKey = getEnv('VITE_GEMINI_API_KEY') || getEnv('API_KEY');
// Use env var or the provided hardcoded key as fallback
const elevenLabsKey = getEnv('VITE_ELEVENLABS_API_KEY') || '8907edb0434320a0def2afad8da48e900ec0da915a613e1baba0bc998197535f';

const ai = new GoogleGenAI({ apiKey });

// --- Helper: Timeout ---
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise
      .then(value => { clearTimeout(timer); resolve(value); })
      .catch(reason => { clearTimeout(timer); reject(reason); });
  });
};

// --- Helper: Delay ---
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// --- Audio Helpers ---

// Converts Base64 string to ArrayBuffer (Standard for MP3/WAV)
function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

let sharedAudioContext: AudioContext | null = null;
const globalAudioCache: Record<string, string> = {};

const getAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 44100}); // Standard SR
  }
  return sharedAudioContext;
};

export const initAudio = async () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch (e) {}
};

const playSilentOscillator = () => {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch (e) {}
};

export const playFlipSound = async () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
};

export const playSuccessSound = async () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.05);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.05, now + i * 0.05 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.4);
    });
  } catch (e) {}
};

export const playErrorSound = async () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.linearRampToValueAtTime(100, now + 0.3);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {}
};

// --- IMAGE HELPERS ---

/**
 * Adds a watermark to the bottom right of the image using HTML5 Canvas.
 * @param base64Image Raw base64 string (no data prefix)
 * @returns Promise resolving to new base64 string
 */
const addWatermark = (base64Image: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // 1. Draw Original Image
        ctx.drawImage(img, 0, 0);

        // 2. Configure Watermark Text
        const text = "@Parlolo";
        // Dynamic font size: 3% of image width, min 16px
        const fontSize = Math.max(16, Math.floor(img.width * 0.035));
        const padding = Math.floor(fontSize * 0.8);

        ctx.font = `900 ${fontSize}px sans-serif`; // Extra Bold
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        
        const x = img.width - padding;
        const y = img.height - padding;

        // 3. Draw Shadow/Stroke (for contrast on any background)
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0, 0.6)';
        ctx.strokeText(text, x, y);

        // 4. Draw White Text
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillText(text, x, y);
      }
      
      // Return clean Base64 (strip prefix)
      const dataUrl = canvas.toDataURL('image/png');
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => {
        // Fallback: return original if canvas fails
        resolve(base64Image); 
    };
    img.src = `data:image/png;base64,${base64Image}`;
  });
};

// --- API Methods ---

export const generateDefinition = async (
  term: string, 
  sourceLang: string, 
  targetLang: string,
  preferredStyle: string = 'ghibli'
): Promise<Omit<DictionaryEntry, 'id' | 'timestamp'> | null> => {
  
  // 1. SUPABASE CACHE LOOKUP (Via RPC)
  if (supabase) {
    try {
      const { data, error } = await supabase
        .rpc('get_word_details', { 
          search_term: term, 
          target_lang: getLangCode(sourceLang)
        })
        .maybeSingle();

      if (data && !error) {
        console.log("⚡️ Cache Hit: Loaded from Database (RPC)", data);
        
        const styles = data.images_by_style || {};
        const dbImageUrl = styles[preferredStyle] || undefined;
        
        const mappedExamples = (data.examples || []).map((ex: any) => ({
          target: ex.target || ex.dutch_sentence || "",
          source: ex.source || ex.translation || "",
          audioUrl: ex.audio_url
        }));

        const mergedGrammar = {
          ...(data.grammar_data || {}),
          partOfSpeech: data.part_of_speech || data.grammar_data?.partOfSpeech
        };

        return {
          term: data.term,
          definition: data.definition,
          examples: mappedExamples,
          usageNote: data.usage_note,
          grammar: mergedGrammar,
          imageUrl: dbImageUrl,
          audioUrl: data.pronunciation_audio_url
        };
      }
    } catch (dbError) {
      console.warn("Supabase lookup failed, falling back to Gemini", dbError);
    }
  }

  // 2. GEMINI FALLBACK
  try {
    const isMonolingual = sourceLang === targetLang;
    
    const prompt = `
      Role: Strict Dictionary API.
      Task: Analyze the term "${term}" for a Dutch learner.
      
      Constraints:
      1. Target Language: ${targetLang} (Dutch). Source Language: ${sourceLang}.
      2. Definition: Max 15 words. Concise.
      3. Usage Note: Around 60 words. Fun, detailed, and helpful cultural or usage context.
      4. Examples: Exactly 2 examples.
         - 'dutch' field: MUST be the Dutch sentence.
         - 'translation' field: MUST be the translation in ${sourceLang}.
      5. Synonyms/Antonyms: Max 5 items each.
      6. OUTPUT: Pure JSON.
      
      Instructions:
      1. DEFINITION and USAGE NOTE must be written in ${sourceLang}.
      2. SYNONYMS, ANTONYMS, PLURALS, and VERB FORMS must be in the TARGET LANGUAGE (${targetLang}) and NOT translated.
      3. Do NOT use English unless ${sourceLang} is explicitly English.

      STRICT VALIDATION:
      1. Check if "${term}" is a valid Dutch word, phrase, or common loanword.
      2. Check for SPELLING ERRORS (e.g. "spanend" -> INVALID).
      3. If INVALID, return JSON with 'definition': "NOT_DUTCH".
    `;

    console.log("Using text model: gemini-2.5-flash");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_BASE,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            definition: { type: Type.STRING },
            examples: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  dutch: { type: Type.STRING, description: "The sentence in Dutch (Target Language)" },
                  translation: { type: Type.STRING, description: `The translation in ${sourceLang} (Source Language)` },
                }
              }
            },
            usageNote: { type: Type.STRING, description: "Detailed usage note (approx 60 words)" },
            grammar: {
              type: Type.OBJECT,
              properties: {
                partOfSpeech: { type: Type.STRING },
                article: { type: Type.STRING },
                plural: { type: Type.STRING },
                verbForms: { type: Type.STRING },
                adjectiveForms: { type: Type.STRING },
                synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
                antonyms: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            }
          }
        }
      }
    });

    let text = response.text || "";
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");

    const json = JSON.parse(text);

    if (json.examples && Array.isArray(json.examples)) {
      json.examples = json.examples.map((ex: any) => ({
        target: ex.dutch || ex.target,
        source: ex.translation || ex.source
      }));
    }

    return json;
  } catch (error) {
    console.error("Gemini API Error (generateDefinition):", error);
    return null;
  }
};

const DUTCH_LOCATIONS = [
  "Amsterdam's Canal Ring at twilight", "Rijksmuseum", "Windmills at Kinderdijk",
  "Tulip fields in Lisse", "Rotterdam Cube Houses", "Utrecht Dom Tower",
  "Giethoorn village canals", "Delft Market Square", "Gouda Cheese Market",
  "Scheveningen Beach", "Typical Dutch Brown Cafe", "Cycling on a polder dike"
];

const cleanErrorMessage = (error: any): string => {
  const str = (error.message || error.toString() || "").toLowerCase();
  if (str.includes("429") || str.includes("quota")) return "Daily Image Quota Exceeded (429).";
  if (str.includes("400") || str.includes("region")) return "Region Not Supported (400). Use US VPN.";
  if (str.includes("403") || str.includes("permission")) return "Access Denied (403). Check API Key.";
  if (str.includes("404")) return "Image Model Not Found (404).";
  return "Image generation failed.";
};

export const generateVisualization = async (
  term: string, 
  context: string, 
  style: string = 'flat',
  imageContext: ImageContext = 'target',
  targetLang: string = 'the target language culture'
): Promise<{ data: string | null; error: string | null }> => {
  const stylePrompts: Record<string, string> = {
    cartoon: 'fun, energetic cartoon style',
    ghibli: 'healing slice-of-life anime style, detailed backgrounds, soft colors, relaxing atmosphere', 
    flat: 'minimalist flat design, vector art, vibrant colors',
    watercolor: 'soft artistic watercolor painting',
    pixel: '8-bit pixel art, retro game style',
    realistic: 'photorealistic, high detailed'
  };
  const stylePrompt = stylePrompts[style] || stylePrompts['flat'];
  
  let contextPrompt = "";
  if (targetLang.toLowerCase().includes('dutch') || targetLang.toLowerCase().includes('nederlands')) {
     const randomLocation = DUTCH_LOCATIONS[Math.floor(Math.random() * DUTCH_LOCATIONS.length)];
     contextPrompt = `Set the scene in the Netherlands. Specific Setting: ${randomLocation}. Atmosphere: Relaxed 'gezellig' vibe.`;
  } else {
     contextPrompt = `Set the scene in a typical ${targetLang} cultural setting.`;
  }

  const prompt = `Create a ${stylePrompt} illustration based on the following sentence: "${context}".
    Key object/concept to highlight: "${term}".
    Visualize the literal meaning of this sentence.
    ${contextPrompt}
    
    STRICT REQUIREMENTS:
    1. STRICTLY NO TEXT. Do not include any words, letters, labels, or speech bubbles in the image.
    2. The image should be pure visual art.`;

  try {
    console.log("Using image model: gemini-3-pro-image-preview");
    const response = await withTimeout<GenerateContentResponse>(
      ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: prompt }] },
        config: { imageConfig: { imageSize: "1K" } }
      }),
      25000 
    );

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const watermarkedBase64 = await addWatermark(part.inlineData.data);
        return { data: watermarkedBase64, error: null };
      }
    }
    return { data: null, error: "No image data in response." };
  } catch (e: any) {
    console.warn("Image generation failed", e);
    return { data: null, error: cleanErrorMessage(e) }; 
  }
};

// --- ELEVENLABS TTS ---

// CHANGED: Use new Voice ID 'AyQGttFzg1EY7EIKkpHs' as requested.
const ELEVENLABS_VOICE_ID = "AyQGttFzg1EY7EIKkpHs"; 

export const fetchTTS = async (text: string): Promise<string | null> => {
  if (!elevenLabsKey) {
     console.error("ElevenLabs Key missing. Please add VITE_ELEVENLABS_API_KEY to your environment.");
     throw new Error("TTS Configuration Error: API Key missing.");
  }

  console.log(`Using ElevenLabs TTS: ${text.substring(0, 20)}...`);

  try {
    // FIX: output_format moved to URL query parameter to avoid 400 error
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsKey
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2", // Best for Dutch
        // output_format: "mp3_44100_128", // REMOVED from body
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      console.error("ElevenLabs API Error:", err);
      if (response.status === 401) throw new Error("Invalid ElevenLabs API Key (401)");
      if (response.status === 429) throw new Error("ElevenLabs Quota Exceeded (429)");
      throw new Error(`ElevenLabs Error: ${response.status} - ${JSON.stringify(err)}`);
    }

    const blob = await response.blob();
    // Convert Blob -> Base64 for app compatibility
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        // Remove data URL prefix (e.g. "data:audio/mpeg;base64,")
        resolve(base64String.split(',')[1]); 
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  } catch (error: any) {
    console.warn("TTS Generation failed:", error.message);
    throw error;
  }
};

const playAudioBuffer = async (audioBuffer: AudioBuffer, ctx: AudioContext) => {
    const outputNode = ctx.createGain();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputNode);
    outputNode.connect(ctx.destination);
    source.start();
}

export const playAudio = async (base64Audio: string): Promise<void> => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    
    // NATIVE BROWSER DECODING (Works for MP3/WAV/etc)
    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    
    // Decode data (promisified for older browsers if needed, but modern use promise)
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    
    await playAudioBuffer(audioBuffer, ctx);
  } catch (error) {
    console.error("Failed to play audio:", error);
  }
};

// Play from URL (e.g., from Supabase Storage)
export const playAudioFromUrl = async (url: string): Promise<void> => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const audio = new Audio(url);
    await audio.play();
  } catch (error) {
    console.warn("Failed to play audio URL", error);
    throw new Error("Failed to play DB audio");
  }
};

export const playTTS = async (text: string, audioUrl?: string): Promise<void> => {
  await initAudio();
  playSilentOscillator();

  // 1. If DB Audio URL exists, prioritize it!
  if (audioUrl) {
    console.log("🔊 Playing from DB URL:", audioUrl);
    try {
      await playAudioFromUrl(audioUrl);
      return;
    } catch (e) {
      console.warn("DB Audio failed, falling back to API...", e);
      // Fall through to API
    }
  }

  // 2. Check Global Cache
  if (globalAudioCache[text]) {
    await playAudio(globalAudioCache[text]);
    return;
  }

  // 3. Fetch from API (ElevenLabs)
  try {
    const data = await fetchTTS(text);
    if (data) {
      globalAudioCache[text] = data; 
      await playAudio(data);
    } else {
      throw new Error("No audio data generated");
    }
  } catch (e: any) {
    throw e; // Rethrow so UI can handle (e.g. Quota Exceeded)
  }
};

const getLangCode = (name: string): string => {
  if (name.includes("English")) return "en";
  if (name.includes("Chinese")) return "zh";
  if (name.includes("Spanish")) return "es";
  if (name.includes("French")) return "fr";
  if (name.includes("German")) return "de";
  if (name.includes("Japanese")) return "ja";
  if (name.includes("Korean")) return "ko";
  if (name.includes("Portuguese")) return "pt";
  if (name.includes("Russian")) return "ru";
  if (name.includes("Arabic")) return "ar";
  if (name.includes("Dutch")) return "nl";
  if (name.includes("Ukrainian")) return "uk";
  if (name.includes("Polish")) return "pl";
  return "en";
};