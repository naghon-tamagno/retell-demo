import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AgentItem = { id: string; label: string };

function loadAgents(): AgentItem[] {
  const filePath = path.join(process.cwd(), "config", "agents.txt");
  const raw = fs.readFileSync(filePath, "utf8");

  const items: AgentItem[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;

    const parts = t.split("|");
    const id = (parts[0] ?? "").trim();
    const label = (parts[1] ?? "").trim();
    if (!id) continue;

    items.push({ id, label: label || id });
  }
  return items;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestedAgentId = body?.agent_id as string | undefined;

    const agents = loadAgents();
    if (!agents.length) {
      return NextResponse.json({ error: "agents.txt vacío" }, { status: 500 });
    }

    const chosen =
      requestedAgentId && agents.some((a) => a.id === requestedAgentId)
        ? requestedAgentId
        : agents[0].id; // fallback seguro

    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Falta RETELL_API_KEY" }, { status: 500 });
    }

    // Nota: endpoint exacto según Retell Web Call.
    // Si tu app ya funciona, mantenemos el mismo patrón: create-web-call -> access_token + call_id.
    const r = await fetch("https://api.retellai.com/v2/create-web-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: chosen,
        metadata: { mode: "demo", source: "retell-demo" },
      }),
    });

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      return NextResponse.json(
        { error: "Retell error", status: r.status, data },
        { status: 500 }
      );
    }

    // Normalizamos nombres por si el API cambia el casing
    const access_token = data?.access_token ?? data?.accessToken;
    const call_id = data?.call_id ?? data?.callId;

    return NextResponse.json(
      { access_token, call_id, agent_id: chosen },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "create-web-call failed", detail: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}