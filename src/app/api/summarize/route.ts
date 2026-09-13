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

    // 対話テキストの構築
    const transcriptLines = segments.map((s: any, idx: number) => {
      const spId = s.speaker || "SPEAKER_00";
      const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
      return `[${name}] ${s.text || ""}`;
    });
    const fullTranscript = transcriptLines.join("\n");

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
          `- #### 【${p.name}】の第${wIdx}枚目に対する発言・着眼点・解釈:\n  （※絶対に省略禁止。第${wIdx}枚目の絵画について ${p.name} が述べた感想、気づき、色彩や構図への指摘、独自の解釈、短い第一印象や相槌・同意まで、その人が語った内容を必ず具体的に文章化して記録すること）`
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
        "以下の【鑑賞会の全対話テキスト】を最初から最後まで深く読み込み、一切省略することなく、長文で充実した鑑賞記録を作成してください。\n\n" +
        `【参加者全員リスト（全 ${participants.length} 名）】\n` +
        participantListStr + "\n\n" +
        pCountHint +
        "【★最重要・絶対厳守の境界判定ルール（第1枚目と第2枚目の区分の徹底）】\n" +
        "1. 【発言者指名による誤切替の禁止】: ファシリテーターが「では次、○○さんどうぞ」「次の方いかがですか」「じゃあ次は○○さん」と発言者を交代している発言は、作品の切り替えではありません！その指名された参加者の発言は【すべて第1枚目の発言】です。\n" +
        "2. 【終了前の深掘り発言】: ファシリテーターが「そろそろ次に…」「次の絵に行こうと思いますが」と言った後に参加者が語った意見や、第1枚目の終盤でじっくり語られた長文の深い意見も、【すべて第1枚目の作品に対する発言】です。決して2枚目と混同したり、要約から除外してはなりません！\n" +
        "3. 【第2枚目の開始地点】: ファシリテーターが実際に画面を切り替え、「2枚目の絵です」「次の作品を見てみましょう」と新しい絵を提示し、参加者がその新しい絵について語り始めた瞬間からが第2枚目です。\n\n" +
        `【最重要・絶対厳守ルール：すべての作品（第1枚目も、第2枚目も）で参加者全員（全 ${participants.length} 名）の見出しを出力すること】\n` +
        "1. 上記リストの全参加者（全 " + participants.length + " 名）について、第1枚目にも第2枚目にも、必ず1人1つ見出しを設けて発言を記録してください。\n" +
        "2. 長文でしっかり意見を述べた参加者の発言はもちろん、短い第一印象や相槌・同意にとどまった参加者まで、全員の発言・着眼点を1人残らず拾い上げてください。\n" +
        "3. 「第2枚目は全員出ているのに、第1枚目は一部の人しか出ていない」という状態は絶対に許されません。1枚目の対話テキストを最初から丁寧に精査し、全参加者の発言を必ず1枚目の欄に記録してください。\n\n" +
        "【構成】\n" +
        "### 【全体概要】\n" +
        "この鑑賞会セッション全体の目的、雰囲気、全体の対話の流れ、全体を通して深まった共通テーマを詳細に記述してください。\n\n" +
        "---\n\n" +
        worksSectionsPrompt + "\n\n" +
        "---\n\n" +
        "### 【感性と対話の深まりの分析】\n" +
        "参加者の発言から見られた感性的な広がり（観察力、連想力、共感力、多角的な視点など）や、対話によってどのように鑑賞が深まったかを詳細に分析してください。\n\n" +
        "※前置きや思考プロセス、解説は一切出力せず、マークダウン本文のみを直接出力してください。\n\n" +
        "【鑑賞会の全対話テキスト】\n" +
        fullTranscript
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
        fullTranscript
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
