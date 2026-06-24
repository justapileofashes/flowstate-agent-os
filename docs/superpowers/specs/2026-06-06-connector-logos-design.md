# Connector Brand Logos Design

**Date:** 2026-06-06
**Status:** Approved

---

## Overview

Replace text abbreviations and inaccurate SVG glyphs in the Connectors UI with accurate official brand marks. All logos render monochrome via `currentColor`.

---

## Changes

### 1. ConfigDialog — replace emoji text with BrandLogo

In `src/renderer/src/screens/Connectors.tsx`:

- Replace `<span className="text-2xl">{preset.emoji}</span>` in `ConfigDialog` header with `<div className="cnx-icon"><BrandLogo name={preset.name} size={22} /></div>`
- Remove `emoji` field from `Preset` interface
- Remove `emoji` string from every entry in `PRESETS`

### 2. SVG replacements in brand-logos.tsx

Replace inaccurate glyphs with official Simple Icons paths:

| Key | Source | Notes |
|-----|--------|-------|
| `Git` | simpleicons.org/git | Branch-diamond shape — official Git logo mark |
| `Brave Search` | simpleicons.org/brave | Lion-shield mark |
| `Browser (Puppeteer)` | simpleicons.org/puppeteer | Puppet/person mark |
| `Gmail` | simpleicons.org/gmail | M-fold envelope |
| `Google Classroom` | Google brand | Chalkboard mark |
| `Blender` | simpleicons.org/blender | Sphere + orbital ring |

### 3. Logos confirmed accurate (no change)

Filesystem, Web fetch, Memory, SQLite, Time — generic concepts, no single brand mark. Keep as-is.

GitHub (octocat), Telegram (paper plane), Discord (controller), Slack (hash), WhatsApp (speech bubble), Instagram (camera), Notion (N), Linear (diagonal), Google Drive (triangle) — already accurate.

---

## Files

| File | Action |
|------|--------|
| `src/renderer/src/lib/brand-logos.tsx` | Replace 6 SVG glyphs with accurate paths |
| `src/renderer/src/screens/Connectors.tsx` | Fix ConfigDialog + remove emoji field |
