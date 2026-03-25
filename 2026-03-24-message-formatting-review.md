# Review: Message Formatting Design Spec

**Reviewer:** Kien
**Date:** 2026-03-24
**Spec:** `2026-03-24-message-formatting-design.md`
**Verdict:** ✅ Approve with comments

---

## Summary

Spec giải quyết đúng vấn đề: code duplication giữa Telegram và Discord formatters đang ở mức cao (extractContentText, splitMessage, progressBar, formatTokens, icon maps — tất cả gần identical). 2-layer architecture (shared formatter → adapter renderer) là approach đúng, file structure hợp lý, backward compat được đảm bảo.

Dưới đây là các comments cần address trước khi implement.

---

## 🔴 Must Fix (blocking)

### 1. `rawInput` không có trong OutgoingMessage metadata

Smart tool summary cần extract args (file_path cho Read, command cho Bash, pattern cho Grep...) nhưng `MessageTransformer.transform()` **không forward `rawInput`** vào metadata:

```typescript
// message-transformer.ts:21-28 — hiện tại
const metadata = { id, name, kind, status, content, locations };
// ❌ rawInput bị bỏ
```

Không có rawInput → `formatToolSummary()` không thể extract `file_path`, `command`, `pattern` → summary table trong spec sẽ không hoạt động. Chỉ fallback được `🔧 ToolName`.

**Fix:** Thêm `rawInput: event.rawInput` vào metadata trong `MessageTransformer` cho cả `tool_call` và `tool_update`. 1-line change mỗi case.

### 2. `truncateContent` max length khác nhau giữa adapters

- Telegram: `maxLen = 3800`
- Discord: `maxLen = 500`

Spec không address việc consolidate giá trị này. Nếu `truncateContent` move vào shared, cần pass `maxLen` as parameter, không hardcode default.

**Fix:** Shared `truncateContent(text: string, maxLen: number): string` — bỏ default value, bắt adapter truyền explicit.

---

## 🟡 Should Fix (important, not blocking)

### 3. MessageRenderer interface có dead methods cho Telegram/Discord

```typescript
interface MessageRenderer<T> {
  renderCollapsed(msg: FormattedMessage): T   // ← Telegram/Discord always use this
  renderExpanded(msg: FormattedMessage): T    // ← Dead code cho Telegram/Discord
  renderFull(msg: FormattedMessage): T
}
```

Spec đã acknowledge Telegram/Discord không support expand/collapse. Vậy `renderExpanded()` chỉ dùng cho Web — 2/3 adapters sẽ có dead method.

**Đề xuất:** Simplify:

```typescript
interface MessageRenderer<T> {
  render(msg: FormattedMessage, expanded: boolean): T
}
```

Hoặc nếu muốn giữ named methods, thêm default impl ở base:

```typescript
abstract class BaseRenderer<T> implements MessageRenderer<T> {
  abstract renderCollapsed(msg: FormattedMessage): T
  renderExpanded(msg: FormattedMessage): T { return this.renderCollapsed(msg) }
  abstract renderFull(msg: FormattedMessage): T
}
```

### 4. MessageStyle trùng lặp với OutgoingMessage.type

```typescript
type MessageStyle = "text" | "thought" | "tool" | "plan" | "usage" | "system" | "error" | "attachment"
```

Gần identical với `OutgoingMessage.type`, chỉ merge `tool_call`/`tool_update` → `tool` và `session_end`/`system_message` → `system`. Thêm 1 abstraction mà không rõ value.

**Vấn đề thực tế:** Adapter renderer cần phân biệt `tool_call` (new message) vs `tool_update` (edit existing message) — `MessageStyle: "tool"` mất thông tin này.

**Đề xuất:** Giữ `OutgoingMessage.type` trong `FormattedMessage` thay vì map sang style riêng. Hoặc thêm field `originalType` nếu vẫn muốn style grouping.

### 5. Icon maps cần merge strategy rõ ràng

Telegram và Discord icon maps đã **diverged**:

