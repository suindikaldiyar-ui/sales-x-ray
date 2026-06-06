import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wazzup webhook ingest.
 *
 * Wazzup API v3 has no REST endpoint for message history — incoming/outgoing
 * messages are delivered ONLY here, via webhooks. This endpoint persists them
 * into conversations/messages so the «Переписка» analytics light up.
 *
 * Security: a per-org secret (integrations.config.webhook_secret) must match.
 * It is accepted either as the `?s=` query param (recommended — it travels in
 * the webhooksUri you paste into Wazzup) or as the Authorization header. Runs
 * with the service-role client (webhooks are unauthenticated) and is hard
 * scoped to the org in the URL path.
 *
 * Activation:
 *   1. Generate the secret in the app (Integrations → Wazzup → «Включить приём»),
 *      which fills integrations.config.webhook_secret and shows the full URL.
 *   2. PATCH https://api.wazzup24.com/v3/webhooks
 *        { "webhooksUri": "<that full URL incl. ?s=...>",
 *          "subscriptions": { "messagesAndStatuses": true } }
 *      with header  Authorization: Bearer <your Wazzup API key>.
 *
 * The exact message field mapping must be verified against a REAL payload — we
 * store the raw payload on every row and log it, so the mapping can be tuned.
 */
function getSecret(request: NextRequest): string {
  const q = request.nextUrl.searchParams.get("s");
  if (q) return q.trim();
  const auth = request.headers.get("authorization") ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

/** Liveness probe (some setups GET the URL to verify it). */
export async function GET() {
  return NextResponse.json({ ok: true, service: "wazzup-webhook" });
}

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

  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
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
  if (getSecret(request) !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  // Log the full incoming payload so the field mapping can be verified.
  console.log(
    `[wazzup webhook] method=POST org=${org} status=200 payload:`,
    JSON.stringify(body),
  );

  const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];

  // Wazzup sends a test ping (and statuses-only webhooks) → just 200.
  if (messages.length === 0) {
    return NextResponse.json({ ok: true });
  }

  let saved = 0;
  for (const m of messages) {
    const chatId = String(m.chatId ?? m.chat?.id ?? "");
    const messageId = String(m.messageId ?? m.id ?? "");
    if (!chatId || !messageId) continue;

    const inbound = isInbound(m);
    // inbound → author is the client; outbound → the manager (authorName).
    const authorName = inbound
      ? (m.contact?.name ?? null)
      : (m.authorName ?? m.author?.name ?? null);
    const sentAt = m.dateTime ? new Date(m.dateTime).toISOString() : new Date().toISOString();
    const contactName: string | null = m.contact?.name ?? null;
    const contactHandle = m.contact?.phone ?? m.contact?.username ?? chatId;
    const msgType: string | null = m.type ?? null;
    const isText = !msgType || msgType.toLowerCase() === "text";
    // Text lives in `text` (try a couple of fallbacks just in case).
    const textBody: string | null = isText ? (m.text ?? m.content ?? m.body ?? null) : (m.text ?? null);
    // Media link (photo/audio/etc.) — Wazzup commonly uses `contentUri`.
    const mediaUrl: string | null =
      m.contentUri ??
      m.mediaUrl ??
      m.url ??
      (typeof m.content === "string" && /^https?:\/\//.test(m.content) ? m.content : null);

    // Log the direction + type + text fields so the mapping can be verified.
    console.log(
      `[wazzup webhook] msg id=${messageId} status=${m.status} isEcho=${m.isEcho} ` +
        `type=${m.type} inbound_field=${m.inbound} authorName=${m.authorName} ` +
        `contact=${m.contact?.name} text="${(textBody ?? "").slice(0, 60)}" ` +
        `-> dir=${inbound ? "in" : "out"}`,
    );
    // For non-text messages, dump ALL fields so we can pinpoint the media link.
    if (!isText) {
      console.log(
        `[wazzup webhook] media type=${msgType} contentUri=${m.contentUri} ` +
          `mediaUrl=${m.mediaUrl} url=${m.url} content=${typeof m.content === "string" ? m.content : typeof m.content} ` +
          `resolved=${mediaUrl} keys=[${Object.keys(m).join(",")}]`,
      );
    }

    // Build the conversation patch — don't overwrite a known contact name with
    // null (outbound messages may omit the contact).
    const convPatch: Record<string, unknown> = {
      organization_id: org,
      external_id: chatId,
      source: "wazzup",
      channel_id: m.channelId ?? null,
      transport: m.chatType ?? m.transport ?? null,
      contact_handle: contactHandle,
      last_message_at: sentAt,
      last_message_text: textBody,
      last_message_type: msgType,
      last_message_inbound: inbound,
    };
    if (contactName) convPatch.contact_name = contactName;

    await supabase
      .from("conversations")
      .upsert(convPatch, { onConflict: "organization_id,external_id" });

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
        author: authorName,
        author_name: authorName,
        body: textBody,
        media_url: mediaUrl,
        status: m.status ?? null,
        message_type: msgType,
        sent_at: sentAt,
        raw: m,
      },
      { onConflict: "organization_id,external_id" },
    );
    if (!error) saved += 1;
  }

  return NextResponse.json({ ok: true, saved });
}

/**
 * Wazzup v3 marks INCOMING messages with status "inbound"; outgoing ones carry
 * a delivery status (sent/delivered/read/error) and `isEcho` = sent from the
 * messenger app (still outbound). So: inbound iff status === "inbound".
 * Falls back to explicit boolean/direction fields if status is absent.
 */
function isInbound(m: any): boolean {
  const status = String(m?.status ?? "").toLowerCase();
  if (status === "inbound") return true;
  if (["sent", "delivered", "read", "error", "pending", "sending"].includes(status)) {
    return false;
  }
  if (typeof m?.inbound === "boolean") return m.inbound;
  const dir = String(m?.direction ?? "").toLowerCase();
  if (["in", "inbound", "incoming"].includes(dir)) return true;
  if (["out", "outbound", "outgoing"].includes(dir)) return false;
  if (m?.isEcho === true) return false; // sent from the app by a manager
  // No clear signal → treat as outbound (delivery-status messages dominate).
  return false;
}
