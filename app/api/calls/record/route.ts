import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import { createSipuniClient, type SipuniConfig } from "@/lib/integrations/sipuni";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Server-side proxy for a Sipuni call recording. The client only ever sends our
 * `calls.id` (uuid); the row is looked up scoped to the caller's organization
 * (RLS + explicit org filter), so a user can only fetch recordings of their own
 * org. The Sipuni API key stays on the server. Streams audio/mpeg to the client.
 *   GET /api/calls/record?id=<calls.id>[&download=1]
 */
export async function GET(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ ok: false, error: "Не авторизовано." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Не указан звонок." }, { status: 400 });
  const download = request.nextUrl.searchParams.get("download") === "1";

  const supabase = createClient();

  // Org-scoped lookup of the call → its Sipuni record id.
  const { data: call } = await supabase
    .from("calls")
    .select("record_id, has_record")
    .eq("organization_id", tenant.organization.id)
    .eq("id", id)
    .maybeSingle();
  if (!call || !call.record_id) {
    return NextResponse.json({ ok: false, error: "Запись не найдена." }, { status: 404 });
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("config")
    .eq("organization_id", tenant.organization.id)
    .eq("provider", "sipuni")
    .maybeSingle();
  const config = (integ?.config ?? {}) as Partial<SipuniConfig>;
  if (!config.user_id || !config.api_key) {
    return NextResponse.json({ ok: false, error: "Sipuni не подключён." }, { status: 400 });
  }

  try {
    const client = createSipuniClient(config as SipuniConfig);
    const { data, contentType } = await client.getRecordById(String(call.record_id));
    return new Response(Buffer.from(data), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": download
          ? `attachment; filename="call-${id}.mp3"`
          : "inline",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось получить запись.";
    console.error("[sipuni record] proxy error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
