# How Translations Work in This Bot

## 1. Language Roles (the foundation)

The whole system starts during **onboarding**. When someone joins the server, they pick their language preference, and the bot automatically assigns them a matching role:

| User | Picked language | Role assigned |
|------|-----------------|---------------|
| User 1 | Russian | `🌐 RU` |
| User 2 | English | `🌐 EN` |
| User 3 | French | `🌐 FR` |

These roles tell the bot **what language each person speaks**. Without a role, the bot treats that person as having no language, so their messages won't be translated.

## 2. How a conversation gets translated

The bot reads the last **5 messages** in the channel to understand the context — who's talking, and in what language. Then it translates based on what it finds.

### Example: User 1 (RU) and User 2 (EN) are chatting

**User 1 sends a message in Russian:**

> 📝 User 1: *Привет, как дела?*

The bot sees:
- User 1 speaks **Russian** (source)
- User 2 speaks **English** (in the conversation)

So it translates **Russian → English** and posts it:

> 💬 **RU:** Привет, как дела?
>
> 💬 **EN:** Hello, how are you?

**User 2 replies in English:**

> 📝 User 2: *Hello! I'm good, thanks.*

The bot detects the reply context and translates **English → Russian** for User 1.

## 3. Smart reply detection

When a member **replies to a specific message**, the bot doesn't guess from context — it uses the reply directly:

- If you reply to a translated bot message → the bot translates back into **that same language**.
- If you reply to a **user's message** → the bot translates into **that user's language role**.

This keeps back-and-forth conversations flowing in the right languages automatically.

## 4. The source and the translation are shown together

For every message, the bot posts:

- A **source embed** (red): the original sender's name, their message, and the language it was written in.
- A **translated embed** (blue): the translated text.

If multiple other languages are present in the conversation, **all translations appear in a single embed**, one per language — so you never get a wall of separate messages.

## 5. Many players chatting at once (group conversations)

When a lot of members of different languages are active in the same conversation, the bot handles it the same way — but for **everyone** at once.

### Example: 4 players, 4 languages

| User | Language role |
|------|---------------|
| User 1 | `🌐 RU` (Russian) |
| User 2 | `🌐 EN` (English) |
| User 3 | `🌐 FR` (French) |
| User 4 | `🌐 TH` (Thai) |

**User 1 sends a message in Russian:**

The bot checks who else is in the conversation (last 5 messages) and sees:
- User 2 speaks **English**
- User 3 speaks **French**
- User 4 speaks **Thai**

So it translates **Russian → English, French, and Thai**, and posts them all together:

> 📝 User 1: *Нужно собраться на rally в 20:00!*
>
> 💬 **EN:** We need to gather for the rally at 20:00!
>
> 💬 **FR:** On doit se rassembler pour le rally à 20h00 !
>
> 💬 **TH:** เราต้องรวมตัวสำหรับ rally เวลา 20:00 น.!

Each English speaker sees the English version, each French speaker sees the French version, and so on — all in **one** combined embed.

### Then any user replies

**User 4 (Thai) replies:**

> 📝 User 4: *ได้เลย ฉันจะไป!* (Okay, I'll be there!)

The bot looks at the conversation context and translates the reply into the languages that are active, so everyone keeps following along in their own language.

### What if someone isn't part of the active conversation?

The bot only translates into languages with **members actually talking in that channel right now**. If a French-speaker sits in another channel and never talks here, the bot won't bother translating into French until they're active in the conversation.

This keeps chat clean — you only ever see translations for the people who are actually there.

## 6. Members without a language are skipped

If someone hasn't picked a language during onboarding, the bot simply skips them. It won't translate their messages, and it won't try to translate *into* an unknown language.

## 7. Channel types & special behavior

The bot behaves differently depending on which channel you're in:

| Channel | Who can post | What happens |
|---------|--------------|--------------|
| **General chat** | Everyone with a language role | Full translation to all languages present |
| **Personal-pings** | Verified members only | Translates only to languages that have active members (one combined message) |
| **Public chat** | Anyone (guests) | Everything is translated to **English** automatically |
| **Verification** | Anyone | Screenshot posts get ✅ Verify / ❌ Cancel buttons for leadership |

## 8. What the bot preserves

When translating, the bot never messes with the important stuff:

- Player names, alliance names, server numbers
- Numbers, dates, and times
- URLs and links
- Discord mentions and formatting
- Game terms like **KVK, RoW, rally, fortress**
- Emojis where they make sense

It keeps the meaning and tone of the original message while changing only the language.

---

**In short:** the bot reads language roles → figures out the conversation context (last 5 messages / the message being replied to) → translates so that **everyone only ever sees messages in their own language**.
