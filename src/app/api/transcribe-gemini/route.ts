import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes max for transcription

// オフセット文字列（例: "1.500s", "00:01:23", 1.5）を秒数（float）に変換
function parseOffsetSeconds(offset: any): number {
  if (typeof offset === "number") return offset;
  if (!offset) return 0;
  const s = String(offset).trim().replace(/s$/, "");
  const num = parseFloat(s);
  if (!isNaN(num)) return num;
  return parseTimestampSeconds(String(offset));
}

// 時間文字列（例: "01:23", "00:01:23", "1:23.45"）を秒数（float）に変換
function parseTimestampSeconds(ts: string): number {
  if (!ts) return 0;
  const parts = ts.trim().split(":").map(p => parseFloat(p));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

// AIのメタ発言（挨拶文、説明文、Markdown記号等）かどうか判定
function isMetaLine(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  if (s.startsWith("```") || s.startsWith("#")) return true;
  if (/^(了解|承知|かしこまり|以下|音声|文字起こし|会話|出力結果|※|注[:：]|---|\*\*\*)/.test(s)) return true;
  if (/^(以下に|こちらが|上記の|ご提示|文字起こしを(行い|開始|出力))/.test(s)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    let fileUri = (formData.get("file_uri") as string || "").trim();
    let mimeType = (formData.get("mime_type") as string || "").trim() || "audio/mp3";
    const apiKey = (formData.get("api_key") as string || process.env.GEMINI_API_KEY || "").trim();
    let modelParam = (formData.get("gemini_model") as string || "").trim();
    const customDictionaryJson = formData.get("custom_dictionary_json") as string || "[]";
    const preRegisteredSpeakersJson = formData.get("pre_registered_speakers_json") as string || "[]";
    const speakerCountHint = (formData.get("speaker_count_hint") as string || "").trim();

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API Key が設定されていません" }, { status: 400 });
    }

    // デフォルトモデルは最新の公式音声特化モデル gemini-3.5-transcribe
    if (!modelParam) {
      modelParam = "gemini-3.5-transcribe";
    }

    // 1. Google File API への直接アップロード（未アップロードの場合）
    if (!fileUri && file) {
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);
      mimeType = file.type || mimeType;

      const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Command": "start, upload, finalize",
          "X-Goog-Upload-Header-Content-Length": String(fileBuffer.length),
          "X-Goog-Upload-Header-Content-Type": mimeType,
          "Content-Type": mimeType,
        },
        body: fileBuffer,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        return NextResponse.json(
          { error: `Google File Upload failed (${uploadRes.status}): ${errText}` },
          { status: uploadRes.status }
        );
      }

      const uploadData = await uploadRes.json();
      fileUri = uploadData.file?.uri;

      // 音声処理が PROCESSING の場合は ACTIVE になるまで待機（最大60秒）
      const fileName = uploadData.file?.name;
      let fileState = uploadData.file?.state;
      if (fileName && fileState === "PROCESSING") {
        console.log(`[Gemini API] Audio file is PROCESSING, waiting for state ACTIVE... (${fileName})`);
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`);
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              fileState = checkData.state;
              if (fileState === "ACTIVE") {
                console.log("[Gemini API] Audio file is ACTIVE!");
                break;
              } else if (fileState === "FAILED") {
                return NextResponse.json({ error: "Google File API で音声処理が失敗しました (STATE: FAILED)" }, { status: 400 });
              }
            }
          } catch (e) {
            console.warn("[Gemini API] Error checking file state:", e);
          }
        }
      }
    }

    if (!fileUri) {
      return NextResponse.json({ error: "音声データ（file または file_uri）が指定されていません" }, { status: 400 });
    }

    // 2. 利用可能なモデル一覧を Google API から動的に取得（404の根絶）
    let availableModels: string[] = [];
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        availableModels = (listData.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => m.name.replace("models/", ""));
        console.log("[Gemini API] Dynamically discovered available models:", availableModels);
      }
    } catch (e) {
      console.warn("[Gemini API] Failed to fetch ListModels:", e);
    }

    // 候補モデルリストの構築
    const requestedModel = (modelParam || "").replace("models/", "").trim();
    let candidateModels: string[] = [];

    // ユーザー指定モデル
    if (requestedModel && !requestedModel.includes("flash-lite")) {
      candidateModels.push(requestedModel);
    } else {
      candidateModels.push("gemini-3.5-transcribe");
    }

    // 推奨の現役モデル優先順
    const preferredOrder = [
      "gemini-3.5-transcribe",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ];

    if (availableModels.length > 0) {
      // 実際に API に存在するモデルのみを優先順で追加
      for (const pref of preferredOrder) {
        if (availableModels.includes(pref) && !candidateModels.includes(pref)) {
          candidateModels.push(pref);
        }
      }
      // その他 Gemini モデル
      for (const av of availableModels) {
        if (!candidateModels.includes(av) && av.toLowerCase().includes("gemini") && !av.toLowerCase().includes("lite") && !av.toLowerCase().includes("8b")) {
          candidateModels.push(av);
        }
      }
    } else {
      // ListModels が取得できなかった場合のフォールバック
      for (const pref of preferredOrder) {
        if (!candidateModels.includes(pref)) candidateModels.push(pref);
      }
    }

    // 3. 専門用語・固有名詞辞書
    let customWordsList: any[] = [];
    let dictLines: string[] = [];
    try {
      customWordsList = JSON.parse(customDictionaryJson);
      for (const w of customWordsList) {
        const term = w.term?.trim();
        const reading = w.reading?.trim();
        if (term) {
          if (reading) {
            dictLines.push(`・${term}（発音: ${reading}）`);
          } else {
            dictLines.push(`・${term}`);
          }
        }
      }
    } catch {}

    const dictInstruction = dictLines.length > 0
      ? `【登録単語・固有名詞（必ずこの表記を使用してください）】\n${dictLines.join("\n")}\n\n`
      : "";

    let registeredSpeakersList: any[] = [];
    let hintsInstruction = "";
    try {
      registeredSpeakersList = JSON.parse(preRegisteredSpeakersJson);
      const valid = registeredSpeakersList.filter((s: any) => s.name?.trim());
      if (valid.length > 0) {
        hintsInstruction = `【参加話者リスト（最優先でこの話者名を【話者名】として使用してください）】\n${valid.map((s: any) => `- ${s.name}${s.reading ? `（読み: ${s.reading}）` : ''}${s.role ? ` [役割: ${s.role}]` : ''}`).join('\n')}\n\n`;
      }
    } catch {}

    let countInstruction = "";
    if (speakerCountHint && speakerCountHint !== "auto") {
      countInstruction = `【参加人数】: この会話はおよそ「${speakerCountHint} 名」で進行されています。\n\n`;
    }

    const promptText = (
      "あなたは極めて高精度なプロフェッショナル日本語音声文字起こしAIです。\n" +
      "提供された音声ファイルを【最初から最後まで一切省略せず、すべて完全に文字起こし】してください。\n\n" +
      dictInstruction +
      hintsInstruction +
      countInstruction +
      "【最重要ルール：時間軸アンカーとセグメント分割】\n" +
      "1. 【タイムスタンプと話者の付与】:\n" +
      "   ・各発言ブロックの行頭に、必ず [分:秒 - 分:秒] のタイムスタンプと 【話者名】 を付与してください。\n" +
      "   ・例: [00:00 - 00:05] 【田中】皆さん、本日の会議を始めます。\n" +
      "2. 【正確な話者識別】:\n" +
      "   ・上記『参加話者リスト』にある人物が話している場合は、必ずその名前（例: 【田中】、【佐藤】）を使用してください。\n" +
      "   ・リストにない人物や特定できない場合は【話者1】、【話者2】を使用してください。\n" +
      "3. 【適切な文節・文ごとの分割】:\n" +
      "   ・極端な1単語ごとの細切れ（「はい。」だけで1行など）や、何分間も改行しない長文は禁止です。\n" +
      "   ・意味の通る1〜2文（句点『。』の区切り、おおよそ30〜80文字程度）ごとに新しい行として出力してください。\n" +
      "4. 【完全完走・省略禁止】: 途中で要約したり「〜中略〜」「以下省略」などと打ち切ることは絶対に禁止です。音声の最後の1秒まで漏らさず書き切ってください。\n" +
      "5. 【余計な出力の禁止】: 挨拶文（「承知しました」等）、解説、Markdownのバッククォート（```）等は一切出力せず、文字起こし行のみを直接出力してください。\n" +
      "6. 【辞書表記の厳守】: 登録単語は必ず指定された漢字・アルファベット表記で出力してください。\n\n" +
      "【出力形式の例】\n" +
      "[00:00 - 00:04] 【田中】皆さん、本日の定例ミーティングを始めます。\n" +
      "[00:04 - 00:09] 【田中】まず先月の進捗状況から確認させていただけますでしょうか。\n" +
      "[00:10 - 00:16] 【佐藤】はい、よろしくお願いします。資料の1ページ目をご確認ください。\n" +
      "[00:17 - 00:23] 【佐藤】先月の実績につきましては、目標に対して120%の達成となりました。\n" +
      "[00:24 - 00:29] 【田中】素晴らしい成果ですね。特にどの施策が効いたのでしょうか？"
    );

    // 4. 文字起こしリクエストの実行
    let parsedSegments: any[] = [];
    const speakerMap: Record<string, string> = {};
    const speakerDisplayNameMap: Record<string, string> = {};
    let speakerCounter = 0;

    // 事前登録話者のマッピングを初期化
    const validPreReg = registeredSpeakersList.filter((s: any) => s.name?.trim());
    validPreReg.forEach((sp: any, idx: number) => {
      const spId = `SPEAKER_${String(idx).padStart(2, "0")}`;
      speakerMap[sp.name.trim()] = spId;
      speakerDisplayNameMap[spId] = sp.name.trim();
    });
    speakerCounter = validPreReg.length;

    function getSpeakerId(rawSpk: string): string {
      if (!rawSpk) return "SPEAKER_00";
      if (/^SPEAKER_\d+$/i.test(rawSpk)) return rawSpk.toUpperCase();
      if (!speakerMap[rawSpk]) {
        const newId = `SPEAKER_${String(speakerCounter).padStart(2, "0")}`;
        speakerMap[rawSpk] = newId;
        speakerDisplayNameMap[newId] = rawSpk;
        speakerCounter++;
      }
      return speakerMap[rawSpk];
    }

    let usedModel = "";
    let lastError = "";

    // A. 最新公式音声特化モデル（gemini-3.5-transcribe）を公式 generateContent API で最優先実行
    if (candidateModels.includes("gemini-3.5-transcribe")) {
      try {
        console.log("[Gemini API] Requesting Gemini 3.5 Transcribe via official generateContent endpoint...");
        const transcribeUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${apiKey}`;
        const customVocab = customWordsList.map((w: any) => w.term?.trim()).filter(Boolean);

        const transcribeBody: any = {
          contents: [
            {
              parts: [
                {
                  fileData: {
                    fileUri: fileUri,
                    mimeType: mimeType,
                  }
                }
              ]
            }
          ],
          generationConfig: {
            audioTranscriptionConfig: {
              languageCodes: ["ja-JP"],
              diarization: true,
              wordTimestamp: true,
            }
          }
        };

        if (customVocab.length > 0) {
          transcribeBody.generationConfig.audioTranscriptionConfig.customVocabulary = customVocab;
        }

        const transcribeRes = await fetch(transcribeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(transcribeBody),
        });

        if (transcribeRes.ok) {
          const genData = await transcribeRes.json();
          console.log("[Gemini API] Gemini 3.5 Transcribe response received successfully");

          const candidate = genData.candidates?.[0];
          const parts = candidate?.content?.parts || [];

          let allWords: Array<{ word: string; speaker: string; start: number; end: number }> = [];
          let fallbackFullText = "";

          for (const part of parts) {
            if (part.text) {
              fallbackFullText += part.text + "\n";
            }
            const at = part.audioTranscription;
            if (at) {
              const speaker = at.speakerLabel || at.speaker || "";
              if (Array.isArray(at.words)) {
                for (const w of at.words) {
                  allWords.push({
                    word: w.word || "",
                    speaker: speaker,
                    start: parseOffsetSeconds(w.startOffset || w.start_offset || 0),
                    end: parseOffsetSeconds(w.endOffset || w.end_offset || 0),
                  });
                }
              }
            }
          }

          // 単語アノテーションが存在する場合、自然な会話セグメントに再構成
          if (allWords.length > 0) {
            let curSpeaker = "";
            let curWords: string[] = [];
            let curStart = 0;
            let curEnd = 0;

            const flush = () => {
              if (curWords.length === 0) return;
              const text = curWords.join("").trim();
              if (text) {
                const spkId = getSpeakerId(curSpeaker || "SPEAKER_00");
                parsedSegments.push({
                  id: `seg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                  speaker: spkId,
                  text: text,
                  start: Math.round(curStart * 10) / 10,
                  end: Math.round(curEnd * 10) / 10,
                });
              }
              curWords = [];
            };

            for (const item of allWords) {
              const spk = item.speaker || "SPEAKER_00";
              if (curWords.length === 0) {
                curSpeaker = spk;
                curStart = item.start;
                curEnd = item.end;
                curWords.push(item.word);
              } else if (
                curSpeaker !== spk ||
                (item.start - curEnd > 1.2) ||
                /[。！？\n]$/.test(curWords[curWords.length - 1])
              ) {
                flush();
                curSpeaker = spk;
                curStart = item.start;
                curEnd = item.end;
                curWords.push(item.word);
              } else {
                curWords.push(item.word);
                curEnd = Math.max(curEnd, item.end);
              }
            }
            flush();
          } else if (fallbackFullText.trim()) {
            // テキストのみ返却された場合
            parsedSegments.push({
              id: `seg_${Date.now()}_0`,
              speaker: "SPEAKER_00",
              text: fallbackFullText.trim(),
              start: 0,
              end: 0,
            });
          }

          if (parsedSegments.length > 0) {
            usedModel = "gemini-3.5-transcribe";
            console.log(`[Gemini API] Successfully parsed ${parsedSegments.length} segments with Gemini 3.5 Transcribe!`);
          }
        } else {
          const errText = await transcribeRes.text();
          lastError = `gemini-3.5-transcribe (${transcribeRes.status}): ${errText}`;
          console.warn("[Gemini API] gemini-3.5-transcribe generateContent failed:", lastError);

          // 後方互換性のため、Interactions API でも再試行してみる
          try {
            console.log("[Gemini API] Retrying via Interactions API...");
            const interUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`;
            const interRes = await fetch(interUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "gemini-3.5-transcribe",
                input: [{ type: "audio", uri: fileUri, mime_type: mimeType }],
                generation_config: {
                  transcription_config: {
                    language_codes: ["ja-JP"],
                    enable_speaker_diarization: true,
                    enable_word_timestamps: true,
                  }
                }
              })
            });
            if (interRes.ok) {
              const interData = await interRes.json();
              const step = interData.steps?.[0]?.content?.[0];
              const annotations = step?.annotations;
              if (annotations?.speaker_turns && Array.isArray(annotations.speaker_turns) && annotations.speaker_turns.length > 0) {
                for (const turn of annotations.speaker_turns) {
                  const spkId = getSpeakerId(turn.speaker || "SPEAKER_00");
                  const start = parseOffsetSeconds(turn.start_offset || 0);
                  const end = parseOffsetSeconds(turn.end_offset || start + 2);
                  parsedSegments.push({
                    id: `seg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    speaker: spkId,
                    text: (turn.text || "").trim(),
                    start: Math.round(start * 10) / 10,
                    end: Math.round(end * 10) / 10,
                  });
                }
                if (parsedSegments.length > 0) {
                  usedModel = "gemini-3.5-transcribe";
                  console.log(`[Gemini API] Successfully parsed ${parsedSegments.length} segments from Interactions API!`);
                }
              }
            }
          } catch (e2: any) {
            console.warn("[Gemini API] Interactions retry also failed:", e2.message);
          }
        }
      } catch (e: any) {
        lastError = `gemini-3.5-transcribe exception: ${e.message}`;
        console.warn("[Gemini API] Gemini 3.5 Transcribe exception, proceeding to fallback:", e);
      }
    }

    // B. generateContent による文字起こし（Interactions API 未使用またはフォールバック時）
    if (parsedSegments.length === 0) {
      let rawText = "";
      const fallbackModels = candidateModels.filter(m => m !== "gemini-3.5-transcribe" && !m.includes("flash-lite"));
      if (fallbackModels.length === 0) {
        fallbackModels.push("gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash");
      }

      const modelErrors: Record<string, string> = {};

      for (const modelCandidate of fallbackModels) {
        const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelCandidate}:generateContent?key=${apiKey}`;
        console.log(`[Gemini API] Requesting fallback transcription with model: ${modelCandidate}`);
        try {
          const genRes = await fetch(generateUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { fileData: { fileUri, mimeType } },
                  { text: promptText }
                ]
              }],
              generationConfig: {
                temperature: 0.0, // 決定論的で忠実な出力
                maxOutputTokens: 65536
              }
            }),
          });

          if (genRes.ok) {
            const genData = await genRes.json();
            const candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (candidateText && candidateText.trim().length > 0) {
              rawText = candidateText;
              usedModel = modelCandidate;
              console.log(`[Gemini API] Successfully transcribed using fallback model: ${modelCandidate}`);
              break;
            }
          } else {
            const errBody = await genRes.text();
            lastError = `(${genRes.status}) ${errBody}`;
            modelErrors[modelCandidate] = lastError;
            console.warn(`[Gemini API] Model ${modelCandidate} error: ${lastError}`);
          }
        } catch (e: any) {
          lastError = e.message;
          modelErrors[modelCandidate] = lastError;
          console.warn(`[Gemini API] Exception with ${modelCandidate}:`, e);
        }
      }

      if (!rawText) {
        const errDetails = Object.entries(modelErrors)
          .map(([m, err]) => `・【${m}】: ${err}`)
          .join("\n");
        return NextResponse.json(
          { error: `Gemini 文字起こしに失敗しました:\n${errDetails || lastError}` },
          { status: 500 }
        );
      }

      // 対話スクリプト形式 ➔ セグメント配列へ変換
      const rawLines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      let currentSpeaker = "SPEAKER_00";
      let lastEnd = 0;

      for (const line of rawLines) {
      // メタ行のスキップ
      if (isMetaLine(line) && !line.includes("【") && !line.includes("話者")) {
        continue;
      }

      // パターン1: [00:00 - 00:05] 【田中】発言内容
      // パターン2: [00:00] 【田中】発言内容
      // パターン3: 【田中】発言内容
      // パターン4: 田中: 発言内容
      let startSec = lastEnd;
      let endSec = lastEnd;
      let rawSpk = "";
      let lineText = line;

      // タイムスタンプの抽出
      const timeMatch = lineText.match(/^\[\s*([0-9:]+(?:\.[0-9]+)?)\s*(?:[-–~〜]\s*([0-9:]+(?:\.[0-9]+)?))?\s*\]\s*(.*)$/);
      if (timeMatch) {
        startSec = parseTimestampSeconds(timeMatch[1]);
        if (timeMatch[2]) {
          endSec = parseTimestampSeconds(timeMatch[2]);
        } else {
          endSec = startSec + 2.0;
        }
        lineText = timeMatch[3] || "";
      }

      // 話者名の抽出
      const spkMatch = lineText.match(/^(?:【([^】]+)】|([^\s:：]{1,20})\s*[:：])\s*(.*)$/);
      if (spkMatch) {
        rawSpk = (spkMatch[1] || spkMatch[2]).trim();
        lineText = spkMatch[3] ? spkMatch[3].trim() : "";
      }

      // 該当話者IDの決定
      if (rawSpk) {
        if (!speakerMap[rawSpk]) {
          if (/^SPEAKER_\d+$/i.test(rawSpk)) {
            speakerMap[rawSpk] = rawSpk.toUpperCase();
          } else {
            const newId = `SPEAKER_${String(speakerCounter).padStart(2, "0")}`;
            speakerMap[rawSpk] = newId;
            speakerDisplayNameMap[newId] = rawSpk;
            speakerCounter++;
          }
        }
        currentSpeaker = speakerMap[rawSpk];
      }

      lineText = lineText.trim();
      if (!lineText) continue;

      if (endSec <= startSec) {
        // 文字数に応じた大まかな秒数推定（1秒あたり約6〜8文字）
        endSec = startSec + Math.max(1.5, Math.min(10.0, lineText.length / 6));
      }
      lastEnd = endSec;

      const segId = `seg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      parsedSegments.push({
        id: segId,
        speaker: currentSpeaker,
        text: lineText,
        start: Math.round(startSec * 10) / 10,
        end: Math.round(endSec * 10) / 10,
      });
    }

    if (parsedSegments.length === 0) {
      parsedSegments.push({
        id: `seg_${Date.now()}_0`,
        speaker: "SPEAKER_00",
        text: rawText.trim(),
        start: 0,
        end: 0,
      });
    }
  }

    // 6. 辞書単語の確実な置換
    const normalized = parsedSegments.map((s: any) => {
      let text = String(s.text || "").trim();

      for (const w of customWordsList) {
        const term = w.term?.trim();
        const reading = w.reading?.trim();
        if (!term) continue;
        if (reading) {
          const regHira = new RegExp(reading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          text = text.replace(regHira, term);
          const kata = reading.replace(/[\u3041-\u3096]/g, (ch: string) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
          if (kata !== reading) {
            const regKata = new RegExp(kata.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            text = text.replace(regKata, term);
          }
        }
      }

      return {
        id: s.id || `seg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        speaker: s.speaker,
        text: text,
        start: s.start,
        end: s.end,
      };
    });

    return NextResponse.json({
      status: "completed",
      model: usedModel,
      segments: normalized,
      speakerNames: speakerDisplayNameMap,
      refinedText: null,
      summary: null,
    });
  } catch (error: any) {
    console.error("[Gemini API Router] Fatal error:", error);
    return NextResponse.json(
      { error: error.message || "予期しないエラーが発生しました" },
      { status: 500 }
    );
  }
}

