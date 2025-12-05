import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { ImageStyle } from '../types';

// Configuration for rate limiting
const DELAY_BETWEEN_WORDS_MS = 1000; // Reduced from 3000ms as per user feedback
const STORAGE_BUCKET = 'dictionary-assets';

export interface BatchConfig {
  tasks: {
    text: boolean;
    image: boolean;
    audioWord: boolean;
    audioEx1: boolean;
    audioEx2: boolean;
  };
  imageStyle: ImageStyle;
  overwriteAudio: boolean;
}

export interface VoiceIdConfig {
  word: string;
  ex1: string;
  ex2: string;
}

const DUTCH_BACKGROUNDS = [
  "Amsterdam Canal Ring at twilight with illuminated gable houses",
  "Rijksmuseum with cyclists passing by in the foreground",
  "Modern Rotterdam skyline featuring the Erasmus Bridge and skyscrapers",
  "Yellow Cube Houses in Rotterdam against a blue sky",
  "Utrecht's Dom Tower overlooking the unique wharf cellars and canals",
  "The Binnenhof parliament buildings and Hofvijver lake in The Hague",
  "Delft Market Square with the New Church and historic City Hall",
  "Maastricht's Vrijthof square with ancient churches and outdoor terraces",
  "Leiden's Molen de Valk, a large stone windmill in the city center",
  "Groningen Museum's colorful and eccentric modern architecture on the water",
  "Typical Dutch brick row houses with large windows and no curtains",
  "Haarlem Grote Markt with the massive St. Bavo Church",
  "Historic windmills at Kinderdijk lined up along the water at sunset",
  "Zaanse Schans with green wooden houses, small bridges and working windmills",
  "The massive Afsluitdijk causeway stretching endlessly across the sea",
  "Giethoorn village with thatched roof farmhouses, canals and small boats",
  "A classic white Dutch wooden drawbridge opening for a sailboat",
  "The Woudagemaal steam pumping station in a flat polder landscape",
  "Houseboats docked along a city canal with flower pots on deck",
  "The Delta Works storm surge barrier against the North Sea",
  "Vibrant tulip fields in Lisse (strips of red, yellow, pink)",
  "Rolling sand dunes along the North Sea coast with tall marram grass",
  "Purple heather fields in Hoge Veluwe National Park with a lone tree",
  "Texel island red lighthouse standing on a wide sandy beach",
  "Friesian black-and-white cows grazing in a flat green meadow with ditches",
  "A long straight dike road lined with tall trees and green fields",
  "Orchards in blossom in the Betuwe region in spring",
  "Sheep grazing on a green dike with the sea in the background",
  "Inside a cozy 'Brown Café' with dark wooden interior, candles and beer",
  "People cycling in the rain with umbrellas (quintessential Dutch weather)",
  "A massive multi-story bicycle parking garage near a central train station",
  "A bustling street market selling cheese rounds (Gouda/Alkmaar)",
  "People eating raw herring at a street fish stall (holding fish by tail)",
  "Ice skating on a frozen canal with Koek-en-zopie stalls nearby",
  "A parent riding a 'Bakfiets' (cargo bike) with children and groceries",
  "People relaxing on a sunny terrace (Terrasje pakken) in a city square",
  "King's Day celebration with orange decorations, clothes and canal boats",
  "A living room with very steep Dutch stairs visible",
  "Modern architecture of Rotterdam Central Station (angular wood and steel)",
  "A multicultural street market with diverse food stalls and people",
  "Commuters on a busy train platform during rush hour (NS trains)",
  "Contemporary Dutch residential architecture in Almere or IJburg",
  "Students cycling to university in a historic town like Leiden or Groningen",
  "A modern library converted from an old industrial building (like LocHal)"
];

// Helper: Pause execution
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Helper: Timeout Wrapper for API calls
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`API Timeout after ${ms}ms`)), ms);
    promise
      .then(value => { clearTimeout(timer); resolve(value); })
      .catch(reason => { clearTimeout(timer); reject(reason); });
  });
};

