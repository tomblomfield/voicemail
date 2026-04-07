import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { decryptTokens, hasRequiredGoogleScopes } from "@/app/lib/gmail";
import { debugLog } from "@/app/lib/debugLog";

// Proxy endpoint for the OpenAI Responses API
export async function POST(req: NextRequest) {
  const cookie = req.cookies.get("gmail_tokens");
  if (!cookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tokens = decryptTokens(cookie.value);
    if (!hasRequiredGoogleScopes(tokens)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  debugLog("llm", "POST /api/responses — request", {
    model: body.model,
    instructions: body.instructions?.slice?.(0, 200),
    input: body.input,
    text_format: body.text?.format?.type,
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (body.text?.format?.type === 'json_schema') {
    return await structuredResponse(openai, body);
  } else {
    return await textResponse(openai, body);
  }
}

async function structuredResponse(openai: OpenAI, body: any) {
  const startMs = Date.now();
  try {
    const response = await openai.responses.parse({
      ...(body as any),
      stream: false,
    });
    debugLog("llm", `Structured response [${Date.now() - startMs}ms]`, {
      id: response.id,
      output: response.output,
    });

    return NextResponse.json(response);
  } catch (err: any) {
    debugLog("error", `Structured response FAILED [${Date.now() - startMs}ms]`, { message: err.message, status: err.status });
    console.error('responses proxy error', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

async function textResponse(openai: OpenAI, body: any) {
  const startMs = Date.now();
  try {
    const response = await openai.responses.create({
      ...(body as any),
      stream: false,
    });
    debugLog("llm", `Text response [${Date.now() - startMs}ms]`, {
      id: response.id,
      output: response.output,
    });

    return NextResponse.json(response);
  } catch (err: any) {
    debugLog("error", `Text response FAILED [${Date.now() - startMs}ms]`, { message: err.message, status: err.status });
    console.error('responses proxy error', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
  
