import type { SectionKind, SectionRead } from "@imbc/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router";
import type { z } from "zod";

import { api, ApiError } from "@/lib/api";

export type SectionFieldErrors = Record<string, string>;
export function useSectionDraft<Read, Write>(
  kind: SectionKind,
  initial: SectionRead<Read>,
  editable: (data: Read) => Write,
  schema: z.ZodType<Write>,
) {
  const cache = useQueryClient();
  const [server, setServer] = useState(initial);
  const [draft, setDraft] = useState<Write>(() => editable(initial.data));
  const [editing, setEditing] = useState(initial.profileStatus !== "verified");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [errors, setErrors] = useState<SectionFieldErrors>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(server.data));
  const disabled = initial.readOnly || !editing || saving;
  // Sync a clean draft when a new server value arrives; dirty input keeps its original editVersion.
  if (!dirty && !saving && initial !== server) {
    setServer(initial);
    setDraft(editable(initial.data));
  }
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [dirty],
    ),
  );

  function change(value: Write) {
    setDraft(value);
    setSaved(false);
    setErrors({});
  }
  function reset(value: SectionRead<Read>) {
    setServer(value);
    setDraft(editable(value.data));
    setErrors({});
    setFailure(null);
  }
  async function save() {
    const parsed = schema.safeParse(draft);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])));
      setFailure("validation");
      return;
    }
    setSaving(true);
    setFailure(null);
    setErrors({});
    try {
      const next = await api<SectionRead<Read>>(`/v1/profiles/own/sections/${kind}`, {
        method: "PUT",
        json: { editVersion: server.editVersion, data: parsed.data },
      });
      reset(next);
      setSaved(true);
      if (next.profileStatus === "verified") setEditing(false);
      cache.setQueryData(["profile", "sections", kind], next);
      await cache.invalidateQueries({ queryKey: ["profile"], exact: false });
    } catch (error) {
      const problem = error instanceof ApiError ? error : null;
      setFailure(problem?.code ?? "internal");
      setErrors(Object.fromEntries((problem?.fieldErrors ?? []).map(({ path, code }) => [path, code])));
    } finally {
      setSaving(false);
    }
  }
  async function reload() {
    setSaving(true);
    try {
      const next = await api<SectionRead<Read>>(`/v1/profiles/own/sections/${kind}`);
      reset(next);
      cache.setQueryData(["profile", "sections", kind], next);
    } catch {
      setFailure("internal");
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    reset(server);
    setSaved(false);
    if (server.profileStatus === "verified") setEditing(false);
  }
  return {
    draft,
    change,
    errors,
    setErrors,
    editing,
    setEditing,
    disabled,
    saving,
    dirty,
    saved,
    failure,
    server,
    save,
    reload,
    cancel,
    navigationGuard: {
      open: blocker.state === "blocked",
      stay: () => {
        if (blocker.state === "blocked") blocker.reset();
      },
      leave: () => {
        if (blocker.state === "blocked") blocker.proceed();
      },
    },
  };
}
