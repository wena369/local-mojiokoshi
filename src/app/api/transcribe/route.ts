import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const API_URL = "http://100.116.134.46:8000/transcribe";

  try {
    const formData = await req.formData();
    
    const response = await fetch(API_URL, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      console.error("Backend Error:", response.status, response.statusText);
      return NextResponse.json(
        { error: `Backend returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Proxy Error:", error);
    return NextResponse.json(
      { error: "Failed to connect to backend", details: error.message },
      { status: 500 }
    );
  }
}
