# Connector Brand Logos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inaccurate SVG glyphs in brand-logos.tsx with official Simple Icons paths, and fix ConfigDialog to use BrandLogo instead of text abbreviations.

**Architecture:** Two file changes — `brand-logos.tsx` gets 6 SVG replacements, `Connectors.tsx` loses the `emoji` field entirely and the ConfigDialog renders `<BrandLogo>`. No new files, no new deps, no tests (pure visual change).

**Tech Stack:** React, TypeScript, inline SVG, Simple Icons paths (fetched from simpleicons.org CDN)

---

## File Map

| File | Action |
|------|--------|
| `src/renderer/src/lib/brand-logos.tsx` | Replace 6 SVG glyph functions with accurate Simple Icons paths |
| `src/renderer/src/screens/Connectors.tsx` | Remove `emoji` field from `Preset` interface + all PRESETS entries; fix ConfigDialog header |

---

## Task 1: Replace inaccurate SVGs in brand-logos.tsx

**Files:**
- Modify: `src/renderer/src/lib/brand-logos.tsx`

- [ ] **Step 1: Replace the `Git` glyph**

In `src/renderer/src/lib/brand-logos.tsx`, replace the entire `Git` entry in `GLYPHS`:

```tsx
  Git: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187" />
    </svg>
  ),
```

- [ ] **Step 2: Replace the `Brave Search` glyph**

Replace the `'Brave Search'` entry in `GLYPHS`:

```tsx
  'Brave Search': (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z" />
    </svg>
  ),
```

- [ ] **Step 3: Replace the `Gmail` glyph**

Replace the `Gmail` entry in `GLYPHS`:

```tsx
  Gmail: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  ),
```

- [ ] **Step 4: Replace the `Blender` glyph**

Replace the `Blender` entry in `GLYPHS`:

```tsx
  Blender: (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.51 13.214c.046-.8.438-1.506 1.03-2.006a3.424 3.424 0 0 1 2.212-.79c.85 0 1.631.3 2.211.79.592.5.983 1.206 1.028 2.005.045.823-.285 1.586-.865 2.153a3.389 3.389 0 0 1-2.374.938 3.393 3.393 0 0 1-2.376-.938c-.58-.567-.91-1.33-.865-2.152M7.35 14.831c.006.314.106.922.256 1.398a7.372 7.372 0 0 0 1.593 2.757 8.227 8.227 0 0 0 2.787 2.001 8.947 8.947 0 0 0 3.66.76 8.964 8.964 0 0 0 3.657-.772 8.285 8.285 0 0 0 2.785-2.01 7.428 7.428 0 0 0 1.592-2.762 6.964 6.964 0 0 0 .25-3.074 7.123 7.123 0 0 0-1.016-2.779 7.764 7.764 0 0 0-1.852-2.043h.002L13.566 2.55l-.02-.015c-.492-.378-1.319-.376-1.86.002-.547.382-.609 1.015-.123 1.415l-.001.001 3.126 2.543-9.53.01h-.013c-.788.001-1.545.518-1.695 1.172-.154.665.38 1.217 1.2 1.22V8.9l4.83-.01-8.62 6.617-.034.025c-.813.622-1.075 1.658-.563 2.313.52.667 1.625.668 2.447.004L7.414 14s-.069.52-.063.831zm12.09 1.741c-.97.988-2.326 1.548-3.795 1.55-1.47.004-2.827-.552-3.797-1.538a4.51 4.51 0 0 1-1.036-1.622 4.282 4.282 0 0 1 .282-3.519 4.702 4.702 0 0 1 1.153-1.371c.942-.768 2.141-1.183 3.396-1.185 1.256-.002 2.455.41 3.398 1.175.48.391.87.854 1.152 1.367a4.28 4.28 0 0 1 .522 1.706 4.236 4.236 0 0 1-.239 1.811 4.54 4.54 0 0 1-1.035 1.626" />
    </svg>
  ),
```

- [ ] **Step 5: Replace the `Google Classroom` glyph**

