import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60; // Max allowed on Hobby/Pro

// Gemini API 呼び出し用ヘルパー関数（タイムアウト対策付き）
async function callGemini(
  apiKey: string,
  prompt: string,
  preferredModel = "gemini-2.0-flash",
  maxTokens = 8192,
  temperature = 0.2
): Promise<string> {
  const candidateModels = [
    preferredModel,
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite",
  ];
  const uniqueModels = Array.from(new Set(candidateModels));

  for (const model of uniqueModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText && candidateText.trim().length > 0) {
          return candidateText.trim();
        }
      } else {
        const errText = await res.text();
        console.warn(`[Gemini Call] Model ${model} returned (${res.status}): ${errText}`);
      }
    } catch (e: any) {
      console.warn(`[Gemini Call] Exception with ${model}:`, e);
    }
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const {
      segments,
      speaker_names,
      speaker_readings,
      speaker_roles,
      mode = "general",
      painting_count = 0,
      split_index = 0,
      api_key: reqApiKey,
      model: reqModel,
    } = await req.json();

    const apiKey = (reqApiKey || process.env.GEMINI_API_KEY || "").trim();

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json({ error: "セグメントデータがありません" }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API Key が設定されていません" }, { status: 400 });
    }

    const speakerMap = speaker_names || {};
    const roleMap = speaker_roles || {};

    // 登場する全話者IDを重複なく抽出（SILENCE等を除く）
    const rawSpeakers = Array.from(new Set(
      segments
        .map((s: any) => s.speaker || "SPEAKER_00")
        .filter((sp: string) => sp !== "SILENCE" && !sp.startsWith("SILENCE"))
    )).sort() as string[];

    // 各話者の表示名（参加者名）リストを作成
    const participants = rawSpeakers.map((spId: string) => {
      const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
      const role = roleMap[spId] ? `（${roleMap[spId]}）` : "";
      return { spId, name, fullName: `${name}${role}` };
    });

    const participantListStr = participants.length > 0
      ? participants.map((p, i) => `${i + 1}. 【${p.fullName}】`).join("\n")
      : "・参加者";

    const preferredModel = reqModel || "gemini-2.0-flash";

    const total = segments.length;
    const minValid = Math.max(3, Math.floor(total * 0.20));
    let splitIndexNum = typeof split_index === 'number' ? split_index : 0;

    // もし split_index が未指定（<= 0）または先頭直後（<= 1）または範囲外の場合、中央付近から安全に自動検出
    if (mode === "yurupaka" && (splitIndexNum <= 1 || splitIndexNum >= total) && total >= 6) {
      const minIdx = Math.max(3, Math.floor(total * 0.25));
      const maxIdx = Math.min(total - 2, Math.floor(total * 0.80));
      const centerIdx = Math.max(minIdx, Math.floor(total * 0.50));

      let bestIdx = centerIdx;
      let maxScore = -999;

      const strongKeywords = [
        /(?:2|２|二)(?:枚目|点目)の?(?:作品|絵画?|画像|スライド|写真)/,
        /(?:次|つぎ)の(?:作品|絵画?|画像|スライド)に(?:行|いっ|進|移|見て|観て|出|共有|表示|切り替)/,
        /(?:次|つぎ)の(?:作品|絵画?|アート)を(?:見|観|共有|画面)/,
        /(?:2|２|二)(?:枚目|点目)に(?:行|いっ|進|移|入)/,
        /2枚目に行きましょう/,
        /2枚目の絵/,
        /次の絵に行きましょう/,
        /画面を切り替え/,
        /スライドを切り替え/,
        /次の作品を共有/,
      ];

      for (let i = minIdx; i <= maxIdx; i++) {
        const text = segments[i]?.text || "";
        if (!text.trim()) continue;
        if (/次(?:は|、|\s)*(?:さん|様|君|ちゃん|方|どうぞ|お願)/.test(text)) continue;
        if (/(?:前|まえ)に|(?:前|まえ)の|(?:後|あと)で/.test(text)) continue;

        let score = 0;
        for (const pat of strongKeywords) {
          if (pat.test(text)) score += 100;
        }
        if (score > 0) {
          const distanceRatio = Math.abs(i - centerIdx) / total;
          score += (0.5 - distanceRatio) * 40;
          if (score > maxScore) {
            maxScore = score;
            bestIdx = i;
          }
        }
      }
      splitIndexNum = bestIdx >= minValid && bestIdx < total ? bestIdx : centerIdx;
    }

    // 安全の絶対保証：万が一 splitIndexNum が 1 以下のままの場合は、必ず中央値（50%）を強制適用！
    if (mode === "yurupaka" && (splitIndexNum <= 1 || splitIndexNum >= total) && total > 1) {
      splitIndexNum = Math.max(1, Math.floor(total * 0.50));
    }

    // 対話テキストの構築（境界に基づいて第1枚目と第2枚目を完全に物理分離）
    let conversationBlocks = "";
    if (mode === "yurupaka" && splitIndexNum > 0 && splitIndexNum < segments.length) {
      const w1Text = segments.slice(0, splitIndexNum).map((s: any, idx: number) => {
        const spId = s.speaker || "SPEAKER_00";
        const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
        return `[#${idx + 1} ${name}] ${s.text || ""}`;
      }).join("\n");
      const w2Text = segments.slice(splitIndexNum).map((s: any, idx: number) => {
        const spId = s.speaker || "SPEAKER_00";
        const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
        return `[#${splitIndexNum + idx + 1} ${name}] ${s.text || ""}`;
      }).join("\n");

      conversationBlocks = (
        `【★第1枚目の絵画に関する対話テキスト（自己紹介後〜第2枚目提示直前まで：全 ${splitIndexNum} 発言）】\n` +
        w1Text + "\n\n" +
        `【★第2枚目の絵画に関する対話テキスト（第2枚目提示以降〜セッション終了まで：全 ${segments.length - splitIndexNum} 発言）】\n` +
        w2Text
      );
    } else {
      const transcriptLines = segments.map((s: any, idx: number) => {
        const spId = s.speaker || "SPEAKER_00";
        const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
        return `[#${idx + 1} ${name}] ${s.text || ""}`;
      });
      conversationBlocks = transcriptLines.join("\n");
    }

    let prompt = "";

    // =========================================================================
    // 🎨 ゆるパカ鑑賞会モード（超高速 1-Pass + 参加者全員見出し強制）
    // =========================================================================
    if (mode === "yurupaka") {
      const numWorks = painting_count > 0 ? Math.max(painting_count, 2) : 2;
      const pCountHint = painting_count > 0 ? `鑑賞された絵画はおよそ「${painting_count} 枚」です。\n` : "";

      // 各作品ごとに全参加者の見出しを穴埋め形式で強制展開
      const makeWorkTemplate = (wIdx: number) => {
        return participants.map(p => 
          `- #### 【${p.name}】の第${wIdx}枚目に対する発言・着眼点・解釈:\n  （※絶対に省略禁止！【★第${wIdx}枚目の絵画に関する対話テキスト】から、${p.name} が述べた感想、気づき、色彩・構図の指摘、独自解釈、短い第一印象や相槌・同調まで、その人が語った内容を必ず具体的に文章化して記録すること。発言が少なかった場合でも見出しを削除せず、周囲への同調や鑑賞態度を必ず記録すること）`
        ).join("\n\n");
      };

      const worksSectionsPrompt = Array.from({ length: numWorks }, (_, i) => {
        const wNum = i + 1;
        return (
          `### 【第${wNum}枚目の作品（絵画）の鑑賞記録と参加者全員の発言】\n` +
          `・作品のモチーフと描かれている情景: （第${wNum}枚目の絵画には具体的に何が描かれているか、色調や構図の特徴を明記）\n` +
          `・全体の対話の流れと議論の展開: （この作品を通してどのような議論が発展したかを詳細に記述）\n` +
          `・【第${wNum}枚目に対する参加者全員の鑑賞発言（★全 ${participants.length} 名分を必ず1人ずつ漏れなく記載）】:\n` +
          `※以下に記載された全参加者（全 ${participants.length} 名）それぞれの見出しを1つも削らず、全員分の発言・感想を記述してください：\n\n` +
          makeWorkTemplate(wNum)
        );
      }).join("\n\n---\n\n");

      prompt = (
        "あなたは絵画鑑賞会（対話型アート鑑賞）の対話記録から、極めて詳細で充実した要約・鑑賞記録を作成する専門家AIです。\n" +
        "以下の対話テキストを深く読み込み、一切省略することなく、長文で充実した鑑賞記録を作成してください。\n\n" +
        `【参加者全員リスト（全 ${participants.length} 名）】\n` +
        participantListStr + "\n\n" +
        pCountHint +
        `【★最重要・絶対厳守ルール：第1枚目にも第2枚目にも、上記全参加者（全 ${participants.length} 名）の見出しを出力すること】\n` +
        `1. 【第1枚目の作品】の欄には、必ず【★第1枚目の絵画に関する対話テキスト】を参照し、参加者全員（全 ${participants.length} 名）の「- #### 【お名前】...」の見出しを1人も削らず全員分出力してください。\n` +
        `2. 【第2枚目の作品】の欄には、必ず【★第2枚目の絵画に関する対話テキスト】を参照し、参加者全員（全 ${participants.length} 名）の「- #### 【お名前】...」の見出しを1人も削らず全員分出力してください。\n` +
        `3. 「1枚目にこの人がいない」「発言回数が少ない」と勝手に判断して見出しを省くことは絶対に禁止します。発言が短かったり相槌にとどまった参加者であっても、「【お名前】第1枚目の鑑賞では、周囲の〇〇という意見に頷き同調する様子が見られた」「短く〜〜と印象を述べた」のように、必ず全員分の見出しと反応を文章化してください。\n` +
        "4. 長文でしっかり意見を述べた参加者の発言はもちろん、全員の発言・着眼点を1人残らず拾い上げてください。\n\n" +
        "【構成】\n" +
        "### 【全体概要】\n" +
        "この鑑賞会セッション全体の目的、雰囲気、全体の対話の流れ、全体を通して深まった共通テーマを詳細に記述してください。\n\n" +
        "---\n\n" +
        worksSectionsPrompt + "\n\n" +
        "---\n\n" +
        "### 【感性と対話の深まりの分析】\n" +
        "参加者の発言から見られた感性的な広がり（観察力、連想力、共感力、多角的な視点など）や、対話によってどのように鑑賞が深まったかを詳細に分析してください。\n\n" +
        "※前置きや思考プロセス、解説は一切出力せず、マークダウン本文のみを直接出力してください。\n\n" +
        conversationBlocks
      );
    } else {
      // 一般会議モード
      const participantTemplateGeneral = participants.length > 0
        ? participants.map(p => `#### 【${p.name}】の発言・主な論点・提案:\n（ここに ${p.name} の発言内容、回答、提案、質問などを具体的に記述）`).join("\n\n")
        : "";

      prompt = (
        "あなたはプロフェッショナルな議事録・対話分析のエキスパートAIです。\n" +
        "以下の【会議・対話の全テキスト】を最初から最後まで深く読み込み、重要な論点や発言者の意見を一切取りこぼすことなく、極めて詳細で完成度の高い【包括的会議録・要約】を作成してください。\n\n" +
        `【参加者全員リスト（全 ${participants.length} 名）】\n` +
        participantListStr + "\n\n" +
        `【最重要・絶対厳守ルール：参加者全員（全 ${participants.length} 名）の発言・意見を1人残らず全員網羅すること】\n` +
        `本要約において最も重要な指示は、【上記参加者リストに記載された ${participants.length} 名「全員分」の発言、意見、提案、回答、懸念を、1人も漏らすことなく必ず要約本文に明記すること】です。\n` +
        "一部の進行役や発言回数の多い人だけに偏ることなく、発言回数が少なかった参加者の意見や反応も必ず拾い上げてください。\n\n" +
        "【構成】\n" +
        "### 【全体概要】\n・対話・会議の目的、背景、主要な結論、および全体の議論の流れを詳細な文章で記述。\n\n" +
        "### 【主要議題と議論の詳細】\n・議題ごとにセクションを作成し、各参加者がどのような意図で意見や提案、回答を述べたかを詳しく記述。\n\n" +
        `### 【参加者全員の発言・意見一覧（★全 ${participants.length} 名分を必ず1人ずつ漏れなく記載）】\n` +
        `※上記リストの全参加者（全 ${participants.length} 名）について、必ず1人1つ見出しを設けて、その人の発言・立場・提案・回答を1人も漏らさず記述してください：\n\n` +
        participantTemplateGeneral + "\n\n" +
        "### 【決定事項・合意内容】\n・合意された方針や決定事項を具体的に箇条書きで記述。\n\n" +
        "### 【今後のアクションアイテム・保留事項】\n・担当者や期限、今後の課題。\n\n" +
        "※前置きや思考プロセス、解説は一切出力せず、マークダウン本文のみを直接出力してください。\n\n" +
        "【対話テキスト】\n" +
        conversationBlocks
      );
    }

    console.log(`[Summary API] Requesting summary with model: ${preferredModel} (1-pass ultra-fast)...`);
    const summaryText = await callGemini(apiKey, prompt, preferredModel, 8192, 0.15);

    if (!summaryText) {
      return NextResponse.json(
        { error: "要約の生成に失敗しました（AIからの応答が空でした）" },
        { status: 500 }
      );
    }

    console.log(`[Summary API] Generated summary successfully (${summaryText.length} chars)`);

    return NextResponse.json({
      status: "success",
      summary: summaryText,
    });
  } catch (error: any) {
    console.error("[Summary API] Fatal error:", error);
    return NextResponse.json(
      { error: error.message || "予期しないエラーが発生しました" },
      { status: 500 }
    );
  }
}
