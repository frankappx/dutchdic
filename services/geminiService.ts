
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
      // Use the RPC function 'get_word_details' we created in SQL
      // This handles citext (case-insensitivity) automatically
      const { data, error } = await supabase
        .rpc('get_word_details', { 
          search_term: term, 
          target_lang: getLangCode(sourceLang)
        })
        .maybeSingle();

      if (data && !error) {
        console.log("⚡️ Cache Hit: Loaded from Database (RPC)", data);
        
        // Map DB View fields (snake_case) to Frontend Type fields (camelCase)
        const styles = data.images_by_style || {};
        const dbImageUrl = styles[preferredStyle] || styles['ghibli'] || Object.values(styles)[0] || undefined;
        
        // Map Examples (fixing snake_case audio_url to audioUrl)
        const mappedExamples = (data.examples || []).map((ex: any) => ({
          target: ex.target,
          source: ex.source,
          audioUrl: ex.audio_url // Map audio_url -> audioUrl
        }));

        // Merge DB part_of_speech into grammar object
        const mergedGrammar = {
          ...(data.grammar_data || {}),
          partOfSpeech: data.part_of_speech
        };

        return {
          term: data.term,
          definition: data.definition,
          examples: mappedExamples,
          usageNote: data.usage_note,
          grammar: mergedGrammar,
          imageUrl: dbImageUrl,
          audioUrl: data.pronunciation_audio_url // Map pronunciation_audio_url -> audioUrl
        };
      }
    } catch (dbError) {
      console.warn("Supabase lookup failed, falling back to Gemini", dbError);
    }
  }

  // 2. GEMINI FALLBACK
  try {
    const isMonolingual = sourceLang === targetLang;
    const exampleInstruction = isMonolingual 
      ? "Leave this field as an empty string." 
      : `The translation in the Source Language (${sourceLang}).`;

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
    ghibli: 'Studio Ghibli anime style, detailed backgrounds, soft colors',
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
    Ensure the image clearly depicts the action or object described.`;

  try {
    console.log("Using image model: gemini-3-pro-image-preview");
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: { parts: [{ text: prompt }] },
      config: { imageConfig: { imageSize: "1K" } }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return { data: part.inlineData.data, error: null };
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
        responseModalities: ['AUDIO' as any],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }, 
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.warn("TTS generation failed", error);
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
  }
};

export const playTTS = async (text: string, audioUrl?: string): Promise<void> => {
  await initAudio();
  playSilentOscillator();

  // 1. If DB Audio URL exists, prioritize it!
  if (audioUrl) {
    console.log("🔊 Playing from DB URL:", audioUrl);
    await playAudioFromUrl(audioUrl);
    return;
  }

  // 2. Check Global Cache
  if (globalAudioCache[text]) {
    await playAudio(globalAudioCache[text]);
    return;
  }

  // 3. Fetch from API
  const data = await fetchTTS(text);
  if (data) {
    globalAudioCache[text] = data; 
    await playAudio(data);
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
