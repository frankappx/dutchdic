import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";

// Configuration for rate limiting
const DELAY_BETWEEN_WORDS_MS = 25000; // 25 seconds (Safe for Pro Image limits)
const STORAGE_BUCKET = 'dictionary-assets';

// Helper: Pause execution
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Helper: Create WAV Header for Raw PCM Data
// Gemini TTS returns: 24kHz, 1 Channel (Mono), 16-bit PCM
const createWavFile = (pcmData: Uint8Array): Blob => {
  const numChannels = 1;
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Write PCM data
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
      // 1. GENERATE TEXT DATA (Switching to Gemini 3 Pro for stability)
      onLog(`📝 Generating definitions...`);
      
      const systemInstruction = `
        You are a Strict Dictionary Database Generator.
        Output ONLY valid JSON.
        NO markdown formatting (no \`\`\`json).
        NO conversational text.
        Concise definitions.
      `;

      const prompt = `
        Task: Analyze the Dutch word "${term}" and output structured JSON.
        
        Constraints:
        1. Target Language: Dutch (nl). Source Language: ${targetLangName} (${targetLangCode}).
        2. Definition: Max 15 words. Concise.
        3. Usage Note: Max 2 sentences (approx 20 words). Fun/Casual tone.
        4. Examples: Exactly 2 examples.
        5. Synonyms/Antonyms: Max 5 items each. PROVIDE AT LEAST 1.
        6. OUTPUT: Pure JSON only. NO EXPLANATIONS.

        Output Format (JSON):
        {
          "definition": "Definition in ${targetLangName}",
          "partOfSpeech": "zn. / ww. / bn.",
          "grammar_data": { 
             "plural": "huizen (if noun)", 
             "article": "de/het",
             "verbForms": "lopen - liep - gelopen (if verb)", 
             "synonyms": ["word1", "word2"],
             "antonyms": ["word1"]
          },
          "usageNote": "Fun tip strictly in ${targetLangName}. KEEP IT SHORT.",
          "examples": [
            { "dutch": "Dutch sentence 1", "translation": "Trans 1" },
            { "dutch": "Dutch sentence 2", "translation": "Trans 2" }
          ]
        }
      `;
      
      // SWITCHED TO gemini-3-pro-preview to prevent looping/hallucinations
      const textResp = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          maxOutputTokens: 8192, 
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
                    translation: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      });
      
      let rawText = textResp.text || "{}";
      
      // Robust JSON extraction
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
         rawText = rawText.substring(firstBrace, lastBrace + 1);
      } else {
         rawText = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
      }
      
      let textData;
      try {
        textData = JSON.parse(rawText);
      } catch (parseError: any) {
        console.error("JSON Parse Error. Raw Text:", rawText.substring(0, 500) + "...");
        throw new Error(`Failed to parse JSON response: ${parseError.message}`);
      }
      
      if (!textData.definition) throw new Error("Failed to generate text data");

      // 2. GENERATE IMAGE (Gemini 3 Pro Image)
      onLog(`🎨 Painting illustration (Ghibli style)...`);
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
          if (rawBytes && rawBytes.length > 0) {
              const blob = new Blob([rawBytes], { type: 'image/png' });
              const fileName = `images/${term}_ghibli_${Date.now()}.png`;
              const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, blob, { contentType: 'image/png' });
              if (upErr) {
                 if (upErr.message.includes("Bucket not found")) {
                    throw new Error("Bucket 'dictionary-assets' not found.");
                 }
                 throw upErr;
              }
              const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
              publicImgUrl = urlData.publicUrl;
              onLog(`✅ Image uploaded.`);
          }
        }
      } catch (imgErr: any) {
        onLog(`⚠️ Image failed: ${imgErr.message}`);
      }

      // 3. GENERATE AUDIO (TTS) & UPLOAD - RAW PCM -> WAV
      const generateAndUploadTTS = async (text: string, pathPrefix: string): Promise<string | null> => {
        try {
          if (!text || text.length === 0) return null;
          
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
             
             if (pcmData && pcmData.length > 0) {
                 // Convert Raw PCM to WAV
                 const wavBlob = createWavFile(pcmData);
                 
                 // Save as .wav
                 const fileName = `${pathPrefix}/${term}_${Date.now()}.wav`; 
                 const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, wavBlob, { contentType: 'audio/wav' });
                 
                 if (upErr) {
                    console.warn(`Failed to upload TTS for ${text.substring(0, 10)}...`, upErr);
                    return null;
                 }
                 
                 const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
                 return urlData.publicUrl;
             }
          }
        } catch (e) { 
            console.warn("TTS Gen Error:", e);
            return null; 
        }
        return null;
      };

      onLog(`🗣️ Generating Audio (TTS)...`);
      const wordAudioUrl = await generateAndUploadTTS(term, 'audio/words');
      
      // Small pause to prevent rate limiting
      await sleep(1000); 
      const usageAudioUrl = await generateAndUploadTTS(textData.usageNote, `audio/notes_${targetLangCode}`);
      
      const exampleAudioUrls: string[] = [];
      if (textData.examples) {
        for (const ex of textData.examples) {
           await sleep(500); 
           const url = await generateAndUploadTTS(ex.dutch, 'audio/examples');
           exampleAudioUrls.push(url || "");
        }
      }

      // 4. INSERT INTO DATABASE
      onLog(`💾 Saving to Database (${targetLangCode})...`);
      
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
          const translationText = ex.translation || (ex as any).english || (ex as any).chinese || "";
          
          await supabase.from('examples').upsert({
            word_id: wordId,
            language_code: targetLangCode,
            sentence_index: idx,
            dutch_sentence: ex.dutch,
            translation: translationText,
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