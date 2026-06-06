import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { getConversationThread } from "@/lib/analytics/conversations";
import { getAiStatus } from "@/lib/ai/settings";
import { getCachedAnalyses } from "@/lib/ai/analyze";
import { ConversationAnalysisPanel } from "@/components/ai/conversation-analysis";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { messagePreview, isAttachment } from "@/lib/messages";
import { VoiceTranscribe } from "@/components/ai/voice-transcribe";
import { fmtChatTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const IMAGE_TYPES = ["image", "picture"];
const VOICE_TYPES = ["voice", "audio", "ptt"];

export const metadata = { title: "Диалог — Sales X-Ray" };

const fmtTime = fmtChatTime;

export default async function ConversationViewPage({
  params,
}: {
  params: { id: string };
}) {
  const tenant = await requireTenant();
  const supabase = createClient();
  const thread = await getConversationThread(supabase, tenant.organization.id, params.id);
  if (!thread) notFound();

  const ai = await getAiStatus(supabase, tenant.organization.id);
  const analyses = await getCachedAnalyses(supabase, tenant.organization.id, [params.id]);
  const analysis = analyses.get(params.id) ?? null;

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/conversations"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong text-content-muted hover:bg-ink-600"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-ink-600 text-content-muted">
            <MessagesSquare className="h-4 w-4" />
          </span>
          <div>
            <h1 className="font-display text-lg font-semibold text-content">
              {thread.contactName ?? thread.contactHandle ?? "Диалог"}
            </h1>
            {thread.contactHandle && (
              <p className="text-xs text-content-faint">{thread.contactHandle}</p>
            )}
          </div>
          {thread.transport && <Badge tone="neutral">{thread.transport}</Badge>}
        </div>
      </div>

      {thread.messages.length > 0 && (
        <div className="mb-6">
          <ConversationAnalysisPanel
            conversationId={params.id}
            initial={analysis}
            aiReady={ai.ready}
          />
        </div>
      )}

      <Card>
        {thread.messages.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare className="h-5 w-5" />}
            title="Сообщений пока нет"
            description="История появится после подключения вебхуков Wazzup."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {thread.messages.map((m) => (
              <div
                key={m.id}
                className={cn("flex", m.inbound ? "justify-start" : "justify-end")}
              >
                <div
                  className={cn(
                    "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm",
                    m.inbound
                      ? "rounded-tl-sm border border-line bg-ink-700 text-content"
                      : "rounded-tr-sm bg-xray/15 text-content",
                  )}
                >
                  {!m.inbound && m.authorName && (
                    <p className="mb-0.5 text-xs font-medium text-xray">{m.authorName}</p>
                  )}

                  {(() => {
                    const t = (m.type ?? "").toLowerCase();
                    // Photo → show the image (click to open full size).
                    if (IMAGE_TYPES.includes(t) && m.mediaUrl) {
                      return (
                        <>
                          <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={m.mediaUrl}
                              alt="Фото"
                              className="max-h-64 max-w-full rounded-lg border border-line object-cover"
                            />
                          </a>
                          {m.body && <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>}
                        </>
                      );
                    }
                    // Voice / audio → player + transcribe.
                    if (VOICE_TYPES.includes(t)) {
                      return (
                        <div>
                          <p className="italic text-content-muted">🎤 Голосовое</p>
                          {m.mediaUrl && (
                            // eslint-disable-next-line jsx-a11y/media-has-caption
                            <audio controls src={m.mediaUrl} className="mt-1.5 h-9 w-full max-w-[16rem]" />
                          )}
                          <VoiceTranscribe messageId={m.id} initial={m.transcript} aiReady={ai.ready} />
                        </div>
                      );
                    }
                    // Everything else → text or a typed chip.
                    return (
                      <p
                        className={cn(
                          "whitespace-pre-wrap break-words",
                          isAttachment(m.body, m.type) && "italic text-content-muted",
                        )}
                      >
                        {messagePreview(m.body, m.type)}
                      </p>
                    );
                  })()}

                  <p className="mt-1 text-right text-[10px] text-content-faint">
                    {fmtTime(m.sentAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
