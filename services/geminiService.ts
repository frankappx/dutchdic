
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { DictionaryEntry, ImageContext } from "../types";
import { SYSTEM_INSTRUCTION_BASE } from "../constants";

// Helper to safely get environment variables without crashing in browser
const getEnv = (key: string) => {
  // 1. Try Vite standard (import.meta.env)
  try {
    // @ts-ignore
    if (import.meta && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) {}

  // 2. Try Node/Webpack standard (process.env) - Safe check
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
  } catch (e) {}

  return "";
};

// Initialize Gemini Client with robust key lookup
// Prioritize VITE_GEMINI_API_KEY for Vercel deployments
const apiKey = getEnv('VITE_GEMINI_API_KEY') || 
               getEnv('REACT_APP_API_KEY') || 
               getEnv('API_KEY') || 
               getEnv('REACT_APP_GEMINI_API_KEY');

if (!apiKey) {
  console.error("CRITICAL: Gemini API Key is missing. Check Vercel Environment Variables (VITE_GEMINI_API_KEY).");
}

const ai = new GoogleGenAI({ apiKey: apiKey || "" });

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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini API Error (generateDefinition):", error);
    // Return NULL to signal failure so the UI can show the custom Error Modal
    return null;
  }
};

// --- Diverse Dutch Locations & Cultural Scenes for Image Generation ---
const DUTCH_LOCATIONS = [
  // Iconic Cityscapes
  "Amsterdam's Canal Ring at twilight, Prinsengracht with illuminated gabled houses and reflections",
  "Rijksmuseum with the 'I amsterdam' vibe and cyclists passing by",
  "Magere Brug (Skinny Bridge) in Amsterdam, white wooden drawbridge illuminated at night",
  "Jordaan district, narrow streets filled with hollyhocks, bikes, and cozy benches",
  "Dam Square with the Royal Palace and Nieuwe Kerk, bustling with pigeons and people",
  "Erasmus Bridge in Rotterdam, modern white cable-stayed bridge against a skyline",
  "Cube Houses in Rotterdam, striking yellow tilted cube architecture",
  "Markthal Rotterdam, massive arch with colorful mural on the ceiling",
  "The Binnenhof & Ridderzaal in The Hague, medieval parliament buildings by the Hofvijver lake",
  "Dom Tower in Utrecht, the tallest church tower overlooking the city",
  "Oudegracht in Utrecht, unique split-level wharfs with cellar restaurants near the water",
  "Delft Market Square with the Nieuwe Kerk and historic City Hall",
  "Molen de Valk in Leiden, a huge stone windmill standing in the city center",
  "Vrijthof square in Maastricht with St. Servatius Basilica and St. John's Church",
  "Sint Servaasbrug in Maastricht, ancient stone arch bridge over the Meuse river",
  "Haarlem's Grote Markt with the massive St. Bavo Church",
  "Groningen Museum, colorful postmodern architecture surrounded by water",

  // Windmills & Water
  "Kinderdijk at sunset, 19 ancient windmills along the polder waterways",
  "Zaanse Schans with traditional green wooden houses and working windmills",
  "The giant windmills of Schiedam, the tallest classical windmills in the world",
  "The Afsluitdijk, a massive straight dike dividing the sea, aerial perspective",
  "Wouda Steam Pumping Station, industrial cathedral of steam and water",
  "Waterloopbos, moss-covered hydraulic models hidden in a forest",
  "Delta Works (Neeltje Jans), massive concrete storm surge barriers",
  "Classic Dutch Polder landscape, flat green fields divided by straight ditches and cows",
  "Giethoorn, the village with no roads, thatched-roof farmhouses and small boats",

  // Flowers & Countryside
  "Keukenhof Gardens with meticulously designed colorful tulip beds",
  "Lisse Tulip Fields, aerial view of colorful striped flower carpets",
  "A solitary windmill standing in a vibrant sea of red or yellow tulips",
  "Alkmaar Cheese Market with carriers in traditional white uniforms and straw hats",
  "Gouda Cheese Market, yellow cheese wheels stacked high in front of the City Hall",
  "Friesian black and white cows grazing on green pastures with small canals",
  "Sheep grazing on a green dike with a lighthouse in the background",
  "Westland greenhouses at night, emitting a warm orange glow",
  "Blossoming apple orchards in the Betuwe region during spring",

  // Castles & History
  "Castle de Haar, a fairytale-like fortress with towers, moats, and gardens",
  "Muiderslot, a classic medieval square castle surrounded by water",
  "Paleis Het Loo, Dutch Baroque palace with symmetrical formal gardens",
  "Koppelpoort in Amersfoort, a medieval combined land and water gate",
  "Naarden Vesting, a perfect star-shaped fortress city surrounded by double moats",

  // Nature & Coast
  "Hoge Veluwe National Park, purple heather fields with a solitary dead tree",
  "Veluwe Sand Drifts, a mini-desert landscape surrounded by pine forests",
  "Wadden Sea mudflats at low tide, hikers walking on the seabed (Wadlopen)",
  "Scheveningen Beach with the pier and Ferris wheel over the North Sea",
  "Texel Lighthouse, a bold red tower standing on a sandy beach",
  "De Biesbosch National Park, a maze of freshwater creeks and willow forests",
  "Rolling hills of Limburg, a rare un-flat Dutch landscape",

  // Towns & Villages
  "Volendam Harbor, old fishing ships and traditional wooden houses",
  "Marken island, dark green wooden houses on stilts",
  "Thorn, 'the white town' with all-white painted historic houses",
  "Appingedam's hanging kitchens suspended over the canal",
  "Urk, a former island fishing village with a lighthouse and tight streets",

  // Modern & Unique
  "Hovenring in Eindhoven, a floating bicycle roundabout suspended above the road",
  "Inntel Hotel Zaandam, a building made of stacked traditional green wooden houses",
  "Radio Kootwijk, an imposing art deco concrete building in the middle of a heath",
  "Rotterdam Central Station, modern angular wood and steel architecture",
  "NEMO Science Museum in Amsterdam, a green copper ship-like building rising from water",

  // Lifestyle & Culture (Gezelligheid)
  "A parent riding a 'Bakfiets' (cargo bike) with two kids and groceries",
  "Cycling in the rain, one hand on the handlebar, one holding an umbrella",
  "A businessman in a suit commuting on an old rusty bicycle",
  "A couple cycling hand-in-hand side by side",
  "A 'Brown Café' (Bruin Café) interior, cozy dark wood, Persian rugs on tables, and candles",
  "People eating raw herring at a street stall, holding the fish by the tail",
  "King's Day celebration on a canal boat, everyone wearing orange",
  "A bridge opening for a sailboat while cyclists wait patiently",
  "Delft Blue pottery workshop with hand-painted ceramics",
  "Ice skating on frozen canals (Elfstedentocht vibe)",
  "A cozy living room view through a large window with no curtains, very 'Gezellig'",
  "Steep and narrow traditional Dutch staircase",
  "Hoisting furniture through a large window using a hook and rope at the top of the facade",
  "A cat sleeping on a windowsill between two orchid pots",
  "A terrace in the sun packed with people enjoying coffee or beer (Terrasje pakken)"
];

