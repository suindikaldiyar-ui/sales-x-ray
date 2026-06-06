"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { Users } from "lucide-react";
import {
  saveSipuniManagersAction,
  type IntegrationActionState,
} from "@/lib/integrations/actions";
import { Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

const initial: IntegrationActionState = {};

type Row = { ext: string; name: string };

/**
 * Editor for the Sipuni extension→name map. Prefilled with existing pairs and
 * with extensions seen in calls that aren't mapped yet, plus a couple of blanks.
 */
export function SipuniManagerMap({
  existing,
  unmapped,
}: {
  existing: { extension: string; name: string }[];
  unmapped: string[];
}) {
  const [state, formAction] = useFormState(saveSipuniManagersAction, initial);

  const seed: Row[] = [
    ...existing.map((e) => ({ ext: e.extension, name: e.name })),
    ...unmapped.map((ext) => ({ ext, name: "" })),
  ];
  // Always leave 2 spare blank rows for new entries.
  seed.push({ ext: "", name: "" }, { ext: "", name: "" });

  const [rows, setRows] = useState<Row[]>(seed);

  function update(i: number, field: keyof Row, value: string) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-ink-700/40 p-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-xray" />
        <p className="text-sm font-medium text-content">Менеджеры: код Sipuni → имя</p>
      </div>
      <p className="text-xs text-content-faint">
        Sipuni отдаёт внутренний номер (202, 203…). Укажите, чьё это имя — оно
        будет показываться в звонках и отчётах.
      </p>

      <form action={formAction} className="space-y-2">
        {state.error && <Alert tone="error">{state.error}</Alert>}
        {state.message && <Alert tone="success">{state.message}</Alert>}

        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                name={`ext_${i}`}
                value={row.ext}
                onChange={(e) => update(i, "ext", e.target.value)}
                placeholder="202"
                className="h-9 w-24 text-sm"
              />
              <span className="text-content-faint">→</span>
              <Input
                name={`name_${i}`}
                value={row.name}
                onChange={(e) => update(i, "name", e.target.value)}
                placeholder="Имя менеджера"
                className="h-9 flex-1 text-sm"
              />
            </div>
          ))}
        </div>

        <SubmitButton size="sm">Сохранить карту менеджеров</SubmitButton>
      </form>
    </div>
  );
}
