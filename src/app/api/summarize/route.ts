import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 180; // 3 minutes max

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

    // 対話テキストの構築（各発言に話者名を適用）
    const transcriptLines = segments.map((s: any) => {
      const spId = s.speaker || "SPEAKER_00";
      const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
      return `[${name}] ${s.text || ""}`;
    });
    const fullTranscript = transcriptLines.join("\n");

    let prompt = "";

    if (mode === "yurupaka") {
      const pCountHint = painting_count > 0 ? `鑑賞された絵画はおよそ「${painting_count} 枚」です。\n` : "";
      const numWorks = painting_count > 0 ? Math.max(painting_count, 2) : 2;

      // 各作品ごとに参加者全員の発言欄を強制配置するテンプレート
      const makeWorkTemplate = (wIdx: number) => {
        return participants.map(p => 
          `  - #### 【${p.name}】の第${wIdx}枚目に対する発言・着眼点・解釈:\n    （※絶対に省略禁止。第${wIdx}枚目の作品について ${p.name} が述べた感想、気づき、色彩や構図への指摘、独自の解釈を詳細に記述。長文の意見や熱心な発言、短い第一印象や相槌・同意まで、その人が語った内容を1人残らず必ず具体的に文章化して記録すること）`
        ).join("\n\n");
      };

      const worksSectionsPrompt = Array.from({ length: numWorks }, (_, i) => {
        const wNum = i + 1;
        return (
          `### 【第${wNum}枚目の作品（絵画）の鑑賞記録と参加者全員の発言】\n` +
          `・作品のモチーフと描かれている情景: （第${wNum}枚目の絵画には具体的に何が描かれているか、色調や構図の特徴を明記）\n` +
          `・全体の対話の流れと議論の展開: （この作品を通してどのような議論が発展したかを詳細に記述）\n` +
          `・【第${wNum}枚目に対する参加者全員の鑑賞発言（★全 ${participants.length} 名分を必ず1人ずつ漏れなく記載）】:\n` +
          `※第${wNum}枚目の作品について、以下に記載された全参加者（全 ${participants.length} 名）それぞれの発言・感想・着眼点を1人も漏らさず必ず記述してください：\n\n` +
          makeWorkTemplate(wNum)
        );
      }).join("\n\n---\n\n");

      prompt = (
        "あなたは絵画鑑賞会（対話型アート鑑賞）の対話記録から、極めて詳細で充実した要約・鑑賞記録を作成する専門家AIです。\n" +
        "以下の【鑑賞会の全対話テキスト】を最初から最後まで深く読み込み、一切省略することなく、長文で充実した鑑賞記録を作成してください。\n\n" +
        `【参加者全員リスト（全 ${participants.length} 名）】\n` +
        participantListStr + "\n\n" +
        pCountHint +
        "【★最重要・致命的注意点：第1枚目と第2枚目の「作品切り替え位置（境界）」の正しい判定】\n" +
        "対話型鑑賞会において、「2枚目の作品の開始位置」を実際の切り替えよりも手前と誤認すると、第1枚目の後半で参加者が詳しく語った長文の意見が第2枚目に混入したり、第1枚目の記録から消失する致命的なミスが発生します。以下の基準を厳格に守って作品を区分してください：\n\n" +
        "●【第1枚目の作品の範囲】：\n" +
        "  - 開始地点: 自己紹介や導入が終わり、最初の絵画が提示された瞬間から始まります。\n" +
        "  - 終了地点: ファシリテーターが「では、次の2枚目の絵に行きましょう」「画面を切り替えます」などと告げ、【実際に新しい別の絵が画面に出され、参加者がその新しい絵について語り始める直前まで】のすべての対話が第1枚目です。\n" +
        "  - ★特に注意1: ファシリテーターが「では次、○○さんどうぞ」「次の方いかがですか」「じゃあ次は○○さん」と発言者を順番に指名する発言は、作品の切り替えではありません！その指名された参加者が語った意見は【すべて第1枚目の発言】です。\n" +
        "  - ★特に注意2: ファシリテーターが「そろそろ次に…」と言った後に、参加者が「あ、その前にもう1点」「気になったところがあって…」と語った発言や、第1枚目の終盤でじっくり語られた長文の深い意見も、【すべて第1枚目の作品に対する発言】です。決して2枚目と混同したり、要約から除外してはなりません！\n\n" +
        "●【第2枚目の作品の範囲】：\n" +
        "  - 開始地点: ファシリテーターが実際に2枚目の新しい絵画を提示し、「2枚目の絵です」「これを見てどう感じますか？」と参加者に問いかけた【以降】の対話です。\n" +
        "  - ★注意: 2枚目の鑑賞中に「1枚目の絵と比べると…」「さっきの絵とは違って…」と前の絵と比較している発言は、2枚目の文脈として正しく扱ってください。\n\n" +
        `【最重要・絶対厳守ルール：すべての作品（第1枚目も、第2枚目も）で参加者全員（全 ${participants.length} 名）の発言を網羅すること】\n` +
        "1. 長文でしっかり意見を述べた参加者の発言はもちろん、短い第一印象や相槌にとどまった参加者まで、全員の発言・着眼点を1人残らず拾い上げてください。\n" +
        "2. 「第2枚目は全員出ているのに、第1枚目は一部の人しか出ていない」という状態は絶対に許されません。第1枚目も第2枚目も、すべての作品において【全 " + participants.length + " 名全員分】の個別見出しと感想・着眼点を1人残らず必ず記述してください。\n" +
        "3. 対話テキストを最初（自己紹介直後）から第2枚目の実際の提示まで綿密に精査し、第1枚目で各参加者が語った言葉を漏らさず第1枚目の欄に記録してください。\n\n" +
        "★【自己照合義務（Checklist）】:\n" +
        "出力する前に、第1枚目のセクション内の参加者一覧と、第2枚目のセクション内の参加者一覧を必ず比較照合してください。\n" +
        "全作品において参加者リストの全員（全 " + participants.length + " 名）の名前見出しと発言が1人も欠けずに揃っていることを確認した上で出力してください。\n\n" +
        "【作成ルール】\n" +
        "1. 【完全完走・省略禁止】: 途中で文章を切ったり、「以下略」「〜中略〜」などで終わらせず、最後の考察まで完全に書き切ってください。\n" +
        "2. 【構成】: 以下の構成で論理的かつ詳細にまとめてください。\n\n" +
        "   ### 【全体概要】\n" +
        "   この鑑賞会セッション全体の目的、雰囲気、全体の対話の流れ、全体を通して深まった共通テーマを詳細に記述してください。\n\n" +
        worksSectionsPrompt + "\n\n---\n\n" +
        "   ### 【感性と対話の深まりの分析】\n" +
        "   参加者の発言や相互の問いかけから見られた感性的な広がり（観察力、連想力、共感力、多角的な視点など）や、対話によってどのように鑑賞が深まったかを詳細に分析してください。\n\n" +
        "3. 【余計な出力の禁止】: 挨拶文や思考プロセス、解説は一切出力せず、マークダウン形式の要約本文のみを直接出力してください。\n\n" +
        "【鑑賞会の全対話テキスト】\n" +
        fullTranscript
      );
    } else {
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
        "【作成ルール】\n" +
        "1. 【完全完走・省略禁止】: 「中略」「以下省略」や中途半端な箇条書きの打ち切りは絶対に禁止です。最後の決定事項まで完全に書き切ってください。\n" +
        "2. 【構成】: 以下の構成で論理的かつ詳細にまとめてください。\n\n" +
        "   ### 【全体概要】\n" +
        "   この対話・会議の目的、背景、主要な結論、および全体の議論の流れを詳細な文章で記述してください。\n\n" +
        "   ### 【主要議題と議論の詳細】\n" +
        "   話し合われた主要なアジェンダ・トピックごとにセクション（例: #### 議題1: ○○、#### 議題2: ○○ ...）を作成してください。\n" +
        "   各議題において、誰がどのような背景や意図で意見、提案、懸念、質問、回答を述べたのか、参加者間の対比や合意形成の過程を含めて詳しく記述してください。\n\n" +
        `   ### 【参加者全員の発言・意見一覧（★全 ${participants.length} 名分を必ず1人ずつ漏れなく記載）】\n` +
        `   ※上記リストの全参加者（全 ${participants.length} 名）について、必ず1人1つ見出しを設けて、会議におけるその人の発言・立場・提案・回答を1人も漏らさず記述してください：\n\n` +
        participantTemplateGeneral + "\n\n" +
        "   ### 【決定事項・合意内容】\n" +
        "   会議の中で合意された方針や決定事項を具体的に箇条書きでまとめてください。\n\n" +
        "   ### 【今後のアクションアイテム・保留事項】\n" +
        "   担当者や期限（言及がある場合）、今後の宿題や持ち越しとなった課題を明確に整理してください。\n\n" +
        "3. 【余計な出力の禁止】: 挨拶文や思考プロセス、メタコメントは一切出力せず、マークダウン形式の要約本文のみを直接出力してください。\n\n" +
        "【会議・対話の全テキスト】\n" +
        fullTranscript
      );
    }

    // モデル候補: 高速かつ長文・高品質に強い gemini-2.0-flash を最優先
    const candidateModels = [
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-2.0-flash-lite",
    ];

    let summaryText = "";
    let lastError = "";

    for (const model of candidateModels) {
      try {
        console.log(`[Summary API] Requesting summary with model: ${model}`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2, // 安定して忠実な長文生成
              maxOutputTokens: 16384, // 途切れ防止のための十分なトークン数
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText && candidateText.trim().length > 0) {
            summaryText = candidateText.trim();
            console.log(`[Summary API] Successfully generated summary using ${model} (${summaryText.length} chars)`);
            break;
          }
        } else {
          lastError = `(${res.status}) ${await res.text()}`;
          console.warn(`[Summary API] Model ${model} returned error:`, lastError);
        }
      } catch (e: any) {
        lastError = e.message;
        console.warn(`[Summary API] Exception with ${model}:`, e);
      }
    }

    if (!summaryText) {
      return NextResponse.json(
        { error: `要約の生成に失敗しました: ${lastError}` },
        { status: 500 }
      );
    }

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
