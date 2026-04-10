import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { decryptTokens, hasRequiredGoogleScopes } from "@/app/lib/gmail";
import { debugLog, debugLogVerbose } from "@/app/lib/debugLog";
import { SESSION_COOKIE_NAME, getSessionUserId } from "@/app/lib/session";
import { getGoogleAccounts } from "@/app/lib/db";

async function isAuthenticated(req: NextRequest): Promise<boolean> {
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie) return false;
  const userId = getSessionUserId(sessionCookie.value);
  if (!userId) return false;

  const accounts = await getGoogleAccounts(userId);
  for (const a of accounts) {
    try {
      const tokens = decryptTokens(a.encrypted_tokens);
      if (hasRequiredGoogleScopes(tokens)) return true;
    } catch {}
  }
  return false;
}

// Proxy endpoint for the OpenAI Responses API
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  debugLog("llm", "POST /api/responses — request", {
    model: body.model,
    instructions: body.instructions?.slice?.(0, 200),
    inputCount: Array.isArray(body.input) ? body.input.length : 1,
    text_format: body.text?.format?.type,
  });
  debugLogVerbose("llm", "POST /api/responses — FULL REQUEST BODY", {
    model: body.model,
    instructions: body.instructions,
    input: body.input,
    text: body.text,
    tools: body.tools,
    temperature: body.temperature,
    max_output_tokens: body.max_output_tokens,
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
      usage: (response as any).usage,
    });
    debugLogVerbose("llm", "Structured response FULL LLM RESPONSE", {
      id: response.id,
      model: (response as any).model,
      output: response.output,
      usage: (response as any).usage,
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
      usage: (response as any).usage,
    });
    debugLogVerbose("llm", "Text response FULL LLM RESPONSE", {
      id: response.id,
      model: (response as any).model,
      output: response.output,
      usage: (response as any).usage,
    });

    return NextResponse.json(response);
  } catch (err: any) {
    debugLog("error", `Text response FAILED [${Date.now() - startMs}ms]`, { message: err.message, status: err.status });
    console.error('responses proxy error', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
