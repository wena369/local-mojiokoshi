import { NextRequest, NextResponse } from "next/server";
import http from "http";
import https from "https";

const BACKEND_URL = process.env.BACKEND_URL || "http://100.116.134.46:8000";
const parsedUrl = new URL(BACKEND_URL);
const BACKEND_HOST = parsedUrl.hostname;
const BACKEND_PORT = parseInt(parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80"), 10);
const USE_HTTPS = parsedUrl.protocol === "https:";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    const bodyBuffer = Buffer.from(await req.arrayBuffer());

    const result = await new Promise<any>((resolve, reject) => {
      const options = {
        hostname: BACKEND_HOST,
        port: BACKEND_PORT,
        path: "/transcribe_async",
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "Content-Length": bodyBuffer.length,
        },
        timeout: 120000, // 2 min timeout for upload
      };

      const proxyReq = (USE_HTTPS ? https : http).request(options, (proxyRes) => {
        let data = "";
        proxyRes.on("data", (chunk) => { data += chunk; });
        proxyRes.on("end", () => {
          try {
            resolve({ status: proxyRes.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: proxyRes.statusCode, body: { error: data } });
          }
        });
      });

      proxyReq.on("error", (err) => {
        reject(new Error(`Backend connection failed: ${err.message}`));
      });

      proxyReq.on("timeout", () => {
        proxyReq.destroy();
        reject(new Error("Upload timed out"));
      });

      // Write the body in chunks to avoid write errors
      const CHUNK_SIZE = 64 * 1024; // 64KB chunks
      let offset = 0;
      const writeNext = () => {
        while (offset < bodyBuffer.length) {
          const end = Math.min(offset + CHUNK_SIZE, bodyBuffer.length);
          const chunk = bodyBuffer.subarray(offset, end);
          offset = end;
          if (!proxyReq.write(chunk)) {
            proxyReq.once("drain", writeNext);
            return;
          }
        }
        proxyReq.end();
      };
      writeNext();
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: JSON.stringify(result.body) }, { status: result.status });
    }

    return NextResponse.json(result.body);
  } catch (error: any) {
    console.error("Proxy Error:", error.message);
    return NextResponse.json(
      { error: `Cannot reach backend. ${error.message}` },
      { status: 500 }
    );
  }
}