| Key | Telegram | Discord | Spec |
|-----|----------|---------|------|
| `running` | ❌ missing | `🔄` | `🔄` |
| `write` | ❌ missing | `✏️` | `✏️` |
| `edit` | `✏️` | ❌ missing | `✏️` |
| `command` | ❌ missing | `⚡` | `▶️` ← Discord hiện dùng `⚡` |
| `execute` | `▶️` | ❌ missing | `▶️` |
| `fetch` | `🌐` | ❌ missing | ❌ missing |
| `other` | `🛠️` | ❌ missing | ❌ missing |

**Đề xuất:** Shared icon map nên là **superset** của tất cả, bao gồm aliases:

```typescript
const KIND_ICONS = {
  read: "📖",
  edit: "✏️", write: "✏️",           // aliases
  delete: "🗑️",
  execute: "▶️", command: "▶️", bash: "▶️",  // aliases
  search: "🔍",
  web: "🌐", fetch: "🌐",            // aliases
  agent: "🧠", think: "🧠",          // aliases
  install: "📦", move: "📦",          // aliases
  other: "🛠️",
}
```

Lưu ý: Discord hiện dùng `⚡` cho `command`, spec đổi thành `▶️`. Đây là visual change — cần confirm intentional.

### 6. `formatUsageReport()` — bị bỏ sót

`telegram/formatting.ts` có `formatUsageReport()` (30 dòng) cho `/usage` command. Discord không có function tương đương nhưng có thể cần trong tương lai. Spec không mention extract hay keep.

**Đề xuất:** Thêm vào spec — hoặc extract vào shared, hoặc explicitly note nó stay Telegram-only.

---

## 🟢 Nice to Have (non-blocking suggestions)

### 7. Tách Web adapter thành phase riêng

Spec define `ui/src/` files (ToolCallCard, ThoughtCard, PlanCard...) nhưng codebase chưa có web adapter. Trộn shared formatter refactor + web adapter implementation vào cùng 1 spec tăng scope và review difficulty.

**Đề xuất:**
- **Phase 1 (spec này):** Shared formatter + refactor Telegram/Discord
- **Phase 2 (spec riêng):** Web adapter + React components

Giữ web renderer interface trong spec cho reference, nhưng tách implementation.

### 8. Test strategy nên cover adapter renderers

Spec chỉ mention unit tests cho `message-formatter.test.ts` (shared formatter). Adapter renderers cũng cần tests:
- Telegram renderer produces valid HTML (no unclosed tags)
- Discord renderer respects 1800 char limit
- splitMessage preserves code block integrity (đã có logic phức tạp)

Hiện tại cả 2 adapter formatters đều **không có tests** — đây là cơ hội tốt để thêm.

### 9. `collapsible` field có thể derive từ context

```typescript
interface FormattedMessage {
  collapsible: boolean  // Can user expand/collapse?
}
```

`collapsible` luôn `true` cho thought, tool_call, tool_update, error và `false` cho text, usage, system. Nó derivable từ `style`/`type` — không cần explicit field.

**Đề xuất:** Bỏ `collapsible` khỏi `FormattedMessage`, để renderer tự decide dựa trên type. Hoặc nếu giữ, document rõ mapping rules.

### 10. Implementation order suggestion

```
1. Extract shared utilities → format-utils.ts, format-types.ts (+ tests)
2. Add rawInput to MessageTransformer metadata (1-line × 2 cases)
3. Implement formatOutgoingMessage() + formatToolSummary() (+ tests)
4. Refactor Discord adapter (simpler, ít quirks)
5. Refactor Telegram adapter (complex hơn: HTML, viewer links)
6. (Future phase) Web adapter
```

Discord trước Telegram vì Discord formatting đơn giản hơn — validate shared formatter hoạt động đúng trước khi tackle Telegram's HTML conversion.

---

## Out of Scope — Confirmed OK

- ✅ `permission_request` handled separately — đúng, nó đi qua `PermissionRequest` interface riêng
- ✅ `image_content`/`audio_content` skipped — đúng, handled by FileService
- ✅ `commands_update` skipped — đúng, UI-only cho skill buttons
- ✅ `markdownToTelegramHtml()` stays Telegram-specific — đúng
- ✅ No breaking changes to `MessageHandlers` interface — đúng, internal refactor only