// Helper: Add Watermark (Canvas) AND Resize/Compress
// OPTIMIZATION: Resizes image to 512x512 and exports as JPEG 0.8 to save storage
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
      // OPTIMIZATION: Resize to 512x512. 
      // This is sufficient for mobile/web cards and drastically reduces file size vs 1024x1024.
      const TARGET_SIZE = 512;
      canvas.width = TARGET_SIZE;
      canvas.height = TARGET_SIZE;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Draw image scaled to 512x512
        ctx.drawImage(img, 0, 0, TARGET_SIZE, TARGET_SIZE);

        const text = "@Parlolo";
        // Adjust font size relative to new canvas size (approx 20px)
        const fontSize = Math.max(14, Math.floor(TARGET_SIZE * 0.04));
        const padding = Math.floor(fontSize * 0.8);

        ctx.font = `900 ${fontSize}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        
        const x = TARGET_SIZE - padding;
        const y = TARGET_SIZE - padding;

        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0, 0.6)';
        ctx.strokeText(text, x, y);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillText(text, x, y);
      }
      // OPTIMIZATION: Export as JPEG with 80% quality. 
      // PNG (lossless) ~2MB -> JPEG (0.8) ~60KB.
      resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    img.onerror = () => resolve(base64Image);
    img.src = `data:image/png;base64,${base64Image}`;
  });
};

const base64ToUint8Array = (base64: string): Uint8Array | null => {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.error("Base64 decode failed", e);
    return null;
  }
};

const getLanguageName = (code: string) => {
  const map: Record<string, string> = {
    'en': 'English', 'zh': 'Chinese', 'es': 'Spanish', 
    'fr': 'French', 'de': 'German', 'ja': 'Japanese', 
    'ko': 'Korean', 'pt': 'Portuguese', 'ru': 'Russian', 
    'ar': 'Arabic', 'nl': 'Dutch', 'uk': 'Ukrainian', 'pl': 'Polish'
  };
  return map[code] || 'English';
};

export const processBatch = async (
  words: string[],
  serviceRoleKey: string,
  geminiKey: string,
  elevenLabsKey: string,
  voiceIds: VoiceIdConfig,
  supabaseUrl: string,
  targetLangCode: string,
  config: BatchConfig,
  onLog: (msg: string) => void
) => {
  if (!serviceRoleKey || !supabaseUrl || !geminiKey) {
    onLog("❌ Error: Missing credentials.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const targetLangName = getLanguageName(targetLangCode);
  
  const audioTasks = [];
  if (config.tasks.audioWord) audioTasks.push("Word");
  if (config.tasks.audioEx1) audioTasks.push("Ex1");
  if (config.tasks.audioEx2) audioTasks.push("Ex2");

  onLog(`🌍 Output Language: ${targetLangName} (${targetLangCode})`);
  onLog(`⚙️ Tasks: ${config.tasks.text ? '[Text] ' : ''}${config.tasks.image ? '[Image: '+config.imageStyle+'] ' : ''}${audioTasks.length > 0 ? '[Audio (ElevenLabs)]' : ''}`);

  for (let i = 0; i < words.length; i++) {
    const term = words[i].trim();
    if (!term) continue;

    onLog(`\n-----------------------------------`);
    onLog(`🤖 Processing [${i + 1}/${words.length}]: ${term}`);

    let wordId: string | null = null;
    let wordData: any = null;
    let existingWordRow: any = null;

    try {
      // --- PHASE A: TEXT CONTENT ---
      if (config.tasks.text) {
        onLog(`📝 Generating Dictionary Data...`);
        const prompt = `
          Task: Create a Dictionary Entry for the Dutch word "${term}".
          
          Settings:
          - Output Language (Definitions/Notes): ${targetLangName} (${targetLangCode})
          - Target Word Language: Dutch (nl)
          
          JSON Structure Requirements:
          1. "definition": Concise meaning (max 15 words) in ${targetLangName}.
          2. "partOfSpeech": Dutch abbreviation (e.g., zn., ww., bn., bw.).
          3. "grammar_data":
             - "plural": Plural form (if noun).
             - "article": "de" or "het" (if noun).
             - "verbForms": "pres - past - pp" (if verb).
             - "adjectiveForms": "base - comp - sup" (if adj).
             - "synonyms": Array of strings (Dutch, max 3).
             - "antonyms": Array of strings (Dutch, max 3).
          4. "usageNote": Cultural/usage tip in ${targetLangName}. MAX 60-70 words. Rich and helpful.
          5. "examples": Array of exactly 2 objects:
             - "dutch": The Dutch sentence.
             - "translation": The ${targetLangName} translation.

          STRICTLY OUTPUT VALID JSON.
        `;

        const textResp = await withTimeout<GenerateContentResponse>(
            ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    definition: { type: Type.STRING },
                    partOfSpeech: { type: Type.STRING },
                    grammar_data: { 
                      type: Type.OBJECT, 
                      properties: {
                        plural: { type: Type.STRING },
                        article: { type: Type.STRING },
                        verbForms: { type: Type.STRING },
                        adjectiveForms: { type: Type.STRING },
                        synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
                        antonyms: { type: Type.ARRAY, items: { type: Type.STRING } }
                      }
                    },
                    usageNote: { type: Type.STRING },
                    examples: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          dutch: { type: Type.STRING },
                          translation: { type: Type.STRING }
                        }
                      }
                    }
                  }
                }
              }
            }),
            20000 
        );

        let rawText = textResp.text || "{}";
        try {
          wordData = JSON.parse(rawText);
        } catch (e) { throw new Error("JSON Parse failed"); }

        const { data: wordRow, error: wordErr } = await supabase
          .from('words')
          .upsert({ 
            term: term, 
            part_of_speech: wordData.partOfSpeech,
            grammar_data: wordData.grammar_data
          }, { onConflict: 'term' })
          .select('id, pronunciation_audio_url') 
          .single();
        
        if (wordErr) throw wordErr;
        wordId = wordRow.id;
        existingWordRow = wordRow;

        await supabase.from('localized_content').upsert({
          word_id: wordId,
          language_code: targetLangCode,
          definition: wordData.definition,
          usage_note: wordData.usageNote
        }, { onConflict: 'word_id, language_code' });

        if (wordData.examples) {
          let idx = 0;
          for (const ex of wordData.examples) {
            await supabase.from('examples').upsert({
              word_id: wordId,
              language_code: targetLangCode,
              sentence_index: idx,
              dutch_sentence: ex.dutch,
              translation: ex.translation,
              audio_url: null 
            }, { onConflict: 'word_id, language_code, sentence_index' });
            idx++;
          }
        }
        onLog(`✅ Text saved.`);
      }

      // --- LOOKUP ---
      const hasAudioTask = config.tasks.audioWord || config.tasks.audioEx1 || config.tasks.audioEx2;
      
      if (!wordId && (config.tasks.image || hasAudioTask)) {
         onLog(`🔍 Checking database for existing word: "${term}"...`);
         
         const { data: existWord } = await supabase
            .from('words')
            .select('id, grammar_data, pronunciation_audio_url')
            .eq('term', term)
            .maybeSingle(); 

         if (!existWord) {
           onLog(`⚠️ Word "${term}" NOT FOUND in database. Skipping Image/Audio.`);
           continue; 
         }
         
         wordId = existWord.id;
         existingWordRow = existWord;
         onLog(`   -> Found ID: ${wordId}`);

         if (!wordData) {
            const { data: existExs } = await supabase
              .from('examples')
              .select('dutch_sentence, sentence_index, audio_url')
              .eq('word_id', wordId)
              .eq('language_code', targetLangCode)
              .order('sentence_index', { ascending: true });
            
            wordData = { 
              grammar_data: existingWordRow.grammar_data || {},
              examples: existExs ? existExs.map((e: any) => ({ 
                dutch: e.dutch_sentence, 
                index: e.sentence_index,
                hasAudio: !!e.audio_url 
              })) : [] 
            };
            
            if (config.tasks.image && (!wordData.examples || wordData.examples.length === 0)) {
               const { data: anyEx } = await supabase
                 .from('examples')
                 .select('dutch_sentence')
                 .eq('word_id', wordId)
                 .limit(1)
                 .maybeSingle();
               if (anyEx) {
                 wordData.examples = [{ dutch: anyEx.dutch_sentence }];
               }
            }
         }
      }

      // --- PHASE B: IMAGE GENERATION ---
      if (config.tasks.image && wordId) {
        onLog(`🎨 Painting illustration (${config.imageStyle})...`);
        const contextSentence = wordData?.examples?.[0]?.dutch || term;
        const stylePrompts: Record<string, string> = {
          cartoon: 'fun, energetic cartoon style',
          ghibli: 'healing slice-of-life anime style, detailed backgrounds, soft colors, relaxing atmosphere', 
          flat: 'minimalist flat design, vector art, vibrant colors',
          watercolor: 'soft artistic watercolor painting',
          pixel: '8-bit pixel art, retro game style',
          realistic: 'photorealistic, high detailed'
        };
        const stylePrompt = stylePrompts[config.imageStyle] || stylePrompts['ghibli'];
        const randomBg = DUTCH_BACKGROUNDS[Math.floor(Math.random() * DUTCH_BACKGROUNDS.length)];

        const imgPrompt = `Create a ${stylePrompt} illustration of: "${contextSentence}". Key object: "${term}". 
        SETTING & CONTEXT: ${randomBg}. Atmosphere: Authentic Netherlands.
        STRICT REQUIREMENTS: STRICTLY NO TEXT. Pure visual art.`;

        try {
          const imgResp = await withTimeout<GenerateContentResponse>(
              ai.models.generateContent({
                model: "gemini-3-pro-image-preview",
                contents: { parts: [{ text: imgPrompt }] },
                config: { imageConfig: { imageSize: "1K" } }
              }), 
              25000 
          );
          
          const base64Img = imgResp.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
          
          if (base64Img) {
            onLog(`   -> Optimizing: Resizing to 512px & Compressing to JPEG...`);
            const watermarkedBase64 = await addWatermark(base64Img);

            const rawBytes = base64ToUint8Array(watermarkedBase64);
            if (rawBytes) {
                // Changed from 'image/png' to 'image/jpeg'
                const blob = new Blob([rawBytes], { type: 'image/jpeg' });
                // Changed extension to .jpg
                const fileName = `images/${term}_${config.imageStyle}_${Date.now()}.jpg`;
                
                const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, blob, { contentType: 'image/jpeg' });
                if (!upErr) {
                   const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
                   await supabase.from('word_images').upsert({
                     word_id: wordId,
                     style: config.imageStyle, 
                     image_url: urlData.publicUrl
                   }, { onConflict: 'word_id, style' });
                   onLog(`✅ Image uploaded (Optimized).`);
                }
            }
          }
        } catch (imgErr: any) {
          onLog(`⚠️ Image failed: ${imgErr.message}`);
        }
      }

      // --- PHASE C: AUDIO GENERATION (ELEVENLABS) ---
      if (hasAudioTask && wordId) {
        onLog(`🗣️ Processing Audio (ElevenLabs)...`);
        
        if (!elevenLabsKey) {
            onLog(`   ❌ Skipping Audio: No ElevenLabs Key provided.`);
        } else {
            const generateAndUploadTTS = async (text: string, pathPrefix: string, specificVoiceId: string): Promise<string | null> => {
               if (!text) return null;
               
               let attempt = 0;
               const maxRetries = 2;

               while (attempt < maxRetries) {
                 try {
                   const url = `https://api.elevenlabs.io/v1/text-to-speech/${specificVoiceId}?output_format=mp3_44100_128`;
                   
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
                        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                      })
                   });

                   if (!response.ok) {
                     if (response.status === 429) throw new Error("Quota Exceeded");
                     const errData = await response.json().catch(() => ({ detail: "Unknown Error" }));
                     const errMsg = JSON.stringify(errData);
                     throw new Error(`API Error ${response.status}: ${errMsg}`);
                   }

                   const blob = await response.blob();
                   const fileName = `${pathPrefix}/${term}_${Date.now()}.mp3`;
                   
                   const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, blob, { contentType: 'audio/mpeg' });
                   if (!upErr) {
                       const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
                       return urlData.publicUrl;
                   } else {
                       onLog(`   ⚠️ Storage Upload Error: ${upErr.message}`);
                       return null;
                   }

                 } catch (e: any) { 
                    attempt++;
                    if (e.message.includes('Quota')) {
                        onLog(`   ⚠️ [TTS] Quota Exceeded (429).`);
                        return null;
                    }
                    if (attempt >= maxRetries) onLog(`   ⚠️ [TTS] Generation failed: ${e.message}`);
                    await sleep(1000);
                 }
               }
               return null;
            };

            // 1. Word Audio
            if (config.tasks.audioWord) {
                const wordHasAudio = !!existingWordRow?.pronunciation_audio_url;
                if (wordHasAudio && !config.overwriteAudio) {
                     onLog(`   ⏭️ [Word] Audio exists. Skipping.`);
                } else {
                    let textToSpeak = term;
                    const article = wordData?.grammar_data?.article;
                    if (article && (article === 'de' || article === 'het')) {
                        textToSpeak = `${article} ${term}`;
                    }
                    const wordAudioUrl = await generateAndUploadTTS(textToSpeak, 'audio/words', voiceIds.word);
                    if (wordAudioUrl) {
                       await supabase.from('words').update({ pronunciation_audio_url: wordAudioUrl }).eq('id', wordId);
                       onLog(`   -> [Word] MP3 ${wordHasAudio ? 'Overwritten' : 'Saved'}.`);
                    }
                }
            }

            // 2. Examples Audio
            if (wordData.examples) {
               let idx = 0;
               for (const ex of wordData.examples) {
                  const sIndex = (ex as any).index !== undefined ? (ex as any).index : idx;
                  const shouldGen = (sIndex === 0 && config.tasks.audioEx1) || (sIndex === 1 && config.tasks.audioEx2);

                  if (shouldGen && ex.dutch) {
                     const exHasAudio = (ex as any).hasAudio;
                     if (exHasAudio && !config.overwriteAudio) {
                          onLog(`   ⏭️ [Example ${sIndex + 1}] Audio exists. Skipping.`);
                     } else {
                         await sleep(500); 
                         const targetVoiceId = (sIndex === 0) ? voiceIds.ex1 : voiceIds.ex2;
                         const exUrl = await generateAndUploadTTS(ex.dutch, 'audio/examples', targetVoiceId);
                         if (exUrl) {
                            await supabase.from('examples').update({ audio_url: exUrl })
                              .eq('word_id', wordId)
                              .eq('language_code', targetLangCode)
                              .eq('sentence_index', sIndex);
                            onLog(`   -> [Example ${sIndex + 1}] MP3 ${exHasAudio ? 'Overwritten' : 'Saved'}.`);
                         }
                     }
                  }
                  idx++;
               }
            }
        }
      }

      onLog(`🎉 Finished [${term}].`);

    } catch (e: any) {
      onLog(`❌ Error processing ${term}: ${e.message}`);
    }

    if (i < words.length - 1) {
      await sleep(DELAY_BETWEEN_WORDS_MS);
    }
  }
  
  onLog(`\n✨ Batch process completed!`);
};