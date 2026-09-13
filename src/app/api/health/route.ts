import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Backend server health check proxy - avoids CORS issues from browser
const BACKEND_SERVERS: Record<string, string[]> = {
  'egpu-pc': [
    'https://nucboxm7.goat-aldebaran.ts.net',
    'http://100.116.134.46:8000',
  ],
  'remote-pc': [
    'https://nucbox-m7-ultra-1.goat-aldebaran.ts.net',
    'http://100.75.146.1:8000',
    'http://100.75.146.1:1234',
  ],
  'local-pc': [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'https://tuf-a14.goat-aldebaran.ts.net',
    'http://100.76.8.79:8000',
  ],
};

async function checkServerUrls(urls: string[], serverId?: string) {
  // 1. FastAPI (ポート8000等) の / エンドポイントをチェック
  for (const url of urls) {
    if (url.includes(':1234')) continue; // LM Studio は専用チェック
    try {
      const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        return { ...data, online: true, activeUrl: url };
      }
    } catch {}
  }

  // 2. LM Studio (ポート1234) が起動しているかのフォールバック確認
  if (serverId === 'remote-pc') {
    try {
      const lmRes = await fetch('http://100.75.146.1:1234/v1/models', { signal: AbortSignal.timeout(3000) });
      if (lmRes.ok) {
        const lmData = await lmRes.json();
        const chatModel = lmData.data?.find((m: any) => !m.id?.includes('embed'))?.id || lmData.data?.[0]?.id;
        return {
          online: true,
          activeUrl: 'http://100.75.146.1:8000',
          gpu: 'NVIDIA RTX 2080 Ti (22GB)',
          gpu_available: true,
          llm_model: chatModel || 'google/gemma-4-12b-qat',
        };
      }
    } catch {}
  }

  if (serverId === 'local-pc') {
    try {
      const lmRes = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(2000) });
      if (lmRes.ok) {
        const lmData = await lmRes.json();
        const chatModel = lmData.data?.find((m: any) => !m.id?.includes('embed'))?.id || lmData.data?.[0]?.id;
        return {
          online: true,
          activeUrl: 'http://localhost:8000',
          gpu: 'AMD Radeon 8060S / 8050S',
          gpu_available: true,
          llm_model: chatModel || 'Local LM Studio',
        };
      }
    } catch {}
  }

  return { online: false };
}

export async function GET(request: NextRequest) {
  const serverId = request.nextUrl.searchParams.get('server');
  
  if (serverId) {
    const urls = BACKEND_SERVERS[serverId];
    if (!urls) {
      return NextResponse.json({ error: 'Unknown server' }, { status: 400 });
    }
    const result = await checkServerUrls(urls, serverId);
    return NextResponse.json(result);
  }

  // Check all servers
  const results: Record<string, any> = {};
  await Promise.all(
    Object.entries(BACKEND_SERVERS).map(async ([id, urls]) => {
      results[id] = await checkServerUrls(urls, id);
    })
  );
  return NextResponse.json(results);
}