Replace the `'Google Classroom'` entry in `GLYPHS`:

```tsx
  'Google Classroom': (s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M1.6367 1.6367C.7322 1.6367 0 2.369 0 3.2734v17.4532c0 .9045.7322 1.6367 1.6367 1.6367h20.7266c.9045 0 1.6367-.7322 1.6367-1.6367V3.2734c0-.9045-.7322-1.6367-1.6367-1.6367H1.6367zm.545 2.1817h19.6367v16.3632h-2.7266v-1.0898h-4.9102v1.0898h-12V3.8184zM12 8.1816c-.9046 0-1.6367.7322-1.6367 1.6368 0 .9045.7321 1.6367 1.6367 1.6367.9046 0 1.6367-.7322 1.6367-1.6367 0-.9046-.7321-1.6368-1.6367-1.6368zm-4.3633 1.9102c-.6773 0-1.2285.5493-1.2285 1.2266 0 .6772.5512 1.2265 1.2285 1.2265.6773 0 1.2266-.5493 1.2266-1.2265 0-.6773-.5493-1.2266-1.2266-1.2266zm8.7266 0c-.6773 0-1.2266.5493-1.2266 1.2266 0 .6772.5493 1.2265 1.2266 1.2265.6773 0 1.2285-.5493 1.2285-1.2265 0-.6773-.5512-1.2266-1.2285-1.2266zM12 12.5449c-1.179 0-2.4128.4012-3.1484 1.0059-.384-.1198-.8043-.1875-1.2149-.1875-1.3136 0-2.7285.695-2.7285 1.5586v.8965h14.1836v-.8965c0-.8637-1.4149-1.5586-2.7285-1.5586-.4106 0-.831.0677-1.2149.1875-.7356-.6047-1.9694-1.0059-3.1484-1.0059Z" />
    </svg>
  ),
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/brand-logos.tsx
git commit -m "feat(ui): replace connector SVGs with official Simple Icons paths"
```

---

## Task 2: Fix ConfigDialog to use BrandLogo + remove emoji field

**Files:**
- Modify: `src/renderer/src/screens/Connectors.tsx`

- [ ] **Step 1: Remove `emoji` from the `Preset` interface**

In `src/renderer/src/screens/Connectors.tsx`, find the `Preset` interface and remove the `emoji` line:

```ts
interface Preset {
  id: string;
  name: string;
  description: string;
  command: string;
  args: (config: Record<string, string>) => string[];
  fields?: Array<{ key: string; label: string; placeholder: string; type?: 'text' | 'password' }>;
  category: 'files' | 'web' | 'dev' | 'productivity' | 'memory' | 'messaging' | 'education' | '3d';
  docsUrl?: string;
}
```

- [ ] **Step 2: Remove `emoji` from every PRESETS entry**

Remove the `emoji: '...',` line from every object in the `PRESETS` array. There are 20 entries. Each has one line like `emoji: 'FS'` or `emoji: 'GH'` — delete all of them.

- [ ] **Step 3: Fix ConfigDialog header to use BrandLogo**

Find the `ConfigDialog` function. Its `header` currently renders:

```tsx
<header className="flex items-center gap-3 mb-3">
  <span className="text-2xl">{preset.emoji}</span>
  <div className="flex-1 min-w-0">
```

Replace with:

```tsx
<header className="flex items-center gap-3 mb-3">
  <div className="cnx-icon"><BrandLogo name={preset.name} size={22} /></div>
  <div className="flex-1 min-w-0">
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc -p tsconfig.web.json --noEmit
```

Expected: no errors. If there are errors referencing `preset.emoji`, search for any remaining `emoji` references and remove them.

- [ ] **Step 5: Run the app and verify**

```bash
npm run dev
```

Open Connectors screen. Click "Install" on any connector that has fields (e.g. GitHub, Slack, Notion). Verify the config dialog shows a proper SVG icon instead of text like "GH" or "SK".

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/Connectors.tsx
git commit -m "feat(ui): use BrandLogo in ConfigDialog, remove emoji field from connectors"
```
