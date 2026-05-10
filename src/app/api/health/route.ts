import { NextRequest, NextResponse } from 'next/server';

// Backend server health check proxy - avoids CORS issues from browser
const BACKEND_SERVERS: Record<string, string> = {
  'egpu-pc': 'https://nucboxm7.goat-aldebaran.ts.net',
  'remote-pc': 'https://nucbox-m8.goat-aldebaran.ts.net',
};

export async function GET(request: NextRequest) {
  const serverId = request.nextUrl.searchParams.get('server');
  
  if (serverId) {
    // Check single server
    const url = BACKEND_SERVERS[serverId];
    if (!url) {
      return NextResponse.json({ error: 'Unknown server' }, { status: 400 });
    }
    try {
      const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ ...data, online: true });
      }
      return NextResponse.json({ online: false }, { status: 200 });
    } catch {
      return NextResponse.json({ online: false }, { status: 200 });
    }
  }

  // Check all servers
  const results: Record<string, any> = {};
  await Promise.all(
    Object.entries(BACKEND_SERVERS).map(async ([id, url]) => {
      try {
        const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const data = await res.json();
          results[id] = { ...data, online: true };
        } else {
          results[id] = { online: false };
        }
      } catch {
        results[id] = { online: false };
      }
    })
  );
  return NextResponse.json(results);
}
