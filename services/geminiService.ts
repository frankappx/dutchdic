
import { GoogleGenAI, Type } from "@google/genai";
import { DictionaryEntry, ImageContext } from "../types";
import { SYSTEM_INSTRUCTION_BASE } from "../constants";
import { supabase } from "./supabaseClient";

// Initialize Gemini Client
const getApiKey = () => {
  let key = '';
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      key = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.API_KEY || '';
    }
  } catch (e) {}
  if (!key) {
    try {
      if (typeof process !== 'undefined' && process.env) {
        key = process.env.VITE_GEMINI_API_KEY || process.env.API_KEY || '';
      }
    } catch (e) {}
  }
  return key;
};

const apiKey = getApiKey();
const ai = new GoogleGenAI({ apiKey });

// --- Audio Helpers ---
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len + (len % 2));
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

let sharedAudioContext: AudioContext | null = null;
const globalAudioCache: Record<string, string> = {};

const getAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
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
        // STRICT STYLE CHECK: Only return the image if it matches the preferred style.
        // Do NOT fallback to 'ghibli' or random styles.
        const dbImageUrl = styles[preferredStyle] || undefined;
        
        // Robustly map Examples: handle 'target'/'source' AND 'dutch_sentence'/'translation'
        const mappedExamples = (data.examples || []).map((ex: any) => ({
          target: ex.target || ex.dutch_sentence || "",
          source: ex.source || ex.translation || "",
          audioUrl: ex.audio_url
        }));

        // Robustly map Grammar: Fallback to partOfSpeech if in grammar_data
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
      1. Target Language: ${targetLang}. Source Language: ${sourceLang}.
      2. Definition: Max 15 words. Concise.
      3. Usage Note: Max 2 sentences. Fun/Casual tone.
      4. Examples: Exactly 2 examples.
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
                  target: { type: Type.STRING },
                  source: { type: Type.STRING },
                }
              }
            },
            usageNote: { type: Type.STRING },
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

    return JSON.parse(text);
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
    ghibli: 'healing slice-of-life anime style, detailed backgrounds, soft colors', // CHANGED
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

  // Updated Prompt: Explicitly forbid text.
  const prompt = `Create a ${stylePrompt} illustration based on the following sentence: "${context}".
    Key object/concept to highlight: "${term}".
    Visualize the literal meaning of this sentence.
    ${contextPrompt}
    
    STRICT REQUIREMENTS:
    1. STRICTLY NO TEXT. Do not include any words, letters, labels, or speech bubbles in the image.
    2. The image should be pure visual art.`;

  try {
    console.log("Using image model: gemini-3-pro-image-preview");
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: { parts: [{ text: prompt }] },
      config: { imageConfig: { imageSize: "1K" } }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        // Manually add the watermark here
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

export const fetchTTS = async (text: string): Promise<string | null> => {
  try {
    console.log("Using TTS model: gemini-2.5-flash-preview-tts");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        // STRONG Dutch enforcement for words like 'lamp' that exist in English
        systemInstruction: "You are a native Dutch speaker. Pronounce the text strictly in Dutch. ATTENTION: Many words look like English (e.g. lamp, hand, bed). You MUST pronounce them with Dutch vowels and intonation. Do not switch to English pronunciation.",
        responseModalities: ['AUDIO' as any],
        speechConfig: {
          voiceConfig: {
            // 'Puck' is often a more reliable European voice than Kore for non-English
            prebuiltVoiceConfig: { voiceName: 'Puck' }, 
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error: any) {
    console.warn("TTS generation failed", error);
    // Propagate quota error
    if (error.message?.includes('429') || error.toString().includes('429')) {
      throw new Error("TTS Quota Exceeded (429)");
    }
    return null;
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
    const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
    await playAudioBuffer(audioBuffer, ctx);
  } catch (error) {}
};

// Play from URL (e.g., from Supabase Storage)
export const playAudioFromUrl = async (url: string): Promise<void> => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    
    // Play sound from URL via HTML5 Audio to avoid CORS issues with Web Audio API for remote files
    // or fetch and decode if CORS is configured correctly.
    // Simple HTML5 Audio is safest for storage URLs.
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

  // 3. Fetch from API
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
