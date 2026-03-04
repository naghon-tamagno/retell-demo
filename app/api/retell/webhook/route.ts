import { NextResponse } from "next/server";
import { appendCallEvent } from "../../_store";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const event = body?.event;

  const callId =
    body?.call?.call_id ||
    body?.call?.callId ||
    body?.call_id ||
    body?.callId;

  // 🔎 LOG COMPLETO (temporal)
  // console.log("========== RETELL WEBHOOK ==========");
  // console.log("EVENT:", event);
  // console.log("CALL_ID:", callId);
  // console.log("BODY:", JSON.stringify(body, null, 2));
  // console.log("====================================");

  if (!callId) {
    return NextResponse.json({ error: "Missing call_id" }, { status: 400 });
  }

  appendCallEvent(callId, {
    received_at: new Date().toISOString(),
    event,
    payload: body,
  });

  return NextResponse.json({ ok: true });
}