import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { DictionaryEntry, ImageContext } from "../types";
import { SYSTEM_INSTRUCTION_BASE } from "../constants";
import { supabase } from "./supabaseClient";

// Initialize Keys safely
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) {}

  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      // @ts-ignore
      return process.env[key];
    }
  } catch (e) {}
  
  return '';
};

const apiKey = getEnv('VITE_GEMINI_API_KEY') || getEnv('API_KEY');
const claudeKeyEnv = getEnv('VITE_CLAUDE_API_KEY');
// Use env var or the provided hardcoded key as fallback
const elevenLabsKey = getEnv('VITE_ELEVENLABS_API_KEY');

// Safe AI Init: Prevent crash if API key is missing during render
let ai: GoogleGenAI;
try {
  ai = new GoogleGenAI({ apiKey: apiKey || 'dummy_key' });
} catch (e) {
  console.warn("GoogleGenAI failed to initialize:", e);
  // @ts-ignore
  ai = { models: { generateContent: () => Promise.reject("AI Client Failed") } };
}

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
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 44100});
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

const addWatermark = (base64Image: string): Promise<string> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
        resolve(base64Image);
        return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const TARGET_WIDTH = 960;
      const TARGET_HEIGHT = 540;
      
      canvas.width = TARGET_WIDTH;
      canvas.height = TARGET_HEIGHT;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);

        const text = "@Parlolo";
        const fontSize = Math.max(16, Math.floor(TARGET_WIDTH * 0.035));
        const padding = Math.floor(fontSize * 0.8);

        ctx.font = `900 ${fontSize}px sans-serif`; 
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        
        const x = TARGET_WIDTH - padding;
        const y = TARGET_HEIGHT - padding;

        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0, 0.6)';
        ctx.strokeText(text, x, y);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillText(text, x, y);
      }
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => {
        resolve(base64Image); 
    };
    img.src = `data:image/png;base64,${base64Image}`;
  });
};

// --- CLAUDE API ---

export const generateDefinitionClaude = async (
  term: string, 
  sourceLang: string, 
  targetLang: string,
  claudeKey: string
): Promise<any> => {
  // Using user-specified model ID
  const MODEL_NAME = "claude-sonnet-4-5-20250929";
  console.log(`Using text model: ${MODEL_NAME}`);
  
  if (!claudeKey) {
     throw new Error("Missing Claude API Key");
  }

  const prompt = `
      You are a Strict Dictionary API & Cultural Expert.
      Task: Analyze the term "${term}" for a Dutch learner.
      
      Constraints:
      1. Target Language: ${targetLang} (Dutch). Source Language: ${sourceLang}.
      2. Definition: Max 15 words. Concise.
      3. Usage Note: Use this structure EXACTLY. 
         STRICT FORMATTING RULES:
         - NO bullet points (dots, hyphens) at the start of lines.
         - NO quotation marks around sentences.
         - Use specific bracket headers: 【...】

         Structure:
         - Part 1: Cultural/usage tip in ${sourceLang}. Around 60 words.
         
         - Part 2: strictly double newline, then header "【Common Collocations / Structure】" (Translate header to ${sourceLang}).
           List ALL common collocations.
           FORMAT: Dutch phrase [space] Translation
           (Do not use bullets. Just new lines.)

         - Part 3: strictly double newline, then header "【Idioms & Proverbs】" (Translate header to ${sourceLang}).
           List ALL relevant, famous, and authentic fixed expressions/idioms/proverbs.
           
           CRITICAL TRANSLATION RULES FOR IDIOMS:
           1. Translate the ACTUAL MEANING (semantics), not literal.
           2. If ${sourceLang} has an equivalent proverb, YOU MUST USE THAT EQUIVALENT.
           3. The Dutch Idiom/Proverb MUST be bolded using markdown (**text**).
           4. DO NOT use bullet points. 
           5. DO NOT use quotation marks.
           
           FORMAT PER IDIOM (Strict Block Structure):
           **[Dutch Idiom]**
           [Word for 'Meaning' in ${sourceLang}]: [Real Meaning/Equivalent in ${sourceLang}]
           [Word for 'Example' in ${sourceLang}]: [Dutch Sentence]
           [Word for 'Translation' in ${sourceLang}]: [Translation]

           (Ensure there is a blank line between distinct idioms).

      4. Examples: Exactly 2 examples.
         - 'dutch' field: MUST be the Dutch sentence.
         - 'translation' field: MUST be the translation in ${sourceLang}.
      5. Synonyms/Antonyms: Max 5 items each.
      
      VALIDATION:
      - If "${term}" is NOT a valid Dutch word, return JSON with 'definition': "NOT_DUTCH".
      
      OUTPUT: Return ONLY a valid JSON object with the following structure:
      {
        "definition": "string",
        "partOfSpeech": "string (Dutch abbrev)",
        "grammar_data": {
           "plural": "string",
           "article": "de/het",
           "verbForms": "string",
           "adjectiveForms": "string",
           "synonyms": ["string"],
           "antonyms": ["string"]
        },
        "usageNote": "string (the structured note)",
        "examples": [
          {"dutch": "string", "translation": "string"}
        ]
      }
    `;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": claudeKey.trim(),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true" 
      },
      body: JSON.stringify({
        model: MODEL_NAME, 
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
       const err = await response.json().catch(() => ({}));
       console.error("Claude API Error Body:", err);
       const errorMessage = err.error?.message || response.statusText;
       throw new Error(`Claude API Error ${response.status}: ${errorMessage}`);
    }

    const data = await response.json();
    if (!data.content || !data.content[0] || !data.content[0].text) {
        throw new Error("Invalid Claude Response Structure");
    }

    const textContent = data.content[0].text;
    
    // Clean potential markdown code blocks
    const cleanJson = textContent.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
    
    try {
       const json = JSON.parse(cleanJson);
       if (json.examples && Array.isArray(json.examples)) {
         json.examples = json.examples.map((ex: any) => ({
           target: ex.dutch || ex.target,
           source: ex.translation || ex.source
         }));
       }
       return json;
    } catch (parseError) {
       console.error("JSON Parse Error:", textContent);
       throw new Error("Failed to parse JSON from Claude response");
    }

  } catch (e: any) {
    console.error("Claude Generation Failed:", e);
    // Rethrow to allow admin panel to see the exact reason
    throw e;
  }
};

