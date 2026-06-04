import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wazzup webhook ingest (DORMANT until activated after deploy).
 *
 * Wazzup API v3 has no REST endpoint for message history — incoming messages
 * are delivered ONLY here, via webhooks. This endpoint persists them into
 * conversations/messages so the «Переписка» analytics light up.
 *
 * Activation (next step, after deploy):
 *   1. Set a secret:  integrations.config.webhook_secret  (provider 'wazzup').
 *   2. Point Wazzup at it:  PATCH https://api.wazzup24.com/v3/webhooks
 *        { webhooksUri: "https://<domain>/api/webhooks/wazzup/<orgId>",
 *          subscriptions: { messagesAndStatuses: true } }
 *      with crmKey = the same secret (Wazzup sends it as the Authorization
 *      header, which we verify below).
 *
 * Until a webhook_secret is configured the endpoint rejects everything, so it
 * is safe to ship inert. It runs with the service-role client (webhooks are
 * unauthenticated) and is hard-scoped to the org in the URL.
 *
 * NOTE: the exact message field mapping (inbound vs outbound, ids) must be
 * verified against a real Wazzup payload on first activation — we store the
 * raw payload alongside every row for exactly that reason.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { org: string } },
) {
  const org = params.org;
  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "server not configured" }, { status: 500 });
  }

  // Verify the per-org webhook secret. Dormant until one is set.
  const { data: integration } = await supabase
    .from("integrations")
    .select("config, status")
    .eq("organization_id", org)
    .eq("provider", "wazzup")
    .maybeSingle();

  const secret = (integration?.config as any)?.webhook_secret as string | undefined;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "webhook not enabled for this organization" },
      { status: 403 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "").trim();
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];

  // Wazzup also sends a test ping when the webhook is registered → 200.
  if (messages.length === 0) {
    return NextResponse.json({ ok: true });
  }

  let saved = 0;
  for (const m of messages) {
    const chatId = String(m.chatId ?? m.chat?.id ?? "");
    const messageId = String(m.messageId ?? m.id ?? "");
    if (!chatId || !messageId) continue;

    // Defensive direction inference — verify against a real payload on enable.
    const inbound: boolean =
      typeof m.inbound === "boolean" ? m.inbound : m.status == null && m.isEcho !== true;
    const sentAt = m.dateTime ? new Date(m.dateTime).toISOString() : new Date().toISOString();
    const contactName = m.contact?.name ?? m.authorName ?? null;
    const contactHandle = m.contact?.phone ?? m.contact?.username ?? chatId;

    await supabase.from("conversations").upsert(
      {
        organization_id: org,
        external_id: chatId,
        source: "wazzup",
        channel_id: m.channelId ?? null,
        transport: m.chatType ?? m.transport ?? null,
        contact_name: contactName,
        contact_handle: contactHandle,
        last_message_at: sentAt,
        last_message_text: m.text ?? null,
        last_message_inbound: inbound,
      },
      { onConflict: "organization_id,external_id" },
    );

    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("organization_id", org)
      .eq("external_id", chatId)
      .maybeSingle();
    if (!conv) continue;

    const { error } = await supabase.from("messages").upsert(
      {
        organization_id: org,
        conversation_id: conv.id,
        external_id: messageId,
        direction: inbound ? "in" : "out",
        author: m.authorName ?? null,
        author_name: m.authorName ?? null,
        body: m.text ?? null,
        status: m.status ?? null,
        message_type: m.type ?? null,
        sent_at: sentAt,
        raw: m,
      },
      { onConflict: "organization_id,external_id" },
    );
    if (!error) saved += 1;
  }

  return NextResponse.json({ ok: true, saved });
}
