import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 180; // 3 minutes max

// Gemini API 呼び出し用ヘルパー関数
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
    "gemini-1.5-pro",
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

    // =========================================================================
    // 🎨 ゆるパカ鑑賞会モード：作品別・専任パイプライン（第1枚目全員網羅保証）
    // =========================================================================
    if (mode === "yurupaka") {
      const numWorks = painting_count > 0 ? Math.max(painting_count, 2) : 2;
      console.log(`[Summary API] Starting Yurupaka dedicated multi-pass summary (expected works: ${numWorks}, participants: ${participants.length})...`);

      // 1. 各発言に行番号を付与したインデックス付き対話テキストを作成
      const indexedTranscript = segments.map((s: any, idx: number) => {
        const spId = s.speaker || "SPEAKER_00";
        const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
        return `[#${idx}] [${name}] ${s.text || ""}`;
      }).join("\n");

      // 2. 作品の境界（各作品の鑑賞開始行番号）を特定
      let workBoundaries: number[] = [0]; // 第1枚目の開始行、第2枚目の開始行...

      // 行番号付きテキストからLLMで作品境界を特定
      const boundaryPrompt = `
あなたは絵画鑑賞会の対話テキストから、各絵画（作品）の鑑賞が開始された境界地点（行番号）を正確に特定する専門家です。
このセッションでは【合計 ${numWorks} 枚】の作品が鑑賞されています。

以下の行番号付き対話テキストを分析し、
・第1枚目の作品の鑑賞が開始された行番号（自己紹介や導入が終わり、最初の絵が提示された瞬間）
・第2枚目の作品の鑑賞が開始された行番号（ファシリテーターが2枚目の絵を提示し、参加者が2枚目について話し始めた瞬間）
${numWorks >= 3 ? "・第3枚目の作品の鑑賞が開始された行番号\n" : ""}を特定してください。

【★絶対厳守の境界判定ルール】
- ファシリテーターが「では次、○○さんどうぞ」「次の方いかがですか」「次は○○さん」と発言者を指名した発言は、作品の切り替えではありません！絶対に作品の切り替えと誤認しないでください。
- ファシリテーターが「そろそろ次の絵に…」と言った後に参加者が語った意見や深掘り発言も、すべて【前の作品に対する発言】です。
- 「実際に次の新しい絵が画面に提示され、その新しい絵についての鑑賞が始まった発言行」のみを特定してください。

【出力フォーマット】
以下のJSONフォーマットのみを出力してください。余計な説明や思考は一切不要です：
{
  "starts": [第1枚目の開始行番号, 第2枚目の開始行番号${numWorks >= 3 ? ", 第3枚目の開始行番号" : ""}]
}

【対話テキスト（行番号付き）】
${indexedTranscript.length > 25000 ? indexedTranscript.slice(0, 25000) + "\n...(以降省略)..." : indexedTranscript}
`;

      try {
        const boundaryRes = await callGemini(apiKey, boundaryPrompt, preferredModel, 1024, 0.1);
        const jsonMatch = boundaryRes.match(/\{[\s\S]*"starts"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.starts) && parsed.starts.length >= 2) {
            const validStarts = parsed.starts
              .map((n: any) => parseInt(n, 10))
              .filter((n: number) => !isNaN(n) && n >= 0 && n < segments.length);
            if (validStarts.length >= 2 && validStarts[1] > validStarts[0]) {
              workBoundaries = validStarts;
              console.log(`[Summary API] Detected work boundaries via LLM:`, workBoundaries);
            }
          }
        }
      } catch (e) {
        console.warn("[Summary API] Boundary detection parse failed, falling back:", e);
      }

      // フォールバック判定：もしLLMによる境界検知が不十分だった場合
      if (workBoundaries.length < 2) {
        // キーワード検索（2枚目の絵画、次の作品）
        let foundWork2Index = -1;
        const switchRegex = /(?:2|２|二)(?:枚目|点目)の?(?:作品|絵画?|画像|スライド|写真)|(?:次|つぎ)の(?:作品|絵画?|画像|スライド)に(?:行|いっ|進|移|見て|観て|出|共有)/;
        for (let i = Math.floor(segments.length * 0.25); i < Math.floor(segments.length * 0.85); i++) {
          if (switchRegex.test(segments[i].text || "")) {
            foundWork2Index = i;
            break;
          }
        }
        if (foundWork2Index > 0) {
          workBoundaries = [0, foundWork2Index];
        } else {
          // 均等分割（前半50%が1枚目、後半50%が2枚目）
          const half = Math.floor(segments.length * 0.48);
          workBoundaries = [0, half];
        }
        console.log(`[Summary API] Fallback work boundaries:`, workBoundaries);
      }

      // 3. 各作品ごとのセグメント群をスライス
      const workSegmentGroups: any[][] = [];
      for (let i = 0; i < numWorks; i++) {
        const start = workBoundaries[i] || 0;
        const end = (i + 1 < workBoundaries.length) ? workBoundaries[i + 1] : segments.length;
        workSegmentGroups.push(segments.slice(start, end));
      }

      // 4. 【作品専任プロンプト】による各作品の鑑賞記録生成（並列実行）
      const generateWorkSummary = async (workIndex: number, workSegs: any[]) => {
        const wNum = workIndex + 1;
        const workTranscript = workSegs.map((s: any) => {
          const spId = s.speaker || "SPEAKER_00";
          const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
          return `[${name}] ${s.text || ""}`;
        }).join("\n");

        const requiredParticipantsList = participants.map((p, idx) => 
          `  - #### 【${p.name}】の第${wNum}枚目に対する発言・着眼点・解釈:\n    （※絶対に省略禁止。第${wNum}枚目の絵画について ${p.name} が述べた感想、気づき、色彩や構図への指摘、独自の解釈を詳細に記述。長文の意見や熱心な発言、短い第一印象や相槌・同意まで、その人が語った内容を1人残らず必ず具体的に文章化して記録すること）`
        ).join("\n\n");

        const workPrompt = `
あなたは絵画鑑賞会（対話型アート鑑賞）の記録作成の専門家AIです。
以下は【第${wNum}枚目の作品（絵画）】に対する参加者たちの鑑賞対話テキストです。
この第${wNum}枚目の作品について、以下の参加者全員（全 ${participants.length} 名）それぞれの発言・感想・着眼点を、1人も漏らさず必ず記述してください。

【参加者全員リスト（全 ${participants.length} 名）】
${participantListStr}

【最重要・絶対厳守ルール：参加者全員（全 ${participants.length} 名）の完全網羅】
1. 上記リストの全参加者（全 ${participants.length} 名）について、必ず1人1つ見出しを設けて発言を記録してください：
${requiredParticipantsList}
2. 長文でしっかり意見を述べた参加者の発言はもちろん、短い第一印象や相槌・同意にとどまった発言まで、その人が語った内容を1人残らず必ず文章化してください。
3. 「この人はあまり話していない」と判断して見出しごと省略することは絶対に許されません。発言が短かった場合でも、同意した点やリアクション、進行に対する応答を必ず記述してください。
4. 前置きや解説、メタコメントは一切出力せず、マークダウン本文のみを出力してください。

【出力フォーマット】
### 【第${wNum}枚目の作品（絵画）の鑑賞記録と参加者全員の発言】
・作品のモチーフと描かれている情景: （第${wNum}枚目の絵画には具体的に何が描かれているか、色調や構図の特徴を明記）
・全体の対話の流れと議論の展開: （この作品を通してどのような議論が発展したかを詳細に記述）
・【第${wNum}枚目に対する参加者全員の鑑賞発言（★全 ${participants.length} 名分を必ず1人ずつ漏れなく記載）】:

${participants.map(p => `- #### 【${p.name}】の第${wNum}枚目に対する発言・着眼点・解釈:\n  （${p.name} の感想・発言・解釈の詳細記述）`).join("\n\n")}

【第${wNum}枚目の対話テキスト】
${workTranscript}
`;

        return callGemini(apiKey, workPrompt, preferredModel, 8192, 0.15);
      };

      // 全作品の記録を並列実行で生成（Gemini 2.0 Flash の高速性を活用）
      const workSummaries = await Promise.all(
        workSegmentGroups.map((group, idx) => generateWorkSummary(idx, group))
      );

      // 5. 【全体概要】および【6つの感性と観自在力分析】を生成
      const combinedWorksRecord = workSummaries.join("\n\n---\n\n");

      const overviewAndAnalysisPrompt = `
あなたは絵画鑑賞会（ゆるパカ鑑賞会）の総合レポートを作成する専門家AIです。
以下は、各作品（第1枚目、第2枚目など）について参加者全員の発言を詳細にまとめた鑑賞記録です。
この鑑賞記録全体を踏まえて、
1. 【全体概要】
2. 【感性と対話の深まりの分析（6つの感性と観自在力）】
を作成してください。

【作成指示】
・### 【全体概要】: セッション全体の目的、雰囲気、全体の対話の流れ、全体を通して深まった共通テーマを詳細な文章で記述してください。
・### 【感性と対話の深まりの分析】: 以下の「6つの感性フレームワーク」に基づいて、参加者の発言から見られた感性的広がりと観自在力を詳細に分析してください。
  1. 美的感覚（見極め・自分軸）
  2. 観察力（見て気づく力）
  3. 表現力（豊かに伝える力）
  4. 人間関係力（傾聴と共感）
  5. 直感とインスピレーション（創造性）
  6. 問いを立てる力（課題発見力）
  観自在力（総合的な俯瞰力・統合知性）

【出力形式】
挨拶や前置きは出力せず、以下のマークダウン形式で出力してください：

### 【全体概要】
（全体概要の詳細な記述）

---

### 【感性と対話の深まりの分析】
（6つの感性と観自在力の詳細な分析）

【各作品の鑑賞記録】
${combinedWorksRecord}
`;

      const overviewAndAnalysisRes = await callGemini(
        apiKey,
        overviewAndAnalysisPrompt,
        preferredModel,
        4096,
        0.2
      );

      // 6. 全体を美しい最終ドキュメントに結合
      // overviewAndAnalysisRes は ### 【全体概要】 ... --- ### 【感性と対話の深まりの分析】 の形式
      let finalMarkdown = "";
      if (overviewAndAnalysisRes.includes("### 【感性と対話の深まりの分析】")) {
        const parts = overviewAndAnalysisRes.split("### 【感性と対話の深まりの分析】");
        const overviewPart = parts[0].trim();
        const analysisPart = "### 【感性と対話の深まりの分析】\n" + (parts[1] || "").trim();

        finalMarkdown = `${overviewPart}\n\n---\n\n${combinedWorksRecord}\n\n---\n\n${analysisPart}`;
      } else {
        // フォールバック結合
        finalMarkdown = `${overviewAndAnalysisRes}\n\n---\n\n${combinedWorksRecord}`;
      }

      console.log(`[Summary API] Successfully generated dedicated multi-pass summary (${finalMarkdown.length} chars)`);

      return NextResponse.json({
        status: "success",
        summary: finalMarkdown.trim(),
      });
    }

    // =========================================================================
    // 💼 一般会議・対話モード
    // =========================================================================
    const transcriptLines = segments.map((s: any) => {
      const spId = s.speaker || "SPEAKER_00";
      const name = speakerMap[spId] || spId.replace("SPEAKER_", "話者");
      return `[${name}] ${s.text || ""}`;
    });
    const fullTranscript = transcriptLines.join("\n");

    const participantTemplateGeneral = participants.length > 0
      ? participants.map(p => `#### 【${p.name}】の発言・主な論点・提案:\n（ここに ${p.name} の発言内容、回答、提案、質問などを具体的に記述）`).join("\n\n")
      : "";

    const generalPrompt = (
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
      "【対話テキスト】\n" +
      fullTranscript
    );

    const generalSummary = await callGemini(apiKey, generalPrompt, preferredModel, 16384, 0.2);

    if (!generalSummary) {
      return NextResponse.json(
        { error: "要約の生成に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "success",
      summary: generalSummary,
    });
  } catch (error: any) {
    console.error("[Summary API] Fatal error:", error);
    return NextResponse.json(
      { error: error.message || "予期しないエラーが発生しました" },
      { status: 500 }
    );
  }
}