// --- API Methods ---

export const generateDefinition = async (
  term: string, 
  sourceLang: string, 
  targetLang: string, 
  preferredStyle: string = 'ghibli',
  provider: 'gemini' | 'claude' = 'claude' // Default to Claude if possible
): Promise<Omit<DictionaryEntry, 'id' | 'timestamp'> | null> => {
  
  // 1. SUPABASE CACHE LOOKUP
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
      console.warn("Supabase lookup failed, falling back to AI", dbError);
    }
  }

  // 2. CLAUDE OR GEMINI FALLBACK
  
  // Prefer Claude if Key exists and provider is claude or default
  // REMOVED HARDCODED KEY: Must use Environment Variable
  const activeClaudeKey = claudeKeyEnv;
  
  if (provider === 'claude' && activeClaudeKey) {
     try {
       const result = await generateDefinitionClaude(term, sourceLang, targetLang, activeClaudeKey);
       return result;
     } catch (e) {
       console.warn("Claude failed, falling back to Gemini...", e);
       // Continue to Gemini fallback below
     }
  }

  // 3. GEMINI GENERATION
  try {
    const prompt = `
      Role: Strict Dictionary API & Cultural Expert.
      Task: Analyze the term "${term}" for a Dutch learner.
      
      Constraints:
      1. Target Language: ${targetLang} (Dutch). Source Language: ${sourceLang}.
      2. Definition: Max 15 words. Concise.
      3. Usage Note: Use this structure EXACTLY. 
         STRICT FORMATTING RULES:
         - NO bullet points (dots, hyphens) at the start of lines.
         - NO quotation marks around sentences.
         - Use specific bracket headers: 【...】

         Structure:
         - Part 1: Cultural/usage tip in ${sourceLang}. Around 60 words.
         
         - Part 2: strictly double newline, then header "【Common Collocations / Structure】" (Translate header to ${sourceLang}).
           List ALL common collocations.
           FORMAT: Dutch phrase [space] Translation
           (Do not use bullets. Just new lines.)

         - Part 3: strictly double newline, then header "【Idioms & Proverbs】" (Translate header to ${sourceLang}).
           List ALL relevant, famous, and authentic fixed expressions/idioms/proverbs.
           
           CRITICAL TRANSLATION RULES FOR IDIOMS:
           1. Translate the ACTUAL MEANING (semantics), not literal.
           2. If ${sourceLang} has an equivalent proverb, YOU MUST USE THAT EQUIVALENT.
           3. The Dutch Idiom/Proverb MUST be bolded using markdown (**text**).
           4. DO NOT use bullet points.
           5. DO NOT use quotation marks.
           
           FORMAT PER IDIOM (Strict Block Structure):
           **[Dutch Idiom]**
           [Word for 'Meaning' in ${sourceLang}]: [Real Meaning/Equivalent in ${sourceLang}]
           [Word for 'Example' in ${sourceLang}]: [Dutch Sentence]
           [Word for 'Translation' in ${sourceLang}]: [Translation]

           (Ensure there is a blank line between distinct idioms).
         
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

    // CHANGED: Reverted to gemini-2.5-flash for speed as requested
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
            usageNote: { type: Type.STRING, description: "Detailed structured note with Collocations and Idioms" },
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
    2. The image should be pure visual art.
    3. 960x540 resolution, lightweight, optimized for web use, under 300KB.`;

  try {
    console.log("Using image model: gemini-3-pro-image-preview");
    const response = await withTimeout<GenerateContentResponse>(
      ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: prompt }] },
        config: { imageConfig: { imageSize: "1K", aspectRatio: "16:9" } }
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

// CHANGED: Use Premium Voice ID 'AyQGttFzg1EY7EIKkpHs' (Paid Tier).
const ELEVENLABS_VOICE_ID = "AyQGttFzg1EY7EIKkpHs"; 

export const fetchTTS = async (text: string): Promise<string | null> => {
  if (!elevenLabsKey) {
     console.error("ElevenLabs Key missing. Please add VITE_ELEVENLABS_API_KEY to your environment.");
     throw new Error("TTS Configuration Error: API Key missing.");
  }

  console.log(`Using ElevenLabs TTS: ${text.substring(0, 20)}...`);

  try {
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
        model_id: "eleven_multilingual_v2", 
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
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
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
    
    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    
    await playAudioBuffer(audioBuffer, ctx);
  } catch (error) {
    console.error("Failed to play audio:", error);
  }
};

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

  if (audioUrl) {
    console.log("🔊 Playing from DB URL:", audioUrl);
    try {
      await playAudioFromUrl(audioUrl);
      return;
    } catch (e) {
      console.warn("DB Audio failed, falling back to API...", e);
    }
  }

  if (globalAudioCache[text]) {
    await playAudio(globalAudioCache[text]);
    return;
  }

  try {
    const data = await fetchTTS(text);
    if (data) {
      globalAudioCache[text] = data; 
      await playAudio(data);
    } else {
      throw new Error("No audio data generated");
    }
  } catch (e: any) {
    throw e; 
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