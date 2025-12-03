
import { GoogleGenAI, Type } from "@google/genai";
import { DictionaryEntry, ImageContext } from "../types";
import { SYSTEM_INSTRUCTION_BASE } from "../constants";

// Initialize Gemini Client
// Robustly retrieve API Key from various environment locations
const getApiKey = () => {
  let key = '';

  // 1. Try import.meta.env (Vite Standard)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      key = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.API_KEY || '';
    }
  } catch (e) {}

  // 2. Try process.env (Node/Webpack/Vercel Legacy)
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
  // CRITICAL FIX: Ensure even byte length for Int16Array
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

// Global Audio Context to prevent creation limit errors
let sharedAudioContext: AudioContext | null = null;
// Global Audio Cache to share TTS between Dictionary and Flashcards
const globalAudioCache: Record<string, string> = {};

const getAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
  }
  return sharedAudioContext;
};

// EXPORTED HELPER: Initialize/Resume Audio Context immediately on user click
export const initAudio = async () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch (e) {
    // Silent fail
  }
};

// Play a silent sound immediately to unlock audio on iOS/Safari/Chrome
const playSilentOscillator = () => {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    // Completely silent
    gain.gain.setValueAtTime(0, ctx.currentTime);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Play for a very short time just to trigger the "running" state
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch (e) {
    // Ignore
  }
};

// Synthesize a short "flip" sound effect
export const playFlipSound = async () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Create a quick frequency sweep/pop
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.15);
    
    // Envelope for a soft "thwip" sound
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    // Silent fail if audio context issue
  }
};

export const playSuccessSound = async () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const now = ctx.currentTime;
    // High pitched pleasant chord
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
  targetLang: string
): Promise<Omit<DictionaryEntry, 'id' | 'timestamp' | 'imageUrl'> | null> => {
  
  try {
    // Check for Monolingual Mode (e.g., Dutch -> Dutch)
    const isMonolingual = sourceLang === targetLang;
    
    // Instruction: If monolingual, we don't need a translation.
    const exampleInstruction = isMonolingual 
      ? "Leave this field as an empty string." 
      : `The translation in the Source Language (${sourceLang}).`;

    const prompt = `
      Analyze the term "${term}". 
      Target Language (Learning): ${targetLang}. 
      Source Language (Native): ${sourceLang}.

      STRICT INSTRUCTION: All output fields (definition, usageNote, example translations) MUST be written in ${sourceLang}. 
      If ${sourceLang} is Chinese, use simplified Chinese.
      Do NOT use English unless ${sourceLang} is explicitly English.

      STRICT VALIDATION:
      1. Check if "${term}" is a valid Dutch word, phrase, or common loanword used in Dutch.
      2. If it is NOT valid Dutch (e.g. English "Hello", Spanish "Hola" vs Dutch "Hallo"), return a JSON where 'definition' is exactly "NOT_DUTCH" and other fields are empty.

      If VALID Dutch, return a JSON object with:
      1. definition: A SHORT, SIMPLE definition STRICTLY in ${sourceLang}. Avoid copyright content.
      2. examples: An array of 2 objects. For each object:
         - 'target': The sentence in the Target Language (${targetLang}).
         - 'source': ${exampleInstruction}
         - IMPORTANT: Ensure examples are original.
      3. usageNote: A casual, fun "friend-to-friend" usage note STRICTLY in ${sourceLang}.
      4. grammar: An object containing detailed grammatical data:
         - partOfSpeech: The abbreviation. IF DUTCH: use 'zn.' (noun), 'ww.' (verb), 'bn.' (adj), 'bw.' (adv), 'vz.' (prep), 'voegw.' (conj), 'vnw.' (pronoun). For other languages use standard abbreviations.
         - article: If noun, the article (e.g., 'de', 'het', 'el', 'la').
         - plural: If noun, the plural form.
         - verbForms: If verb, the conjugation steps. IF DUTCH: "Past Singular - Past Plural - Participle" (e.g. "liep - gelopen").
         - adjectiveForms: If adjective, "Original - Comparative - Superlative" (e.g. "mooi - mooier - mooist").
         - synonyms: Array of strings.
         - antonyms: Array of strings.
    `;

    // Helper to call API
    const fetchDefinition = async (model: string) => {
      return await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION_BASE,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              definition: { type: Type.STRING },
              examples: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    target: { type: Type.STRING, description: `The sentence in ${targetLang}` },
                    source: { type: Type.STRING, description: `The translation in ${sourceLang}` },
                  }
                }
              },
              usageNote: { type: Type.STRING },
              grammar: {
                type: Type.OBJECT,
                properties: {
                  partOfSpeech: { type: Type.STRING, description: "zn., ww., bn., etc." },
                  article: { type: Type.STRING, description: "de, het, etc." },
                  plural: { type: Type.STRING },
                  verbForms: { type: Type.STRING, description: "Conjugation string" },
                  adjectiveForms: { type: Type.STRING, description: "Degrees of comparison" },
                  synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
                  antonyms: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
              }
            }
          }
        }
      });
    };

    let response;
    // HYBRID STRATEGY: Use Flash for Text (Low Latency)
    // Pro is too slow for simple dictionary definitions.
    console.log("Using text model: gemini-2.5-flash");
    response = await fetchDefinition("gemini-2.5-flash");

    let text = response.text || "";
    
    // ROBUSTNESS FIX: Remove Markdown code blocks if present
    // Gemini sometimes returns ```json { ... } ``` even when responseMimeType is set
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");

    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini API Error (generateDefinition):", error);
    // Return NULL to signal failure so the UI can show the custom Error Modal
    return null;
  }
};