export const generateVisualization = async (
  term: string, 
  context: string, 
  style: string = 'flat',
  imageContext: ImageContext = 'target',
  targetLang: string = 'the target language culture'
): Promise<string | undefined> => {
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
  // Always enforce Target context for this app version
  if (true) {
    // If Dutch, pick a random location to avoid Amsterdam/Windmill repetition
    if (targetLang.toLowerCase().includes('dutch') || targetLang.toLowerCase().includes('nederlands')) {
       const randomLocation = DUTCH_LOCATIONS[Math.floor(Math.random() * DUTCH_LOCATIONS.length)];
       // Add specific vibes requested: Relaxed, Authentic people, Brick architecture, Overcast sky
       const dutchVibe = "Atmosphere: Relaxed 'gezellig' vibe. People: Authentic Dutch people (diverse), casual clothing (jeans, practical style). Environment: typical red brick architecture, soft overcast sky (classic Dutch light).";
       
       contextPrompt = `Set the scene in the Netherlands. Specific Setting: ${randomLocation}. ${dutchVibe} Incorporate Dutch cultural elements naturally. Ensure the environment reflects this specific Dutch location style.`;
    } else {
       contextPrompt = `Set the scene in a typical ${targetLang} cultural setting or environment.`;
    }
  }

  try {
    // Stronger instruction to use the sentence as the literal prompt
    const prompt = `Create a ${stylePrompt} illustration based on the following sentence: "${context}".
    Key object/concept to highlight: "${term}".
    Visualize the literal meaning of this sentence.
    ${contextPrompt}
    Ensure the image clearly depicts the action or object described in the sentence within the specified cultural setting.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: prompt,
      config: {
        imageConfig: {
          aspectRatio: "16:9" // API supports 16:9 (1.77:1), we will crop to 2:1 in CSS
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return part.inlineData.data;
      }
    }
    return undefined;
  } catch (e) {
    // Silent fail
    console.warn("Image generation failed", e);
    return undefined; 
  }
};

// Fetch TTS Audio Data (Base64)
export const fetchTTS = async (text: string): Promise<string | null> => {
  try {
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
