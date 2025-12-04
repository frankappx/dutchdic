
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";
import { ImageStyle } from '../types';

// Configuration for rate limiting
const DELAY_BETWEEN_WORDS_MS = 3000; 
const STORAGE_BUCKET = 'dictionary-assets';

export interface BatchConfig {
  tasks: {
    text: boolean;
    image: boolean;
    audio: boolean;
  };
  imageStyle: ImageStyle;
}

// Helper: Pause execution
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Helper: Create WAV Header
const createWavFile = (pcmData: Uint8Array): Blob => {
  const numChannels = 1;
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  const pcmBytes = new Uint8Array(buffer, 44);
  pcmBytes.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
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
  apiKey: string,
  supabaseUrl: string,
  targetLangCode: string,
  config: BatchConfig,
  onLog: (msg: string) => void
) => {
  if (!serviceRoleKey || !supabaseUrl || !apiKey) {
    onLog("❌ Error: Missing credentials.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const ai = new GoogleGenAI({ apiKey });
  const targetLangName = getLanguageName(targetLangCode);

  onLog(`🌍 Output Language: ${targetLangName} (${targetLangCode})`);
  onLog(`⚙️ Tasks: ${config.tasks.text ? '[Text] ' : ''}${config.tasks.image ? '[Image: '+config.imageStyle+'] ' : ''}${config.tasks.audio ? '[Audio] ' : ''}`);

  for (let i = 0; i < words.length; i++) {
    const term = words[i].trim();
    if (!term) continue;

    onLog(`\n-----------------------------------`);
    onLog(`🤖 Processing [${i + 1}/${words.length}]: ${term}`);

    let wordId: string | null = null;
    let wordData: any = null;

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

        const textResp = await ai.models.generateContent({
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
        });

        let rawText = textResp.text || "{}";
        try {
          wordData = JSON.parse(rawText);
        } catch (e) { throw new Error("JSON Parse failed"); }

        // Save Word Base
        // Note: We do NOT clear pronunciation_audio_url here because the word term hasn't changed.
        const { data: wordRow, error: wordErr } = await supabase
          .from('words')
          .upsert({ 
            term: term, 
            part_of_speech: wordData.partOfSpeech,
            grammar_data: wordData.grammar_data
          }, { onConflict: 'term' })
          .select()
          .single();
        
        if (wordErr) throw wordErr;
        wordId = wordRow.id;

        // Save Localized Content
        await supabase.from('localized_content').upsert({
          word_id: wordId,
          language_code: targetLangCode,
          definition: wordData.definition,
          usage_note: wordData.usageNote
        }, { onConflict: 'word_id, language_code' });

        // Save Examples
        if (wordData.examples) {
          let idx = 0;
          for (const ex of wordData.examples) {
            // CRITICAL: When updating text, we MUST clear the old audio_url for examples
            // because the new sentence likely differs from the old one.
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
        onLog(`✅ Text saved (Example audio reset).`);
      }

      // --- LOOKUP LOGIC: FETCH EXISTING WORD IF TEXT TASK IS SKIPPED ---
      if (!wordId && (config.tasks.image || config.tasks.audio)) {
         onLog(`🔍 Checking database for existing word: "${term}"...`);
         
         const { data: existWord } = await supabase
            .from('words')
            .select('id')
            .eq('term', term)
            .maybeSingle(); 

         if (!existWord) {
           onLog(`⚠️ Word "${term}" NOT FOUND in database. Skipping Image/Audio.`);
           onLog(`   Please run "Text Content" task first for this word.`);
           continue; 
         }
         
         wordId = existWord.id;
         onLog(`   -> Found ID: ${wordId}`);

         // We need 'wordData' (specifically examples) for Image context and Audio text
         if (!wordData) {
            const { data: existExs } = await supabase
              .from('examples')
              .select('dutch_sentence, sentence_index')
              .eq('word_id', wordId)
              .eq('language_code', targetLangCode); 
            
            // Reconstruct a minimal wordData object
            wordData = { 
              examples: existExs ? existExs.map((e: any) => ({ 
                dutch: e.dutch_sentence, 
                index: e.sentence_index 
              })) : [] 
            };
            
            // Fallback for image context
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
          ghibli: 'Studio Ghibli anime style, detailed backgrounds, soft colors',
          flat: 'minimalist flat design, vector art, vibrant colors',
          watercolor: 'soft artistic watercolor painting',
          pixel: '8-bit pixel art, retro game style',
          realistic: 'photorealistic, high detailed'
        };
        const stylePrompt = stylePrompts[config.imageStyle] || stylePrompts['ghibli'];

        const imgPrompt = `Create a ${stylePrompt} illustration of: "${contextSentence}". Key object: "${term}". Ensure the image clearly depicts the meaning.`;

        try {
          const imgResp = await ai.models.generateContent({
            model: "gemini-3-pro-image-preview",
            contents: { parts: [{ text: imgPrompt }] },
            config: { imageConfig: { imageSize: "1K" } }
          });
          
          const base64Img = imgResp.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
          
          if (base64Img) {
            const rawBytes = base64ToUint8Array(base64Img);
            if (rawBytes) {
                const blob = new Blob([rawBytes], { type: 'image/png' });
                const fileName = `images/${term}_${config.imageStyle}_${Date.now()}.png`;
                const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, blob, { contentType: 'image/png' });
                if (!upErr) {
                   const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
                   
                   await supabase.from('word_images').upsert({
                     word_id: wordId,
                     style: config.imageStyle, 
                     image_url: urlData.publicUrl
                   }, { onConflict: 'word_id, style' });
                   
                   onLog(`✅ Image uploaded.`);
                }
            }
          }
        } catch (imgErr: any) {
          onLog(`⚠️ Image failed: ${imgErr.message}`);
        }
      }

      // --- PHASE C: AUDIO GENERATION ---
      if (config.tasks.audio && wordId) {
        onLog(`🗣️ Generating Audio (Word & Examples Only)...`);
        
        const generateAndUploadTTS = async (text: string, pathPrefix: string): Promise<string | null> => {
           try {
             if (!text) return null;
             const ttsResp = await ai.models.generateContent({
               model: "gemini-2.5-flash-preview-tts",
               contents: [{ parts: [{ text }] }],
               config: {
                 responseModalities: ['AUDIO' as any],
                 speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
               },
             });
             const audioBase64 = ttsResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
             if (audioBase64) {
                const pcmData = base64ToUint8Array(audioBase64);
                if (pcmData) {
                    const wavBlob = createWavFile(pcmData);
                    const fileName = `${pathPrefix}/${term}_${Date.now()}.wav`; 
                    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, wavBlob, { contentType: 'audio/wav' });
                    if (!upErr) {
                       const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
                       return urlData.publicUrl;
                    }
                }
             }
           } catch (e) { return null; }
           return null;
        };

        // 1. Word Audio
        const wordAudioUrl = await generateAndUploadTTS(term, 'audio/words');
        if (wordAudioUrl) {
           await supabase.from('words').update({ pronunciation_audio_url: wordAudioUrl }).eq('id', wordId);
           onLog(`   -> Word audio saved.`);
        }

        // 2. Example Audio (Skip Usage Note)
        if (wordData.examples) {
           let idx = 0;
           for (const ex of wordData.examples) {
              await sleep(1000); // Rate limit buffer
              
              const sentence = ex.dutch;
              // Safe fallback for index if we fetched from DB (where it might be stored) vs generated
              const sIndex = (ex as any).index !== undefined ? (ex as any).index : idx;
              
              if (sentence) {
                 const exUrl = await generateAndUploadTTS(sentence, 'audio/examples');
                 if (exUrl) {
                    await supabase.from('examples').update({ audio_url: exUrl })
                      .eq('word_id', wordId)
                      .eq('language_code', targetLangCode)
                      .eq('sentence_index', sIndex);
                    onLog(`   -> Example ${sIndex + 1} audio saved.`);
                 }
              }
              idx++;
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