// --- Diverse Dutch Locations & Cultural Scenes for Image Generation ---
const DUTCH_LOCATIONS = [
  "Amsterdam's Canal Ring at twilight",
  "Rijksmuseum",
  "Windmills at Kinderdijk",
  "Tulip fields in Lisse",
  "Rotterdam Cube Houses",
  "Utrecht Dom Tower",
  "Giethoorn village canals",
  "Delft Market Square",
  "Gouda Cheese Market",
  "Scheveningen Beach",
  "Typical Dutch Brown Cafe",
  "Cycling on a polder dike"
];

// Helper to sanitize error messages for UI
const cleanErrorMessage = (error: any): string => {
  const str = (error.message || error.toString() || "").toLowerCase();
  
  if (str.includes("429") || str.includes("quota") || str.includes("resource_exhausted")) {
    return "Daily Image Quota Exceeded (429).";
  }
  if (str.includes("400") || str.includes("region") || str.includes("location")) {
    return "Region Not Supported (400). Use US VPN.";
  }
  if (str.includes("403") || str.includes("permission") || str.includes("access")) {
    return "Access Denied (403). Check API Key.";
  }
  if (str.includes("404") || str.includes("not found")) {
    return "Image Model Not Found (404).";
  }
  
  // Truncate long JSON errors
  return "Image generation failed.";
};

// UPDATED: Now returns an object with data OR error
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
  if (true) {
    if (targetLang.toLowerCase().includes('dutch') || targetLang.toLowerCase().includes('nederlands')) {
       const randomLocation = DUTCH_LOCATIONS[Math.floor(Math.random() * DUTCH_LOCATIONS.length)];
       const dutchVibe = "Atmosphere: Relaxed 'gezellig' vibe. Environment: typical red brick architecture, soft overcast sky.";
       contextPrompt = `Set the scene in the Netherlands. Specific Setting: ${randomLocation}. ${dutchVibe}`;
    } else {
       contextPrompt = `Set the scene in a typical ${targetLang} cultural setting.`;
    }
  }

  const prompt = `Create a ${stylePrompt} illustration based on the following sentence: "${context}".
    Key object/concept to highlight: "${term}".
    Visualize the literal meaning of this sentence.
    ${contextPrompt}
    Ensure the image clearly depicts the action or object described.`;

  try {
    // HYBRID STRATEGY: Use Pro for Images (High Quality)
    console.log("Using image model: gemini-3-pro-image-preview");
    
    // Note: If 'gemini-3-pro-image-preview' is not the valid ID, this will throw 404
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

// Fetch TTS Audio Data (Base64)
export const fetchTTS = async (text: string): Promise<string | null> => {
  try {
    console.log("Using TTS model: gemini-2.5-flash-preview-tts");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: ['AUDIO' as any], // Use string to prevent Enum import issues
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }, 
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    // Silent fail
    console.warn("TTS generation failed", error);
    return null;
  }
};

// Play Audio from Base64 String
export const playAudio = async (base64Audio: string): Promise<void> => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const outputNode = ctx.createGain();
    const audioBuffer = await decodeAudioData(
      decode(base64Audio),
      ctx,
      24000,
      1,
    );
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputNode);
    outputNode.connect(ctx.destination);
    source.start();
  } catch (error) {
    // Silent fail
  }
};

// Enhanced wrapper for robust usage across app
export const playTTS = async (text: string): Promise<void> => {
  // 1. Immediately resume/init AudioContext (Must happen in click handler)
  await initAudio();
  
  // 2. Play silent oscillator to keep AudioContext active during potential fetch lag
  playSilentOscillator();

  // 3. Check Global Cache
  if (globalAudioCache[text]) {
    await playAudio(globalAudioCache[text]);
    return;
  }

  // 4. Fetch if missing
  const data = await fetchTTS(text);
  if (data) {
    globalAudioCache[text] = data; // Cache it
    await playAudio(data);
  }
};
