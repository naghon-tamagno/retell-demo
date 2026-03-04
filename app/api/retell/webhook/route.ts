import { NextResponse } from "next/server";
import { appendCallEvent } from "../../_store";

export async function POST(req: Request) {
  let body: any = null;

  try {
    body = await req.json();
  } catch (e) {
    // No rompemos: Retell igual espera 200
    console.log("RETELL WEBHOOK: invalid JSON");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const event = body?.event ?? "unknown_event";

  const callId =
    body?.call?.call_id ||
    body?.call?.callId ||
    body?.call_id ||
    body?.callId ||
    null;

  // Log útil para debug (dejalo prendido hasta que pase el test)
  console.log("========== RETELL WEBHOOK ==========");
  console.log("EVENT:", event);
  console.log("CALL_ID:", callId);
  console.log("BODY:", JSON.stringify(body, null, 2));
  console.log("====================================");

  // Guardamos siempre; si no hay call_id, lo ponemos en un bucket "unknown"
  const key = callId ?? "unknown_call";

  try {
    appendCallEvent(key, {
      received_at: new Date().toISOString(),
      event,
      payload: body,
    });
  } catch (e) {
    // Tampoco rompemos
    console.log("RETELL WEBHOOK: appendCallEvent failed", e);
  }

  // CLAVE: nunca devolver 4xx a Retell
  return NextResponse.json({ ok: true }, { status: 200 });
}