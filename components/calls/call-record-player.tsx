"use client";

import { useState } from "react";
import { Play, Download, Loader2 } from "lucide-react";

/**
 * Lazy call-recording player: nothing loads until the user clicks Play, then an
 * <audio> streams from our server proxy (/api/calls/record). Plus a download
 * link through the same proxy. The Sipuni key never reaches the client.
 */
export function CallRecordPlayer({ callId }: { callId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const src = `/api/calls/record?id=${encodeURIComponent(callId)}`;

  if (open) {
    return (
      <div className="flex items-center justify-end gap-2">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          controls
          autoPlay
          src={src}
          onError={() => setError(true)}
          className="h-8 w-44"
        />
        <a
          href={`${src}&download=1`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-content-faint hover:text-content"
          title="Скачать запись"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        {error && <span className="text-[11px] text-signal-bad">ошибка</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2 py-1 text-xs text-content-muted transition-colors hover:border-xray/40 hover:text-content"
        title="Прослушать запись"
      >
        <Play className="h-3 w-3" />
        Запись
      </button>
      <a
        href={`${src}&download=1`}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-line-strong text-content-faint hover:text-content"
        title="Скачать запись"
      >
        <Download className="h-3 w-3" />
      </a>
    </div>
  );
}
