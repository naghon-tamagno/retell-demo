import { NextResponse } from "next/server";
import { appendCallEvent } from "../_store";

// Respuesta base
function ok(extra?: any) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

// OPTIONS (por si hay preflight)
export async function OPTIONS() {
  return ok({ method: "OPTIONS" });
}

// GET (por si el "Test webhook" prueba reachability con GET)
export async function GET() {
  return ok({ method: "GET" });
}

// POST (evento real)
export async function POST(req: Request) {
  let body: any = null;

  try {
    body = await req.json();
  } catch {
    console.log("RETELL WEBHOOK: invalid JSON");
    return ok({ note: "invalid_json" });
  }

  const event = body?.event ?? "unknown_event";
  const callId =
    body?.call?.call_id ||
    body?.call?.callId ||
    body?.call_id ||
    body?.callId ||
    null;

  console.log("========== RETELL WEBHOOK ==========");
  console.log("EVENT:", event);
  console.log("CALL_ID:", callId);
  console.log("BODY:", JSON.stringify(body, null, 2));
  console.log("====================================");

  const key = callId ?? "unknown_call";

  try {
    appendCallEvent(key, {
      received_at: new Date().toISOString(),
      event,
      payload: body,
    });
  } catch (e) {
    console.log("RETELL WEBHOOK: appendCallEvent failed", e);
  }

  return ok({ stored_as: key, event });
}