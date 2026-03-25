import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../api/client";
import type { ConfigField } from "../api/types";
import { Button } from "../components/shared/Button";
import { Toggle } from "../components/shared/Toggle";
import { Modal } from "../components/shared/Modal";

export function ConfigPage() {
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>("General");

  useEffect(() => {
    api
      .get<{ fields: ConfigField[] }>("/api/config/editable")
      .then((data) => setFields(data.fields))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Group fields by group
  const groups = useMemo(() => {
    const map = new Map<string, ConfigField[]>();
    for (const field of fields) {
      const group = field.group || "General";
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(field);
    }
    return map;
  }, [fields]);

  // Set default active group if the current one is empty
  useEffect(() => {
    if (!loading && !groups.has(activeGroup) && groups.size > 0) {
      setActiveGroup(Array.from(groups.keys()).sort()[0]);
    }
  }, [loading, groups, activeGroup]);

  const handleSave = useCallback(async (path: string, value: unknown) => {
    setSaving(path);
    try {
      const result = await api.patch<{ ok: boolean; needsRestart: boolean }>(
        "/api/config",
        { path, value },
      );
      if (result.needsRestart) setNeedsRestart(true);
      setFields((prev) =>
        prev.map((f) => (f.path === path ? { ...f, value } : f)),
      );
      setToast({ message: "Settings saved successfully", type: "success" });
    } catch (err) {
      setToast({
        message: `Failed to save: ${(err as Error).message}`,
        type: "error",
      });
    } finally {
      setSaving(null);
    }
  }, []);

  const handleRestart = useCallback(async () => {
    setShowRestartModal(false);
    try {
      await api.post("/api/restart");
    } catch (err) {
      setToast({
        message: `Restart failed: ${(err as Error).message}`,
        type: "error",
      });
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-danger/10 text-danger rounded-xl">
        Failed to load configuration: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-6xl mx-auto w-full pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-8 border-b border-zinc-200 dark:border-white/10 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            Settings
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
            Manage system configurations and agent properties.
          </p>
        </div>
        {needsRestart && (
          <Button
            variant="danger"
            onClick={() => setShowRestartModal(true)}
            className="shrink-0 animate-in fade-in"
          >
            Restart Required
          </Button>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-10 items-start">
        {/* Left Sidebar Menu */}
        <div className="w-full md:w-56 shrink-0 flex flex-col gap-1 md:sticky md:top-6">
          {Array.from(groups.keys())
            .sort()
            .map((groupName) => (
              <button
                key={groupName}
                onClick={() => setActiveGroup(groupName)}
                className={`px-4 py-2.5 text-left text-sm font-medium rounded-lg transition-all ${
                  activeGroup === groupName
                    ? "bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5"
                }`}
              >
                <span className="capitalize">{groupName}</span>
              </button>
            ))}
        </div>

        {/* Right Content Pane */}
        <div className="flex-1 w-full min-w-0">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100 capitalize">
              {activeGroup}
            </h2>
          </div>

          <div className="space-y-6">
            {(groups.get(activeGroup) || []).map((field) => (
              <ConfigFieldRow
                key={field.path}
                field={field}
                saving={saving === field.path}
                onSave={handleSave}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-xl flex items-center gap-2 animate-in slide-in-from-bottom-5 fade-in ${
            toast.type === "success"
              ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
              : "bg-danger text-white"
          }`}
        >
          {toast.type === "success" ? "✓" : "⚠️"} {toast.message}
        </div>
      )}

      {/* Restart Modal */}
      <Modal
        open={showRestartModal}
        onClose={() => setShowRestartModal(false)}
        title="Restart Server"
      >
        <div className="space-y-6">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Applying these changes requires a server restart. Active sessions
            will be temporarily disconnected. Do you want to continue?
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => setShowRestartModal(false)}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRestart}>
              Restart Now
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ConfigFieldRow({
  field,
  saving,
  onSave,
}: {
  field: ConfigField;
  saving: boolean;
  onSave: (path: string, value: unknown) => void;
}) {
  const [localValue, setLocalValue] = useState<unknown>(field.value);
  const isDirty = JSON.stringify(localValue) !== JSON.stringify(field.value);

  useEffect(() => {
    setLocalValue(field.value);
  }, [field.value]);

  const inputClasses =
    "w-full sm:w-80 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all font-mono";

  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 py-5 border-b border-zinc-200 dark:border-white/5 last:border-0 hover:bg-zinc-50/50 dark:hover:bg-white/[0.02] transition-colors rounded-xl px-2 -mx-2">
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {field.displayName}
          </label>
          {!field.hotReload && (
            <span className="text-[10px] uppercase font-bold text-warning-600 dark:text-warning px-1.5 py-0.5 rounded border border-warning/30 bg-warning/10">
              Restart Req
            </span>
          )}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-500 font-mono mt-1.5 break-all">
          {field.path}
        </div>
      </div>

      <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
        <div className="flex items-center gap-3">
          {field.type === "boolean" || field.type === "toggle" ? (
            <div className="h-[38px] flex items-center">
              <Toggle
                checked={localValue as boolean}
                onChange={(val) => onSave(field.path, val)}
                disabled={saving}
              />
            </div>
          ) : (field.type === "enum" || field.type === "select") &&
            field.options ? (
            <select
              value={String(localValue)}
              onChange={(e) => {
                setLocalValue(e.target.value);
                onSave(field.path, e.target.value);
              }}
              disabled={saving}
              className={inputClasses}
            >
              {field.options.map((opt) => (
                <option
                  key={opt}
                  value={opt}
                  className="bg-white dark:bg-zinc-800"
                >
                  {opt}
                </option>
              ))}
            </select>
          ) : field.type === "number" ? (
            <input
              type="number"
              value={String(localValue)}
              onChange={(e) => setLocalValue(Number(e.target.value))}
              disabled={saving}
              className={inputClasses}
            />
          ) : (
            <input
              type="text"
              value={String(localValue ?? "")}
              onChange={(e) => setLocalValue(e.target.value)}
              disabled={saving}
              className={inputClasses}
            />
          )}

          {isDirty &&
            !["boolean", "toggle", "enum", "select"].includes(field.type) && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => onSave(field.path, localValue)}
                disabled={saving}
              >
                Save
              </Button>
            )}
        </div>
      </div>
    </div>
  );
}
