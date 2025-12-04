
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";

// Configuration for rate limiting
const DELAY_BETWEEN_WORDS_MS = 10000; // Reduced to 10s as Flash is faster, but kept safe for Image model
const STORAGE_BUCKET = 'dictionary-assets';

// Helper: Pause execution
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Helper: Create WAV Header for Raw PCM Data
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
  onLog: (msg: string) => void
) => {
  if (!serviceRoleKey || !supabaseUrl || !apiKey) {
    onLog("❌ Error: Missing credentials.");
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const ai = new GoogleGenAI({ apiKey });
  const targetLangName = getLanguageName(targetLangCode);

  onLog(`🚀 Starting batch process for ${words.length} words...`);
  onLog(`🌍 Output Language: ${targetLangName} (${targetLangCode})`);
  onLog(`⏱️ Speed limit: 1 word every ${DELAY_BETWEEN_WORDS_MS/1000}s.`);

  for (let i = 0; i < words.length; i++) {
    const term = words[i].trim();
    if (!term) continue;

    onLog(`\n-----------------------------------`);
    onLog(`🤖 Processing [${i + 1}/${words.length}]: ${term}`);

    try {
      // 1. GENERATE TEXT DATA (Gemini 2.5 Flash for Reliability)
      onLog(`📝 Generating definitions...`);
      
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
        4. "usageNote": Short cultural/usage tip in ${targetLangName} (max 20 words).
        5. "examples": Array of exactly 2 objects:
           - "dutch": The Dutch sentence.
           - "translation": The ${targetLangName} translation.

        STRICTLY OUTPUT VALID JSON.
      `;
      
      const textResp = await ai.models.generateContent({
        model: "gemini-2.5-flash", // Using Flash for speed and strict JSON adherence
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
      let textData;
      try {
        textData = JSON.parse(rawText);
      } catch (parseError: any) {
        throw new Error(`Failed to parse JSON response.`);
      }
      
      if (!textData.definition) throw new Error("Failed to generate text data");

      // 2. GENERATE IMAGE (Gemini 3 Pro Image)
      onLog(`🎨 Painting illustration...`);
      const imageContext = textData.examples?.[0]?.dutch || term;
      const imgPrompt = `Studio Ghibli style illustration of: "${imageContext}". Key object: "${term}". Relaxed, detailed, vibrant colors.`;
      
      let publicImgUrl = null;
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
              const fileName = `images/${term}_ghibli_${Date.now()}.png`;
              const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, blob, { contentType: 'image/png' });
              if (!upErr) {
                 const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
                 publicImgUrl = urlData.publicUrl;
                 onLog(`✅ Image uploaded.`);
              }
          }
        }
      } catch (imgErr: any) {
        onLog(`⚠️ Image failed: ${imgErr.message}`);
      }

      // 3. GENERATE AUDIO (TTS)
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

      onLog(`🗣️ Generating Audio...`);
      const wordAudioUrl = await generateAndUploadTTS(term, 'audio/words');
      await sleep(500);
      const usageAudioUrl = await generateAndUploadTTS(textData.usageNote, `audio/notes_${targetLangCode}`);
      
      const exampleAudioUrls: string[] = [];
      if (textData.examples) {
        for (const ex of textData.examples) {
           await sleep(500); 
           const url = await generateAndUploadTTS(ex.dutch, 'audio/examples');
           exampleAudioUrls.push(url || "");
        }
      }

      // 4. SAVE TO DB
      onLog(`💾 Saving to Database...`);
      
      const { data: wordRow, error: wordErr } = await supabase
        .from('words')
        .upsert({ 
          term: term, 
          part_of_speech: textData.partOfSpeech,
          grammar_data: textData.grammar_data,
          pronunciation_audio_url: wordAudioUrl
        }, { onConflict: 'term' })
        .select()
        .single();
      
      if (wordErr) throw wordErr;
      const wordId = wordRow.id;

      await supabase.from('localized_content').upsert({
        word_id: wordId,
        language_code: targetLangCode,
        definition: textData.definition,
        usage_note: textData.usageNote,
        usage_note_audio_url: usageAudioUrl
      }, { onConflict: 'word_id, language_code' });

      if (textData.examples) {
        let idx = 0;
        for (const ex of textData.examples) {
          await supabase.from('examples').upsert({
            word_id: wordId,
            language_code: targetLangCode,
            sentence_index: idx,
            dutch_sentence: ex.dutch,
            translation: ex.translation,
            audio_url: exampleAudioUrls[idx]
          }, { onConflict: 'word_id, language_code, sentence_index' });
          idx++;
        }
      }

      if (publicImgUrl) {
        await supabase.from('word_images').upsert({
          word_id: wordId,
          style: 'ghibli', 
          image_url: publicImgUrl
        }, { onConflict: 'word_id, style' });
      }

      onLog(`🎉 Success! Saved [${term}].`);

    } catch (e: any) {
      onLog(`❌ Error processing ${term}: ${e.message}`);
    }

    if (i < words.length - 1) {
      onLog(`⏳ Waiting ${DELAY_BETWEEN_WORDS_MS/1000}s...`);
      await sleep(DELAY_BETWEEN_WORDS_MS);
    }
  }
  
  onLog(`\n✨ Batch process completed!`);
};
