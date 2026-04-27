import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://100.116.134.46:8000";

export async function GET(req: NextRequest, { params }: { params: Promise<{ job_id: string }> | { job_id: string } }) {
  try {
    const resolvedParams = await params;
    const jobId = resolvedParams.job_id;
    
    const response = await fetch(`${BACKEND_URL}/status/${jobId}`, {
      method: "GET",
    });
    
    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend returned ${response.status}` },
        { status: response.status }
      );
    }
    
    return NextResponse.json(await response.json());
  } catch (error: any) {
    console.error("Proxy Error:", error);
    return NextResponse.json(
      { error: `Cannot reach backend. ${error.message}` },
      { status: 500 }
    );
  }
}
