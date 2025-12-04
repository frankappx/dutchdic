
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";

// Configuration for rate limiting
const DELAY_BETWEEN_WORDS_MS = 25000; // 25 seconds (Very safe for 20 RPM limit on Pro Image)
const STORAGE_BUCKET = 'dictionary-assets';

// Helper: Pause execution
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Helper: Base64 to Blob
const base64ToBlob = (base64: string, mimeType: string) => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
};

const getLanguageName = (code: string) => {
  const map: Record<string, string> = {
    'en': 'English', 'zh': 'Chinese (Simplified)', 'es': 'Spanish', 
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

  // Initialize Clients
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const ai = new GoogleGenAI({ apiKey });
  const targetLangName = getLanguageName(targetLangCode);

  onLog(`🚀 Starting batch process for ${words.length} words...`);
  onLog(`🌍 Generating content for: ${targetLangName} (${targetLangCode})`);
  onLog(`⏱️ Speed limit: 1 word every ${DELAY_BETWEEN_WORDS_MS/1000}s to protect API quota.`);

  for (let i = 0; i < words.length; i++) {
    const term = words[i].trim();
    if (!term) continue;

    onLog(`\n-----------------------------------`);
    onLog(`🤖 Processing [${i + 1}/${words.length}]: ${term}`);

    try {
      // 1. GENERATE TEXT DATA (Gemini 2.5 Flash - Fast)
      onLog(`📝 Generating definitions...`);
      const prompt = `
        Analyze the Dutch word "${term}".
        Target Language (Learning): Dutch (nl). 
        Source Language (Translation): ${targetLangName} (${targetLangCode}).
        
        Strictly return JSON:
        {
          "definition": "Definition strictly in ${targetLangName}",
          "partOfSpeech": "zn. / ww. / bn.",
          "grammar_data": { 
             "plural": "huizen (if noun, in Dutch)", 
             "article": "de/het (if noun)",
             "verbForms": "lopen - liep - gelopen (if verb, in Dutch)", 
             "synonyms": ["Dutch word 1", "Dutch word 2"],
             "antonyms": ["Dutch word 1"]
          },
          "usageNote": "Fun tip strictly in ${targetLangName}",
          "examples": [
            { "dutch": "Dutch sentence 1", "translation": "Translation in ${targetLangName}" },
            { "dutch": "Dutch sentence 2", "translation": "Translation in ${targetLangName}" }
          ]
        }
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
                    translation: { type: Type.STRING } // Using generic 'translation' key to avoid casing issues
                  }
                }
              }
            }
          }
        }
      });
      
      let rawText = textResp.text || "{}";
      rawText = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
      
      const textData = JSON.parse(rawText);
      
      if (!textData.definition) throw new Error("Failed to generate text data");

      // 2. GENERATE IMAGE (Gemini 3 Pro Image - High Quality)
      onLog(`🎨 Painting illustration (Ghibli style)...`);
      // Use the Dutch example for image context
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
          const blob = base64ToBlob(base64Img, 'image/png');
          const fileName = `images/${term}_ghibli_${Date.now()}.png`;
          const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, blob, { contentType: 'image/png' });
          if (upErr) {
             if (upErr.message.includes("Bucket not found")) {
                throw new Error("Bucket 'dictionary-assets' not found. Please create it in Supabase > Storage (Public).");
             }
             throw upErr;
          }
          
          const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
          publicImgUrl = urlData.publicUrl;
          onLog(`✅ Image uploaded.`);
        }
      } catch (imgErr: any) {
        onLog(`⚠️ Image failed: ${imgErr.message}`);
      }

      // 3. GENERATE AUDIO (TTS) & UPLOAD
      const generateAndUploadTTS = async (text: string, pathPrefix: string): Promise<string | null> => {
        try {
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
             const blob = base64ToBlob(audioBase64, 'audio/wav');
             const fileName = `${pathPrefix}/${term}_${Date.now()}.wav`; 
             const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, blob, { contentType: 'audio/wav' });
             if (!upErr) {
               const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
               return urlData.publicUrl;
             }
          }
        } catch (e) { return null; }
        return null;
      };

      onLog(`🗣️ Generating Audio (TTS)...`);
      const wordAudioUrl = await generateAndUploadTTS(term, 'audio/words');
      const usageAudioUrl = await generateAndUploadTTS(textData.usageNote, `audio/notes_${targetLangCode}`);
      
      const exampleAudioUrls: string[] = [];
      if (textData.examples) {
        for (const ex of textData.examples) {
           const url = await generateAndUploadTTS(ex.dutch, 'audio/examples');
           exampleAudioUrls.push(url || "");
        }
      }

      // 4. INSERT INTO DATABASE
      onLog(`💾 Saving to Database (${targetLangCode})...`);
      
      // Upsert Word (Language Neutral)
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

      // Upsert Localized Content (Specific Language)
      await supabase.from('localized_content').upsert({
        word_id: wordId,
        language_code: targetLangCode, // Use the selected language
        definition: textData.definition,
        usage_note: textData.usageNote,
        usage_note_audio_url: usageAudioUrl
      }, { onConflict: 'word_id, language_code' });

      // Upsert Examples (Specific Language)
      if (textData.examples) {
        let idx = 0;
        for (const ex of textData.examples) {
          // Robust check for translation keys
          const translationText = ex.translation || (ex as any).english || (ex as any).chinese || "";
          
          await supabase.from('examples').upsert({
            word_id: wordId,
            language_code: targetLangCode, // Use the selected language
            sentence_index: idx,
            dutch_sentence: ex.dutch,
            translation: translationText,
            audio_url: exampleAudioUrls[idx]
          }, { onConflict: 'word_id, language_code, sentence_index' });
          idx++;
        }
      }

      // Upsert Image (Language Neutral - attached to word)
      if (publicImgUrl) {
        await supabase.from('word_images').upsert({
          word_id: wordId,
          style: 'ghibli', // Currently fixed to Ghibli, can be dynamic later
          image_url: publicImgUrl
        }, { onConflict: 'word_id, style' });
      }

      onLog(`🎉 Success! Saved [${term}].`);

    } catch (e: any) {
      onLog(`❌ Error processing ${term}: ${e.message}`);
    }

    // Wait before next word
    if (i < words.length - 1) {
      onLog(`⏳ Waiting ${DELAY_BETWEEN_WORDS_MS/1000}s...`);
      await sleep(DELAY_BETWEEN_WORDS_MS);
    }
  }
  
  onLog(`\n✨ Batch process completed!`);
};
