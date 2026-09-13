import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { segments, apiKey: reqApiKey, speakerNames, speakerCount } = await req.json();
    const apiKey = (reqApiKey || process.env.GEMINI_API_KEY || "").trim();

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json({ error: "セグメントデータがありません" }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API Key が必要です" }, { status: 400 });
    }

    const segmentsText = segments.map((s, idx) => `[${idx}] ${s.speaker || 'SPEAKER_00'}: "${s.text}" (${s.start}s - ${s.end}s)`).join("\n");

    const prompt = (
      "あなたは会話の文脈分析および話者再分離の超エキスパートAIです。\n" +
      "以下は音声認識によって得られたセグメント一覧ですが、話者分離が不十分で、1つのセグメント内に複数人の会話が混ざっていたり、話者IDが誤っている可能性があります。\n\n" +
      "【任務】\n" +
      "1. 会話のキャッチボール（質問と回答、意見と相槌、話し言葉のトーン・敬語の違い）を徹底的に文脈解析してください。\n" +
      "2. 1つの発言の中に相手の相槌（「はい」「そうですね」等）や返答が含まれている場合は、2つ以上のセグメントに適切に分割してください。\n" +
      "3. 各発言に最も整合性のある話者ID（例: 'SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02' 等）を一貫性を持って再割り当てしてください。\n" +
      (speakerCount ? `4. 参加話者数は概ね「${speakerCount}名」です。\n` : "") +
      "\n" +
      "【元のセグメントデータ】\n" +
      segmentsText + "\n\n" +
      "【出力形式 (JSON配列のみ)】\n" +
      "[\n" +
      "  {\"speaker\": \"SPEAKER_00\", \"text\": \"...\", \"start\": 0.0, \"end\": 2.5},\n" +
      "  {\"speaker\": \"SPEAKER_01\", \"text\": \"...\", \"start\": 2.8, \"end\": 4.1}\n" +
      "]"
    );

    const modelsToTry = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
    let rawText = "";

    for (const m of modelsToTry) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
          })
        });
        if (res.ok) {
          const data = await res.json();
          rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          if (rawText) break;
        }
      } catch {}
    }

    if (!rawText) {
      return NextResponse.json({ error: "AI話者再分離に失敗しました" }, { status: 500 });
    }

    let parsed: any[] = [];
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\[\s*\{.*\}\s*\]/s);
      if (match) parsed = JSON.parse(match[0]);
    }

    return NextResponse.json({ status: "success", segments: parsed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "エラーが発生しました" }, { status: 500 });
  }
}
