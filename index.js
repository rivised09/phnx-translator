require("dotenv").config();

const {
    Client,
    ChannelType,
    GatewayIntentBits,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    ActivityType
} = require("discord.js");

const { GoogleGenAI } = require("@google/genai");

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Parse a comma-separated list of Discord IDs from an env var.
 * Returns an empty array when unset.
 */
function parseIdList(value) {
    return String(value || "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean);
}

const CONFIG = {
    // Gemini model
    GEMINI_MODEL: "gemini-3.1-flash-lite",

    // Language roles.
    //
    // IMPORTANT:
    // Change these names to EXACTLY match your Discord roles.
    //
    // Example:
    // "EN": "🌐 EN"
    //
    LANGUAGE_ROLES: {
        EN: "🌐 EN",
        RU: "🌐 RU",
        FIL: "🌐 FIL",
        ZH: "🌐 ZH",
        ES: "🌐 ES",
        ID: "🌐 ID",
        FR: "🌐 FR",
        DE: "🌐 DE",
        TH: "🌐 TH",
        AR: "🌐 AR",
        PT: "🌐 PT",
        JA: "🌐 JA",
        KO: "🌐 KO",
        VI: "🌐 VI",
        TR: "🌐 TR",
        HI: "🌐 HI",
        IT: "🌐 IT",
        PL: "🌐 PL",
        NL: "🌐 NL",
        SV: "🌐 SV",
        UK: "🌐 UK",
        FA: "🌐 FA",
        MS: "🌐 MS"
    },

    // Languages shown in translation headers.
    LANGUAGE_NAMES: {
        EN: "English",
        RU: "Russian",
        FIL: "Filipino",
        ZH: "Chinese",
        ES: "Spanish",
        ID: "Indonesian",
        FR: "French",
        DE: "German",
        TH: "Thai",
        AR: "Arabic",
        PT: "Portuguese",
        JA: "Japanese",
        KO: "Korean",
        VI: "Vietnamese",
        TR: "Turkish",
        HI: "Hindi",
        IT: "Italian",
        PL: "Polish",
        NL: "Dutch",
        SV: "Swedish",
        UK: "Ukrainian",
        FA: "Persian",
        MS: "Malay"
    },

    // Flag emojis for each language.
    LANGUAGE_FLAGS: {
        EN: "🇬🇧",
        RU: "🇷🇺",
        FIL: "🇵🇭",
        ZH: "🇨🇳",
        ES: "🇪🇸",
        ID: "🇮🇩",
        FR: "🇫🇷",
        DE: "🇩🇪",
        TH: "🇹🇭",
        AR: "🇸🇦",
        PT: "🇵🇹",
        JA: "🇯🇵",
        KO: "🇰🇷",
        VI: "🇻🇳",
        TR: "🇹🇷",
        HI: "🇮🇳",
        IT: "🇮🇹",
        PL: "🇵🇱",
        NL: "🇳🇱",
        SV: "🇸🇪",
        UK: "🇺🇦",
        FA: "🇮🇷",
        MS: "🇲🇾"
    },

    // Channels where automatic translation is enabled.
    TRANSLATION_CHANNELS: [
        process.env.GENERAL_CHANNEL_ID,
        process.env.PINGS_CHANNEL_ID,
        process.env.ALLY_CHAT_CHANNEL_ID
    ].filter(Boolean),

    // Restricted channels: only verified members can trigger
    // translation. Posts here translate only to languages
    // that have active members.
    //
    // To add more channels, just add their IDs to this array.
    RESTRICTED_CHANNELS: [
        process.env.PERSONAL_PINGS_CHANNEL_ID,
        process.env.WAR_ANNOUNCEMENTS_CHANNEL_ID,
        process.env.EVENTS_ANNOUNCEMENTS_CHANNEL_ID,
        process.env.REMINDERS_CHANNEL_ID
    ].filter(Boolean),

    // Public channels: for guests/unverified users.
    // No role required. Everything is translated to English.
    // If already English, no translation is sent.
    //
    // To add more channels, just add their IDs to this array.
    PUBLIC_CHAT_CHANNELS: [
        process.env.PUBLIC_CHAT_CHANNEL_ID
    ].filter(Boolean),

    // Category IDs (comma-separated in .env). Every channel
    // AND every forum post under these categories behaves like
    // a TRANSLATION_CHANNEL.
    //
    // Example .env:
    //   TRANSLATION_CATEGORY_IDS=111111111111111111,222222222222222222
    TRANSLATION_CATEGORIES: parseIdList(
        process.env.TRANSLATION_CATEGORY_IDS
    ),

    // Category IDs whose channels/forums behave like
    // RESTRICTED_CHANNELS (verified members only).
    RESTRICTED_CATEGORIES: parseIdList(
        process.env.RESTRICTED_CATEGORY_IDS
    ),

    // Category IDs whose channels/forums behave like
    // PUBLIC_CHAT_CHANNELS.
    PUBLIC_CHAT_CATEGORIES: parseIdList(
        process.env.PUBLIC_CHAT_CATEGORY_IDS
    ),

    // Role that indicates the member is verified.
    //
    // If you want translation BEFORE verification,
    // leave this empty in .env.
    VERIFIED_ROLE_ID: process.env.VERIFIED_ROLE_ID || "",

    // Role that indicates a freshly joined member who has not
    // yet verified. Used to send a DM reminder after onboarding
    // picks a language role.
    NEW_MEMBER_ROLE_ID: process.env.NEW_MEMBER_ROLE_ID || "",

    // Verification channel: users post account screenshots.
    // Leadership can approve or cancel.
    VERIFICATION_CHANNEL_ID: process.env.VERIFICATION_CHANNEL_ID || "",
    LEADERSHIP_ROLE_ID: process.env.LEADERSHIP_ROLE_ID || "",

    // Ignore very short messages.
    MINIMUM_MESSAGE_LENGTH: 2,

    // Maximum characters sent to Gemini.
    // Discord itself has a 2000 character message limit.
    MAX_TRANSLATION_LENGTH: 1800,

    // Cache translation results.
    CACHE_SIZE: 5000,

    // Don't translate these.
    IGNORED_PREFIXES: [
        "!",
        "?",
        "/",
        "."
    ]
};

// ============================================================
// CHECK ENVIRONMENT
// ============================================================

const requiredEnvironmentVariables = [
    "DISCORD_TOKEN",
    "CLIENT_ID",
    "GUILD_ID"
];

for (const variable of requiredEnvironmentVariables) {
    if (!process.env[variable]) {
        console.error(`❌ Missing environment variable: ${variable}`);
        process.exit(1);
    }
}

// ============================================================
// GEMINI API KEY ROTATION
// ============================================================

const geminiApiKeys = process.env.GEMINI_API_KEY
    .split(",")
    .map(key => key.trim())
    .filter(Boolean);

if (geminiApiKeys.length === 0) {
    console.error("❌ No GEMINI_API_KEY provided.");
    process.exit(1);
}

let currentKeyIndex = 0;

function getNextApiKey() {
    const key = geminiApiKeys[currentKeyIndex];
    currentKeyIndex =
        (currentKeyIndex + 1) % geminiApiKeys.length;
    return key;
}

function createGeminiClient() {
    return new GoogleGenAI({
        apiKey: getNextApiKey()
    });
}

// ============================================================
// CLIENTS
// ============================================================

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let gemini = createGeminiClient();

// ============================================================
// MEMORY / CACHE
// ============================================================

// userId -> language code
const userLanguageCache = new Map();

// translation cache
//
// key:
// messageContent + targetLanguage
//
// value:
// translated text
const translationCache = new Map();

// Prevent our own translation messages from being processed.
const botMessageIds = new Set();

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function trimCache(cache, maximumSize) {
    while (cache.size > maximumSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
}

/**
 * Format a channel as a readable label for logs.
 */
function channelLabel(channel) {
    if (!channel) return "unknown-channel";
    return `#${channel.name || channel.id}`;
}

/**
 * Check whether a channel is covered by a configuration list.
 *
 * Supports matching by:
 *  - direct channel ID
 *  - forum channel ID (for posts inside that forum)
 *  - category ID (every channel AND forum post under it)
 *
 * Forum posts and text threads are resolved to their parent
 * channel first, so a category match still applies inside them.
 */
function channelIsConfigured(
    channel,
    channelList = [],
    categoryList = []
) {
    if (!channel) return false;

    // Resolve threads (including forum posts) to the channel
    // that contains them.
    const parentChannel =
        typeof channel.isThread === "function" && channel.isThread()
            ? channel.parent
            : channel;

    // Direct channel or parent-forum match.
    if (channelList.includes(channel.id)) return true;
    if (parentChannel && channelList.includes(parentChannel.id)) {
        return true;
    }

    // Category match (category of the channel, or of the forum
    // a post lives in).
    if (
        parentChannel &&
        parentChannel.parentId &&
        categoryList.includes(parentChannel.parentId)
    ) {
        return true;
    }

    return false;
}

/**
 * Format a user/member as a readable label for logs.
 * Prefers the server nickname over the global username.
 */
function userLabel(user, member) {
    if (member && member.displayName) {
        return member.displayName;
    }
    if (user && user.username) {
        return user.username;
    }
    return "unknown-user";
}

/**
 * Truncate text for log previews (one line, no newlines).
 */
function previewText(text, maxLength = 60) {
    const singleLine =
        String(text || "").replace(/\s+/g, " ").trim();
    if (singleLine.length <= maxLength) return singleLine;
    return singleLine.slice(0, maxLength) + "…";
}

function normalizeRoleName(roleName) {
    return roleName
        .trim()
        .toUpperCase();
}

/**
 * Find the language code represented by a Discord member's roles.
 *
 * Example:
 *
 * Member roles:
 *   @everyone
 *   EN
 *   Archer
 *
 * returns:
 *
 *   EN
 */
function getMemberLanguageCode(member) {
    if (!member || !member.roles || !member.roles.cache) {
        return null;
    }

    for (const role of member.roles.cache.values()) {
        const roleName = normalizeRoleName(role.name);

        for (const [languageCode, configuredRoleName] of Object.entries(
            CONFIG.LANGUAGE_ROLES
        )) {
            if (
                normalizeRoleName(configuredRoleName) === roleName
            ) {
                return languageCode;
            }
        }
    }

    return null;
}

/**
 * Return a human-readable language name.
 */
function getLanguageName(languageCode) {
    return CONFIG.LANGUAGE_NAMES[languageCode] || languageCode;
}

/**
 * Get all language roles currently present in a guild.
 */
function getConfiguredLanguageRoles(guild) {
    const result = new Map();

    for (const [languageCode, configuredRoleName] of Object.entries(
        CONFIG.LANGUAGE_ROLES
    )) {
        const role = guild.roles.cache.find(
            r =>
                normalizeRoleName(r.name) ===
                normalizeRoleName(configuredRoleName)
        );

        if (role) {
            result.set(languageCode, role);
        }
    }

    return result;
}

/**
 * Find which languages are represented by members currently
 * visible to the bot.
 *
 * Returns a Set:
 *
 * Set(["EN", "RU", "FIL"])
 */
function getLanguagesPresentInGuild(guild) {
    const languages = new Set();

    for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;

        const language = getMemberLanguageCode(member);

        if (language) {
            languages.add(language);
        }
    }

    return languages;
}

/**
 * Refresh our user language cache.
 */
function rebuildLanguageCache(guild) {
    userLanguageCache.clear();

    for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;

        const language = getMemberLanguageCode(member);

        if (language) {
            userLanguageCache.set(member.id, language);
        }
    }

    console.log(
        `🔄 Language cache rebuilt: ${userLanguageCache.size} members`
    );
}

/**
 * Protect Discord-specific markup before Gemini sees it.
 *
 * Example:
 *
 * <@123456>
 *
 * becomes:
 *
 * [DISCORD_MENTION_0]
 */
function protectDiscordMarkup(text) {
    const placeholders = [];

    let protectedText = text;

    const patterns = [
        // User mentions
        /<@!?\d+>/g,

        // Role mentions
        /<@&\d+>/g,

        // Channel mentions
        /<#\d+>/g,

        // Custom emojis
        /<a?:\w+:\d+>/g,

        // URLs
        /https?:\/\/[^\s]+/gi
    ];

    for (const pattern of patterns) {
        protectedText = protectedText.replace(
            pattern,
            match => {
                const index = placeholders.length;

                placeholders.push(match);

                return `[DISCORD_PLACEHOLDER_${index}]`;
            }
        );
    }

    return {
        text: protectedText,
        placeholders
    };
}

/**
 * Restore Discord markup after translation.
 */
function restoreDiscordMarkup(text, placeholders) {
    let restored = text;

    placeholders.forEach((placeholder, index) => {
        const token = `[DISCORD_PLACEHOLDER_${index}]`;

        restored = restored.replaceAll(
            token,
            placeholder
        );
    });

    return restored;
}

/**
 * Clean Gemini output.
 */
function cleanTranslation(text) {
    if (!text) return "";

    let result = text.trim();

    // Remove accidental Markdown code fences.
    result = result.replace(/^```[a-zA-Z]*\s*/g, "");
    result = result.replace(/\s*```$/g, "");

    return result.trim();
}

/**
 * Decide whether this message should be ignored.
 */
function shouldIgnoreMessage(message) {
    if (!message) return true;

    // Bot messages
    if (message.author.bot) return true;

    // Webhook messages
    if (message.webhookId) return true;

    // Our own translation messages
    if (botMessageIds.has(message.id)) return true;

    // Wrong channel
    if (
        !channelIsConfigured(
            message.channel,
            CONFIG.TRANSLATION_CHANNELS,
            CONFIG.TRANSLATION_CATEGORIES
        )
    ) {
        return true;
    }

    // Empty message
    if (!message.content || !message.content.trim()) {
        return true;
    }

    // Too short
    if (
        message.content.trim().length <
        CONFIG.MINIMUM_MESSAGE_LENGTH
    ) {
        return true;
    }

    // Ignore commands
    for (const prefix of CONFIG.IGNORED_PREFIXES) {
        if (message.content.startsWith(prefix)) {
            return true;
        }
    }

    return false;
}

// ============================================================
// GEMINI
// ============================================================

/**
 * Detect the language of a text using Gemini.
 * Returns the language code (e.g. "EN", "RU", "TH").
 */
async function detectLanguage(text) {
    const languageList = Object.entries(CONFIG.LANGUAGE_NAMES)
        .map(([code, name]) => `${code}: ${name}`)
        .join(", ");

    const maxRetries = geminiApiKeys.length;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        gemini = createGeminiClient();

        try {
            const response =
                await gemini.models.generateContent({
                    model: CONFIG.GEMINI_MODEL,
                    contents:
                        `Detect the language of this text. ` +
                        `Reply with ONLY the language code ` +
                        `from this list: ${languageList}. ` +
                        `If unknown, reply EN.\n\n` +
                        `Text: ${text.slice(0, 500)}`,
                    config: {
                        temperature: 0,
                        maxOutputTokens: 5
                    }
                });

            const detected =
                (response.text || "").trim().toUpperCase();

            if (!detected || !CONFIG.LANGUAGE_NAMES[detected]) {
                return "EN";
            }

            return detected;

        } catch (error) {
            lastError = error;
            const msg = error.message || "";

            if (
                attempt < maxRetries - 1 &&
                (
                    msg.includes("RESOURCE_EXHAUSTED") ||
                    msg.includes("429") ||
                    msg.includes("UNAVAILABLE") ||
                    msg.includes("503") ||
                    msg.includes("quota") ||
                    msg.includes("limit")
                )
            ) {
                continue;
            }

            throw error;
        }
    }

    throw lastError;
}

/**
 * Translate text using Gemini.
 *
 * Optional `cacheContext` is appended to the cache-hit log so
 * traces contain the requester / channel (e.g. for monitoring).
 */
async function translateText(
    text,
    sourceLanguage,
    targetLanguage,
    cacheContext = ""
) {
    const cacheKey =
        `${sourceLanguage}|${targetLanguage}|${text}`;

    if (translationCache.has(cacheKey)) {
        console.log(
            `💾 Cache hit: ${sourceLanguage} -> ${targetLanguage}` +
            (cacheContext ? ` [${cacheContext}]` : "")
        );

        return translationCache.get(cacheKey);
    }

    const protectedData = protectDiscordMarkup(text);

    const prompt = `
You are the official Server 973 Discord translator.

Translate the message below from ${sourceLanguage}
to ${targetLanguage}.

IMPORTANT RULES:

1. Return ONLY the translation.
2. Do not explain anything.
3. Preserve the original meaning.
4. Preserve the original tone.
5. Preserve player names exactly.
6. Preserve numbers exactly.
7. Preserve dates and times exactly.
8. Preserve URLs exactly.
9. Preserve Discord placeholders exactly.
10. Preserve emojis where appropriate.
11. Do not translate Discord placeholders such as:
    [DISCORD_PLACEHOLDER_0]
    [DISCORD_PLACEHOLDER_1]
12. Preserve game terminology.
13. Terms such as KVK, RoW, rally, fortress,
    server number, alliance names and player names
    should not be unnecessarily changed.
14. Do not add quotation marks.
15. Do not add "Translation:".
16. Do not censor normal game terminology.
17. Do not change @ mentions or Discord formatting.
18. If the message is already effectively in the target language,
    return it naturally without unnecessary rewriting.

Source language:
${sourceLanguage}

Target language:
${targetLanguage}

Message:
${protectedData.text}
`;

    const maxRetries = geminiApiKeys.length;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        gemini = createGeminiClient();

        try {
            const response = await gemini.models.generateContent({
                model: CONFIG.GEMINI_MODEL,
                contents: prompt,
                config: {
                    temperature: 0.2,
                    maxOutputTokens: 1000
                }
            });

            let translated = response.text;

            if (!translated) {
                throw new Error("Gemini returned no text.");
            }

            translated = cleanTranslation(translated);

            translated = restoreDiscordMarkup(
                translated,
                protectedData.placeholders
            );

            translationCache.set(
                cacheKey,
                translated
            );

            trimCache(
                translationCache,
                CONFIG.CACHE_SIZE
            );

            console.log(
                `✨ Translated: ${sourceLanguage} -> ${targetLanguage}` +
                (cacheContext ? ` [${cacheContext}]` : "") +
                `\n   Source: ${previewText(text)}`
            );

            return translated;

        } catch (error) {
            lastError = error;
            const msg = error.message || "";

            if (
                attempt < maxRetries - 1 &&
                (
                    msg.includes("RESOURCE_EXHAUSTED") ||
                    msg.includes("429") ||
                    msg.includes("UNAVAILABLE") ||
                    msg.includes("503") ||
                    msg.includes("quota") ||
                    msg.includes("limit")
                )
            ) {
                console.warn(
                    `⚠️ Key ${attempt + 1}/${maxRetries} failed, rotating to next key...`
                );
                continue;
            }

            throw error;
        }
    }

    console.error(
        "❌ All API keys exhausted:",
        lastError
    );

    throw lastError;
}

// ============================================================
// DISCORD MESSAGE SENDING
// ============================================================

/**
 * Send a translation to the channel.
 */
async function sendTranslation(
    message,
    languageCode,
    translatedText,
    sourceLanguageCode
) {
    if (!translatedText) return;

    const languageName =
        getLanguageName(languageCode);
    const sourceLanguageName =
        getLanguageName(sourceLanguageCode);

    const sourceEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("\u200B")
        .setThumbnail(message.author.displayAvatarURL())
        .setDescription(
            `**${message.author.username}**\n` +
            message.content +
            `\n\n*${sourceLanguageName}*`
        );

    const translatedEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("\u200B")
        .setDescription(
            translatedText +
            `\n\n*${languageName}*`
        );

    try {
        const sent =
            await message.channel.send({
                embeds: [sourceEmbed, translatedEmbed],
                allowedMentions: {
                    parse: []
                }
            });

        botMessageIds.add(sent.id);

        setTimeout(() => {
            botMessageIds.delete(sent.id);
        }, 10 * 60 * 1000);

        console.log(
            `✅ Public translation posted in ${channelLabel(message.channel)}: ` +
            `${userLabel(message.author, message.member)} ` +
            `(${sourceLanguageName} -> ${languageName}): ` +
            `"${previewText(message.content)}"`
        );

    } catch (error) {
        console.error(
            "❌ Could not send translation in " +
            `${channelLabel(message.channel)}:`,
            error
        );
    }
}

// ============================================================
// SMART LANGUAGE DETECTION
// ============================================================

/**
 * Extract the target language code from a bot translation embed.
 */
function getLanguageFromEmbed(message) {
    if (!message.embeds || message.embeds.length === 0) {
        return null;
    }

    for (const embed of message.embeds) {
        if (embed.footer && embed.footer.text) {
            const langName = embed.footer.text.trim();

            for (const [code, name] of Object.entries(
                CONFIG.LANGUAGE_NAMES
            )) {
                if (name === langName) {
                    return code;
                }
            }
        }
    }

    return null;
}

/**
 * Determine which languages to translate to based on
 * reply context and recent conversation.
 */
async function determineTargetLanguages(
    message,
    authorLanguageCode,
    guild
) {
    // ========================================================
    // 1. REPLY-BASED DETECTION
    // ========================================================

    if (message.reference && message.reference.messageId) {
        try {
            const repliedMessage =
                await message.channel.messages.fetch(
                    message.reference.messageId
                );

            // If replying to a bot translation, use that language.
            if (repliedMessage.author.bot) {
                const targetLang =
                    getLanguageFromEmbed(repliedMessage);

                if (
                    targetLang &&
                    targetLang !== authorLanguageCode
                ) {
                    console.log(
                        `💬 Reply detected in ${channelLabel(message.channel)} ` +
                        `by ${message.author.username} → translating to ${targetLang}`
                    );

                    return new Set([targetLang]);
                }
            }

            // If replying to a user, detect their language role.
            const repliedMember =
                await guild.members.fetch(
                    repliedMessage.author.id
                );

            const repliedLang =
                userLanguageCache.get(repliedMember.id) ||
                getMemberLanguageCode(repliedMember);

            if (
                repliedLang &&
                repliedLang !== authorLanguageCode
            ) {
                console.log(
                    `💬 Reply to ${repliedMessage.author.username} in ${channelLabel(message.channel)} ` +
                    `by ${message.author.username} → translating to ${repliedLang}`
                );

                return new Set([repliedLang]);
            }
        } catch (error) {
            console.error(
                "Could not fetch replied message:",
                error
            );
        }
    }

    // ========================================================
    // 2. CONTEXT-BASED DETECTION (recent messages)
    // ========================================================

    try {
        const recentMessages =
            await message.channel.messages.fetch({
                limit: 5,
                before: message.id
            });

        for (const [, msg] of recentMessages) {
            if (msg.author.bot) {
                const targetLang =
                    getLanguageFromEmbed(msg);

                if (
                    targetLang &&
                    targetLang !== authorLanguageCode
                ) {
                    console.log(
                        `📡 Context from recent message in ${channelLabel(message.channel)} ` +
                        `for ${message.author.username} → translating to ${targetLang}`
                    );

                    return new Set([targetLang]);
                }
            }
        }
    } catch (error) {
        console.error(
            "Could not fetch recent messages:",
            error
        );
    }

    // ========================================================
    // 3. FALLBACK: all languages present in guild
    // ========================================================

    const languagesPresent =
        getLanguagesPresentInGuild(guild);

    languagesPresent.delete(authorLanguageCode);

    return languagesPresent;
}

/**
 * Handle translation in public chat channels.
 * No role required. Translates everything to English.
 * If already English, no translation is sent.
 */
async function handlePublicChat(message) {
    if (
        !channelIsConfigured(
            message.channel,
            CONFIG.PUBLIC_CHAT_CHANNELS,
            CONFIG.PUBLIC_CHAT_CATEGORIES
        )
    ) {
        return false;
    }

    if (!message.author) return true;
    if (!message.content || !message.content.trim()) return true;

    // Detect source language via Gemini.
    let sourceLanguageCode;

    try {
        sourceLanguageCode =
            await detectLanguage(message.content);
    } catch (error) {
        console.error(
            "❌ Language detection failed:",
            error
        );

        return true;
    }

    // Already English, skip.
    if (sourceLanguageCode === "EN") {
        return true;
    }

    const sourceLanguage =
        getLanguageName(sourceLanguageCode);

    const authorLabel =
        userLabel(message.author, message.member);

    console.log(
        `🌍 Public chat in ${channelLabel(message.channel)}: ` +
        `${authorLabel} wrote in ${sourceLanguage}: ` +
        `"${previewText(message.content)}"`
    );

    try {
        const translated =
            await translateText(
                message.content,
                sourceLanguage,
                "English",
                `public ${authorLabel} in ${channelLabel(message.channel)}`
            );

        if (
            !translated ||
            translated.trim() ===
                message.content.trim()
        ) {
            console.log(
                `ℹ️ Public chat: ${authorLabel}'s ${sourceLanguage} message ` +
                `had nothing to translate in ${channelLabel(message.channel)}`
            );
            return true;
        }

        await sendTranslation(
            message,
            "EN",
            translated,
            sourceLanguageCode
        );
    } catch (error) {
        console.error(
            `❌ Translation failed for ${authorLabel}: ${sourceLanguage} -> English`,
            error
        );
    }

    return true;
}

/**
 * Handle translation in restricted channels.
 * Only verified members can trigger translation.
 * Translates only to languages that have active members.
 */
async function handleRestrictedChannel(message) {
    if (
        !channelIsConfigured(
            message.channel,
            CONFIG.RESTRICTED_CHANNELS,
            CONFIG.RESTRICTED_CATEGORIES
        )
    ) {
        return false;
    }

    if (!message.author) return true;
    if (!message.content || !message.content.trim()) return true;

    if (!message.member) {
        try {
            message.member =
                await message.guild.members.fetch(
                    message.author.id
                );
        } catch {
            return true;
        }
    }

    // Check if user has the verified role.
    const hasRole =
        CONFIG.VERIFIED_ROLE_ID &&
        message.member.roles.cache.has(
            CONFIG.VERIFIED_ROLE_ID
        );

    if (!hasRole) {
        console.log(
            `🔒 ${userLabel(message.author, message.member)} is NOT verified ` +
            `in restricted channel ${channelLabel(message.channel)}: ` +
            `"${previewText(message.content)}"`
        );

        return true;
    }

    console.log(
        `🔓 Verified ${userLabel(message.author, message.member)} posted ` +
        `in restricted channel ${channelLabel(message.channel)}`
    );

    // Restricted channels use the same private translate
    // button as the general channels.
    await attachTranslateButton(message);

    return true;
}

// ============================================================
// PRIVATE TRANSLATION (BUTTON + CONTEXT MENU)
// ============================================================

/**
 * Translate a text into a member's preferred language and
 * return the result. Detects whether translation is actually
 * needed (e.g. the message may already be in the member's
 * language, as with an Arabic member who writes in English).
 *
 * Returns an object:
 *   { needed: bool, code: string, name: string, text: string }
 */
async function translateForMember(text, targetLanguageCode, cacheContext = "") {
    const targetLanguage =
        getLanguageName(targetLanguageCode);

    // Detect the actual language of the message.
    let sourceCode = "EN";
    try {
        sourceCode = await detectLanguage(text);
    } catch (error) {
        console.error(
            "❌ Language detection failed:",
            error
        );
    }

    const sourceLanguage =
        getLanguageName(sourceCode);

    // If the message is already in the member's language
    // (or undetected), no translation is needed.
    if (sourceCode === targetLanguageCode) {
        return {
            needed: false,
            code: targetLanguageCode,
            name: targetLanguage,
            text
        };
    }

    const translated =
        await translateText(
            text,
            sourceLanguage,
            targetLanguage,
            cacheContext
        );

    return {
        needed: true,
        code: targetLanguageCode,
        name: targetLanguage,
        text: translated
    };
}

/**
 * Determine whether a message contains actual translatable
 * text. Returns false for pure emoji (unicode + custom), and
 * for messages that only carry attachments/stickers/embeds
 * with no text caption.
 */
function hasTranslatableText(message) {
    const content =
        (message.content || "").trim();

    if (content.length === 0) return false;

    // Remove custom emojis (<:name:id> and <a:name:id>).
    let text = content.replace(
        /<a?:\w+:\d+>/g,
        ""
    );

    // Remove unicode emoji sequences (with skin tones,
    // variation selectors and ZWJ joins) and whitespace.
    const emojiRegex =
        /(\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*|\p{Extended_Pictographic}\uFE0F|\d\ufe0f\u20e3|\p{Emoji_Component}\uFE0F|\p{Emoji_Presentation})+[\uFE0F\u200d\u{E0100}-\u{E01EF}]*/gu;

    text = text.replace(emojiRegex, "").trim();

    // If any real word/character remains, it's translatable.
    return text.length > 0;
}

/**
 * Attach a single "🌐 Translate" button to an eligible
 * message in the configured translation channels.
 */
async function attachTranslateButton(message) {
    if (!message) return;
    if (!message.channel) return;

    // Bot / webhook / bot-translation messages are never eligible.
    if (message.author.bot) return;
    if (message.webhookId) return;
    if (botMessageIds.has(message.id)) return;

    // Only in translation or restricted channels (or the
    // categories configured to behave like them).
    const inTranslation = channelIsConfigured(
        message.channel,
        CONFIG.TRANSLATION_CHANNELS,
        CONFIG.TRANSLATION_CATEGORIES
    );
    const inRestricted = channelIsConfigured(
        message.channel,
        CONFIG.RESTRICTED_CHANNELS,
        CONFIG.RESTRICTED_CATEGORIES
    );

    if (!inTranslation && !inRestricted) return;

    // Only attach the button when there is actual text to
    // translate. Pure emoji / image-without-caption / gif /
    // sticker-only messages have no translatable content, so
    // no button.
    if (!hasTranslatableText(message)) return;

    // Resolve the display name: prefer the server nickname,
    // falling back to the global username.
    const displayName =
        (message.member &&
            message.member.displayName) ||
        message.author.username;

    const translateButton = new ButtonBuilder()
        .setCustomId(`translate_${message.id}`)
        .setLabel("Translate")
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder()
        .addComponents(translateButton);

    try {
        const reply = await message.reply({
            content: `**${displayName}** · *English*`,
            allowedMentions: { parse: [] },
            components: [row]
        });

        translateReplies.set(message.id, reply);

        console.log(
            `🔘 Attached translate button in ${channelLabel(message.channel)} ` +
            `for ${userLabel(message.author, message.member)}: ` +
            `"${previewText(message.content)}"`
        );
    } catch (error) {
        console.error(
            "❌ Could not attach translate button:",
            error
        );
    }
}

/**
 * Attach a translate button to a single forum post's starter
 * message. Returns true when a new button was added.
 */
async function backfillForumPost(thread) {
    const starter = await thread.fetchStarterMessage();

    if (!starter) return false;
    if (!hasTranslatableText(starter)) return false;

    // Skip posts that already have a button reply from us.
    const existing = await thread.messages.fetch({
        limit: 100
    });

    const alreadyHasButton = existing.some(message => {
        if (
            !discordClient.user ||
            message.author.id !== discordClient.user.id
        ) {
            return false;
        }

        return message.components.some(
            row =>
                Array.isArray(row.components) &&
                row.components.some(
                    component =>
                        component.customId ===
                        `translate_${starter.id}`
                )
        );
    });

    if (alreadyHasButton) return false;

    await attachTranslateButton(starter);

    return true;
}

/**
 * Backfill translate buttons on every forum post (starter
 * message) inside the configured translation/restricted
 * channels and categories. Text channels and thread replies
 * are intentionally ignored.
 */
async function backfillForumPosts(guild, includeArchived = false) {
    const summary = {
        forums: 0,
        posts: 0,
        added: 0,
        skipped: 0
    };

    if (!guild) return summary;

    const forums = guild.channels.cache.filter(
        channel =>
            (channel.type === ChannelType.GuildForum ||
                channel.type === ChannelType.GuildMedia) &&
            (channelIsConfigured(
                channel,
                CONFIG.TRANSLATION_CHANNELS,
                CONFIG.TRANSLATION_CATEGORIES
            ) ||
                channelIsConfigured(
                    channel,
                    CONFIG.RESTRICTED_CHANNELS,
                    CONFIG.RESTRICTED_CATEGORIES
                ))
    );

    for (const [, forum] of forums) {
        summary.forums++;

        const threads = new Map();

        try {
            const active = await forum.threads.fetchActive();

            for (const [id, thread] of active.threads) {
                threads.set(id, thread);
            }
        } catch (error) {
            console.error(
                `❌ Backfill: could not list active posts in ${channelLabel(forum)}:`,
                error
            );
        }

        if (includeArchived) {
            try {
                const archived =
                    await forum.threads.fetchArchived({
                        fetchAll: true
                    });

                for (const [id, thread] of archived.threads) {
                    threads.set(id, thread);
                }
            } catch (error) {
                console.error(
                    `❌ Backfill: could not list archived posts in ${channelLabel(forum)}:`,
                    error
                );
            }
        }

        for (const [, thread] of threads) {
            summary.posts++;

            try {
                const added = await backfillForumPost(thread);

                if (added) {
                    summary.added++;
                } else {
                    summary.skipped++;
                }
            } catch (error) {
                summary.skipped++;

                console.error(
                    `❌ Backfill: failed on post in ${channelLabel(forum)}:`,
                    error
                );
            }

            // Gentle pace to stay clear of rate limits.
            await new Promise(resolve =>
                setTimeout(resolve, 500)
            );
        }
    }

    return summary;
}

/**
 * Get a message by ID from the interaction's channel.
 */
async function fetchMessageInChannel(interaction, messageId) {
    return await interaction.channel.messages.fetch(
        messageId
    );
}

/**
 * Shared logic: produce and send a private translation for a
 * member based on a given message. Used by both the button
 * interaction and the context-menu interaction.
 *
 * Returns the ephemeral reply content (or null if skipped).
 */
async function sendPrivateTranslation(interaction, targetMessage) {
    // Determine the clicking member's language role.
    let member = interaction.member;

    if (member && !member.roles) {
        try {
            member = await interaction.guild.members.fetch(
                interaction.user.id
            );
        } catch {
            // ignore
        }
    }

    const languageCode =
        userLanguageCache.get(interaction.user.id) ||
        getMemberLanguageCode(member);

    const requesterLabel =
        userLabel(interaction.user, member || interaction.member);

    if (!languageCode) {
        console.log(
            `❌ ${requesterLabel} has no language role — ` +
            `could not translate in ${channelLabel(interaction.channel)}`
        );

        return {
            error: "❌ You don't have a language role set. " +
                "Please pick your language during onboarding."
        };
    }

    const languageName =
        getLanguageName(languageCode);

    // Resolve the source message author's server nickname.
    let authorName = targetMessage.author.username;

    try {
        const authorMember =
            await interaction.guild.members.fetch(
                targetMessage.author.id
            );

        if (
            authorMember &&
            authorMember.displayName
        ) {
            authorName = authorMember.displayName;
        }
    } catch {
        // Fall back to username if member can't be fetched.
    }

    try {
        // Handles the "Arabic member writes in English" case:
        // detects the actual message language and skips if it
        // already matches the member's language.
        const result =
            await translateForMember(
                targetMessage.content,
                languageCode,
                `private ${requesterLabel} in ${channelLabel(interaction.channel)}`
            );

        if (!result.needed) {
            console.log(
                `ℹ️ ${requesterLabel}: message by ${targetMessage.author.username} ` +
                `already in ${languageName} — skipped in ${channelLabel(interaction.channel)}`
            );

            return {
                content:
                    `ℹ️ That message is already in **${languageName}** — ` +
                    `no translation needed.`
            };
        }

        if (
            !result.text ||
            result.text.trim() ===
                targetMessage.content.trim()
        ) {
            console.log(
                `ℹ️ ${requesterLabel}: nothing to translate ` +
                `into ${languageName} in ${channelLabel(interaction.channel)}`
            );

            return {
                content:
                    `ℹ️ Nothing to translate into **${languageName}**.`
            };
        }

        console.log(
            `✅ ${requesterLabel} got a private translation ` +
            `(${languageName}) in ${channelLabel(interaction.channel)} ` +
            `for ${targetMessage.author.username}: ` +
            `"${previewText(targetMessage.content)}"`
        );

        return {
            content:
                `> **${authorName}** · ${languageName}\n\n` +
                result.text,
            embeds: [],
            components: []
        };

    } catch (error) {
        console.error(
            "❌ Private translation error:",
            error
        );

        return {
            error:
                "❌ Translation failed. Please try again later."
        };
    }
}

/**
 * Handle a "🌐 Translate" button click.
 */
async function handleTranslateButton(interaction) {
    const messageId = interaction.customId.replace(
        "translate_",
        ""
    );

    const requesterLabel =
        userLabel(interaction.user, interaction.member);

    console.log(
        `🖱️ ${requesterLabel} clicked Translate button in ` +
        `${channelLabel(interaction.channel)} ` +
        `(message ${messageId})`
    );

    // Reply is deferred because translation can exceed
    // the 3-second interaction window.
    await interaction.deferReply({ flags: 64 });

    let targetMessage;
    try {
        targetMessage =
            await fetchMessageInChannel(
                interaction,
                messageId
            );
    } catch (error) {
        console.error(
            "❌ Could not fetch target message:",
            error
        );

        await interaction.editReply({
            content:
                "❌ Could not find the message to translate."
        });
        return;
    }

    if (
        !targetMessage.content ||
        !targetMessage.content.trim()
    ) {
        await interaction.editReply({
            content:
                "❌ This message has no text to translate."
        });
        return;
    }

    const result =
        await sendPrivateTranslation(
            interaction,
            targetMessage
        );

    if (result.error) {
        console.log(
            `❌ ${requesterLabel}'s button translate failed: ${result.error}`
        );

        await interaction.editReply({
            content: result.error
        });
        return;
    }

    await interaction.editReply({
        content: result.content
    });
}

// ============================================================
// AUTOMATIC TRANSLATION
// ============================================================

async function handleTranslation(message) {
    if (shouldIgnoreMessage(message)) {
        return;
    }

    const guild = message.guild;

    if (!guild) return;

    // Fetch member in case the message event doesn't have
    // all role information cached.
    let member = message.member;

    try {
        if (!member) {
            member =
                await guild.members.fetch(message.author.id);
        }
    } catch (error) {
        console.error(
            "Could not fetch member:",
            error
        );

        return;
    }

    // ========================================================
    // SOURCE LANGUAGE
    // ========================================================

    const authorLanguageCode =
        userLanguageCache.get(member.id) ||
        getMemberLanguageCode(member);

    if (!authorLanguageCode) {
        console.log(
            `ℹ️ ${member.user.username} has no language role ` +
            `in ${channelLabel(message.channel)}.`
        );

        return;
    }

    const sourceLanguage =
        getLanguageName(authorLanguageCode);

    // ========================================================
    // FIND TARGET LANGUAGES (smart detection)
    // ========================================================

    const languagesPresent =
        await determineTargetLanguages(
            message,
            authorLanguageCode,
            guild
        );

    if (languagesPresent.size === 0) {
        console.log(
            `ℹ️ No other language groups need translation ` +
            `for ${member.user.username} in ${channelLabel(message.channel)}.`
        );

        return;
    }

    const authorLabel =
        userLabel(message.author, member);

    console.log(
        `🌐 ${authorLabel} wrote in ${sourceLanguage} ` +
        `in ${channelLabel(message.channel)}: ` +
        `"${previewText(message.content)}"`
    );

    console.log(
        `➡️ Translating to:`,
        [...languagesPresent]
            .map(getLanguageName)
            .join(", ")
    );

    // ========================================================
    // TRANSLATE
    // ========================================================

    const translations = [];

    for (const targetLanguageCode of languagesPresent) {
        const targetLanguage =
            getLanguageName(targetLanguageCode);

        try {
            const translated =
                await translateText(
                    message.content,
                    sourceLanguage,
                    targetLanguage,
                    `auto ${authorLabel} in ${channelLabel(message.channel)}`
                );

            if (
                !translated ||
                translated.trim() ===
                    message.content.trim()
            ) {
                continue;
            }

            translations.push({
                code: targetLanguageCode,
                name: targetLanguage,
                text: translated
            });

            await sleep(250);

        } catch (error) {
            console.error(
                `❌ Translation failed for ${authorLabel}: ${sourceLanguage} -> ${targetLanguage}`,
                error
            );
        }
    }

    if (translations.length === 0) {
        return;
    }

    const translationLines = translations
        .map(t => `**${t.code}:** ${t.text}`)
        .join("\n\n");

    const sourceEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("\u200B")
        .setThumbnail(message.author.displayAvatarURL())
        .setDescription(
            `**${message.author.username}**\n` +
            message.content +
            `\n\n*${sourceLanguage}*`
        );

    const translatedEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("\u200B")
        .setDescription(translationLines);

    try {
        const sent =
            await message.channel.send({
                embeds: [sourceEmbed, translatedEmbed],
                allowedMentions: {
                    parse: []
                }
            });

        botMessageIds.add(sent.id);

        setTimeout(() => {
            botMessageIds.delete(sent.id);
        }, 10 * 60 * 1000);

        console.log(
            `✅ Auto-translation posted in ${channelLabel(message.channel)} ` +
            `for ${authorLabel} (${sourceLanguage} -> ` +
            `${translations.map(t => t.name).join(", ")}): ` +
            `"${previewText(message.content)}"`
        );

    } catch (error) {
        console.error(
            "❌ Could not send translation:",
            error
        );
    }
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

    new SlashCommandBuilder()
        .setName("language")
        .setDescription(
            "Show your current language role."
        ),

    new SlashCommandBuilder()
        .setName("translate")
        .setDescription(
            "Manually translate text."
        )
        .addStringOption(option =>
            option
                .setName("language")
                .setDescription(
                    "Target language code, e.g. RU"
                )
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription(
                    "Text to translate"
                )
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("reload")
        .setDescription(
            "Reload member language roles."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        ),

    new SlashCommandBuilder()
        .setName("translation-status")
        .setDescription(
            "Show translator status."
        ),

    new SlashCommandBuilder()
        .setName("backfill-forums")
        .setDescription(
            "Add translate buttons to existing forum posts."
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild
        )
        .addBooleanOption(option =>
            option
                .setName("include_archived")
                .setDescription(
                    "Also backfill archived posts (un-archives them)."
                )
                .setRequired(false)
        ),

    new ContextMenuCommandBuilder()
        .setName("🌐 Translate")
        .setType(ApplicationCommandType.Message)
];

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
    const rest = new REST({
        version: "10"
    }).setToken(
        process.env.DISCORD_TOKEN
    );

    console.log("🔄 Registering slash commands...");

    await rest.put(
        Routes.applicationGuildCommands(
            process.env.CLIENT_ID,
            process.env.GUILD_ID
        ),
        {
            body: commands.map(command =>
                command.toJSON()
            )
        }
    );

    console.log("✅ Slash commands registered.");
}

// ============================================================
// COMMAND HANDLER
// ============================================================

discordClient.on(
    Events.InteractionCreate,
    async interaction => {

        // ====================================================
        // Message context-menu: "🌐 Translate"
        // ====================================================

        if (
            interaction.isMessageContextMenuCommand() &&
            interaction.commandName === "🌐 Translate"
        ) {
            await interaction.deferReply({ flags: 64 });

            const targetMessage =
                interaction.targetMessage;

            const requesterLabel =
                userLabel(interaction.user, interaction.member);

            console.log(
                `📋 ${requesterLabel} used 🌐 Translate on ` +
                `${targetMessage.author.username}'s message in ` +
                `${channelLabel(interaction.channel)}: ` +
                `"${previewText(targetMessage.content)}"`
            );

            if (
                !targetMessage.content ||
                !targetMessage.content.trim()
            ) {
                await interaction.editReply({
                    content:
                        "❌ This message has no text to translate."
                });
                return;
            }

            const result =
                await sendPrivateTranslation(
                    interaction,
                    targetMessage
                );

            if (result.error) {
                await interaction.editReply({
                    content: result.error
                });
                return;
            }

            await interaction.editReply({
                content: result.content
            });
            return;
        }

        if (!interaction.isChatInputCommand()) {
            return;
        }

        // ====================================================
        // /language
        // ====================================================

        if (interaction.commandName === "language") {

            const requesterLabel =
                userLabel(interaction.user, interaction.member);

            const languageCode =
                userLanguageCache.get(
                    interaction.user.id
                ) ||
                getMemberLanguageCode(
                    interaction.member
                );

            if (!languageCode) {

                console.log(
                    `⌨️ /language by ${requesterLabel}: no language role set`
                );

                await interaction.reply({
                    content:
                        "❌ You don't currently have a supported language role.",
                    flags: 64
                });

                return;
            }

            console.log(
                `⌨️ /language by ${requesterLabel}: ` +
                `${languageCode} (${getLanguageName(languageCode)})`
            );

            await interaction.reply({
                content:
                    `🌐 Your language is **${languageCode} — ${getLanguageName(languageCode)}**.`,
                flags: 64
            });

            return;
        }

        // ====================================================
        // /translate
        // ====================================================

        if (interaction.commandName === "translate") {

            const requesterLabel =
                userLabel(interaction.user, interaction.member);

            const languageCode =
                interaction.options
                    .getString("language")
                    .toUpperCase();

            const text =
                interaction.options
                    .getString("text");

            if (
                !CONFIG.LANGUAGE_NAMES[
                    languageCode
                ]
            ) {
                console.log(
                    `⌨️ /translate by ${requesterLabel}: unsupported language "${languageCode}"`
                );

                await interaction.reply({
                    content:
                        `❌ Unsupported language code: \`${languageCode}\`\n\n` +
                        `Supported: ${Object.keys(
                            CONFIG.LANGUAGE_NAMES
                        ).join(", ")}`,
                    flags: 64
                });

                return;
            }

            await interaction.deferReply({
                flags: 64
            });

            try {

                const translated =
                    await translateText(
                        text,
                        "the detected source language",
                        getLanguageName(
                            languageCode
                        ),
                        `slash by ${requesterLabel}`
                    );

                console.log(
                    `⌨️ /translate by ${requesterLabel} -> ${languageCode}: ` +
                    `"${previewText(text)}"`
                );

                await interaction.editReply({
                    content:
                        `🌐 **${languageCode} — ${getLanguageName(languageCode)}**\n${translated}`
                });

            } catch (error) {

                console.error(
                    `❌ /translate failed for ${requesterLabel} -> ${languageCode}:`,
                    error.message || error
                );

                await interaction.editReply({
                    content:
                        "❌ Translation failed. Check the bot console."
                });
            }

            return;
        }

        // ====================================================
        // /reload
        // ====================================================

        if (interaction.commandName === "reload") {

            if (
                !interaction.memberPermissions
                    ?.has(
                        PermissionFlagsBits.ManageGuild
                    )
            ) {
                await interaction.reply({
                    content:
                        "❌ You need Manage Server permission.",
                    flags: 64
                });

                return;
            }

            try {
                await interaction.guild.members.fetch();

                rebuildLanguageCache(
                    interaction.guild
                );

                console.log(
                    `🔄 /reload by ${userLabel(interaction.user, interaction.member)}: ` +
                    `cache rebuilt (${userLanguageCache.size} members)`
                );

                await interaction.reply({
                    content:
                        `✅ Language cache rebuilt.\n` +
                        `Members with language roles: **${userLanguageCache.size}**`,
                    flags: 64
                });

            } catch (error) {

                console.error(error);

                await interaction.reply({
                    content:
                        "❌ Failed to reload member data.",
                    flags: 64
                });
            }

            return;
        }

        // ====================================================
        // /translation-status
        // ====================================================

        if (
            interaction.commandName ===
            "translation-status"
        ) {

            const languages =
                getLanguagesPresentInGuild(
                    interaction.guild
                );

            const channelList =
                CONFIG.TRANSLATION_CHANNELS
                    .map(id => `<#${id}>`)
                    .join(", ");

            const restrictedList =
                CONFIG.RESTRICTED_CHANNELS
                    .map(id => `<#${id}>`)
                    .join(", ");

            const publicList =
                CONFIG.PUBLIC_CHAT_CHANNELS
                    .map(id => `<#${id}>`)
                    .join(", ");

            const translationCategoryList =
                CONFIG.TRANSLATION_CATEGORIES
                    .map(id => `<#${id}>`)
                    .join(", ");

            const restrictedCategoryList =
                CONFIG.RESTRICTED_CATEGORIES
                    .map(id => `<#${id}>`)
                    .join(", ");

            const publicCategoryList =
                CONFIG.PUBLIC_CHAT_CATEGORIES
                    .map(id => `<#${id}>`)
                    .join(", ");

            await interaction.reply({
                content:
                    `🐦‍🔥 **973 Translator Status**\n\n` +
                    `Model: \`${CONFIG.GEMINI_MODEL}\`\n` +
                    `API Keys: **${geminiApiKeys.length}**\n` +
                    `Members cached: **${userLanguageCache.size}**\n` +
                    `Languages present: **${
                        [...languages]
                            .map(
                                code =>
                                    `${code} (${getLanguageName(code)})`
                            )
                            .join(", ") ||
                        "None"
                    }**\n` +
                    `Translation channels: ${channelList || "None"}\n` +
                    `Translation categories: ${translationCategoryList || "None"}\n` +
                    `Restricted channels: ${restrictedList || "None"}\n` +
                    `Restricted categories: ${restrictedCategoryList || "None"}\n` +
                    `Public chat channels: ${publicList || "None"}\n` +
                    `Public chat categories: ${publicCategoryList || "None"}\n` +
                    `Translation cache: **${translationCache.size}**`,
                flags: 64
            });

            return;
        }

        // ====================================================
        // /backfill-forums
        // ====================================================

        if (interaction.commandName === "backfill-forums") {

            if (
                !interaction.memberPermissions
                    ?.has(
                        PermissionFlagsBits.ManageGuild
                    )
            ) {
                await interaction.reply({
                    content:
                        "❌ You need Manage Server permission.",
                    flags: 64
                });

                return;
            }

            await interaction.deferReply({ flags: 64 });

            try {
                const includeArchived =
                    interaction.options.getBoolean(
                        "include_archived"
                    ) || false;

                // Make sure every channel is cached.
                await interaction.guild.channels.fetch();

                const summary = await backfillForumPosts(
                    interaction.guild,
                    includeArchived
                );

                console.log(
                    `🧵 /backfill-forums by ${userLabel(interaction.user, interaction.member)}: ` +
                    `${summary.added} added, ${summary.skipped} skipped ` +
                    `across ${summary.posts} posts in ${summary.forums} forums`
                );

                await interaction.editReply({
                    content:
                        `✅ Forum backfill complete.\n` +
                        `Forums scanned: **${summary.forums}**\n` +
                        `Posts scanned: **${summary.posts}**\n` +
                        `Buttons added: **${summary.added}**\n` +
                        `Skipped (already had button / no text): **${summary.skipped}**` +
                        (includeArchived
                            ? ""
                            : `\n\n_Archived posts were skipped. Re-run with \`include_archived: true\` to include them._`)
                });

            } catch (error) {

                console.error(
                    "❌ /backfill-forums failed:",
                    error
                );

                await interaction.editReply({
                    content:
                        "❌ Backfill failed. Check the logs."
                });
            }

            return;
        }
    }
);

// ============================================================
// VERIFICATION SYSTEM
// ============================================================

const IMAGE_EXTENSIONS = [
    ".png", ".jpg", ".jpeg", ".gif", ".webp"
];

// userId -> Set of pending verification message IDs
const pendingVerifications = new Map();

// user IDs that already received the verification DM reminder
const verificationDmSent = new Set();

// original message ID -> bot translate reply message
const translateReplies = new Map();

function hasImageAttachment(message) {
    if (!message.attachments || message.attachments.size === 0) {
        return false;
    }

    for (const [, attachment] of message.attachments) {
        const name =
            (attachment.name || "").toLowerCase();

        if (
            IMAGE_EXTENSIONS.some(ext => name.endsWith(ext))
        ) {
            return true;
        }

        if (
            attachment.contentType &&
            attachment.contentType.startsWith("image/")
        ) {
            return true;
        }
    }

    return false;
}

function hasLeadershipRole(member) {
    if (
        !CONFIG.LEADERSHIP_ROLE_ID ||
        !member ||
        !member.roles
    ) {
        return false;
    }

    return member.roles.cache.has(
        CONFIG.LEADERSHIP_ROLE_ID
    );
}

/**
 * Send a private verification reminder DM to a member. The
 * message is translated into the member's selected language
 * and includes a button link to the verification channel.
 */
async function sendVerificationReminder(member) {
    const languageCode =
        userLanguageCache.get(member.id) ||
        getMemberLanguageCode(member);

    if (!languageCode) return null;

    const channelMention = CONFIG.VERIFICATION_CHANNEL_ID
        ? `<#${CONFIG.VERIFICATION_CHANNEL_ID}>`
        : "`#verification`";

    const baseText = [
        "# 🔔 Welcome to **Phoenix of War!** 🐦‍🔥",
        "",
        "Hey! Welcome to **PHW**. Before you can access the rest of the server, we just need to verify your in-game account.",
        "",
        "## 📸 How to Verify",
        "",
        `Please send a **screenshot of your in-game profile** in ${channelMention}.`,
        "",
        "Make sure your **name, server, and profile information** are visible so we can verify your account.",
        "",
        "Once you're verified, you'll get access to the rest of the server. ❤️",
        "",
        "**Thanks for joining Phoenix of War, and welcome!** 🐦‍🔥"
    ].join("\n");

    let messageText = baseText;

    try {
        const result = await translateForMember(
            baseText,
            languageCode,
            `verification DM for ${member.user.username}`
        );

        if (result.needed && result.text) {
            messageText = result.text;
        }
    } catch (error) {
        console.error(
            "❌ Could not translate verification reminder:",
            error
        );
    }

    const channelUrl = CONFIG.VERIFICATION_CHANNEL_ID
        ? `https://discord.com/channels/${member.guild.id}/${CONFIG.VERIFICATION_CHANNEL_ID}`
        : null;

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel("Go to Verification")
                .setStyle(ButtonStyle.Link)
                .setURL(
                    channelUrl ||
                        "https://discord.com"
                )
        );

    try {
        await member.send({
            content: messageText,
            components: channelUrl ? [row] : []
        });

        console.log(
            `📩 Verification DM sent to ` +
            `${userLabel(member.user, member)} (${languageCode})`
        );

        return languageCode;
    } catch (error) {
        console.error(
            `❌ Could not DM verification reminder to ${member.user.username}:`,
            error
        );
        return null;
    }
}

async function handleVerification(message) {
    if (
        !CONFIG.VERIFICATION_CHANNEL_ID ||
        message.channel.id !== CONFIG.VERIFICATION_CHANNEL_ID
    ) {
        return false;
    }

    if (!message.author) return true;
    if (!hasImageAttachment(message)) return true;

    const verifyButton = new ButtonBuilder()
        .setCustomId(`verify_approve_${message.id}`)
        .setLabel("Verify")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success);

    const cancelButton = new ButtonBuilder()
        .setCustomId(`verify_cancel_${message.id}`)
        .setLabel("Cancel")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
        .addComponents(verifyButton, cancelButton);

    try {
        const sent = await message.reply({
            content:
                "Account screenshot submitted for verification.",
            allowedMentions: { parse: [] },
            components: [row]
        });

        // Track pending verification for this user.
        const userId = message.author.id;

        if (!pendingVerifications.has(userId)) {
            pendingVerifications.set(userId, new Set());
        }

        pendingVerifications.get(userId).add(sent.id);

        console.log(
            `📸 ${userLabel(message.author, message.member)} ` +
            `submitted a verification screenshot in ${channelLabel(message.channel)}`
        );

    } catch (error) {
        console.error(
            "❌ Could not attach verification buttons:",
            error
        );
    }

    return true;
}

// ============================================================
// BUTTON INTERACTION HANDLER
// ============================================================

discordClient.on(
    Events.InteractionCreate,
    async interaction => {
        if (!interaction.isButton()) return;

        const customId = interaction.customId;

        // ====================================================
        // PRIVATE TRANSLATE BUTTON
        // ====================================================

        if (customId.startsWith("translate_")) {
            await handleTranslateButton(interaction);
            return;
        }

        if (
            !customId.startsWith("verify_approve_") &&
            !customId.startsWith("verify_cancel_")
        ) {
            return;
        }

        // Only leadership can use these buttons.
        if (!hasLeadershipRole(interaction.member)) {
            console.log(
                `⛔ ${userLabel(interaction.user, interaction.member)} ` +
                `tried to use a verify button in ${channelLabel(interaction.channel)} ` +
                `(no leadership role)`
            );

            await interaction.reply({
                content:
                    "❌ Only leadership can use this button.",
                flags: 64
            });
            return;
        }

        const messageId = customId.replace(
            "verify_approve_",
            ""
        ).replace("verify_cancel_", "");

        const isApprove =
            customId.startsWith("verify_approve_");

        if (isApprove) {
            // Respond immediately to avoid timeout.
            await interaction.deferUpdate();

            // Find the original message author.
            try {
                const originalMessage =
                    await interaction.channel.messages.fetch(
                        messageId
                    );

                const targetUserId =
                    originalMessage.author.id;

                const targetMember =
                    await interaction.guild.members.fetch(
                        targetUserId
                    );

                // Assign verified role.
                if (
                    CONFIG.VERIFIED_ROLE_ID &&
                    !targetMember.roles.cache.has(
                        CONFIG.VERIFIED_ROLE_ID
                    )
                ) {
                    await targetMember.roles.add(
                        CONFIG.VERIFIED_ROLE_ID
                    );
                }

                // Update ALL pending embeds for this user.
                const pending =
                    pendingVerifications.get(
                        targetUserId
                    ) || new Set();

                for (const pendingMsgId of pending) {
                    try {
                        const msg =
                            await interaction.channel.messages.fetch(
                                pendingMsgId
                            );

                        const leaderName =
                            (interaction.member &&
                                interaction.member.displayName) ||
                            interaction.user.username;

                        await msg.edit({
                            content:
                                `✅ **Verified** by ${leaderName}`,
                            components: []
                        });
                    } catch {
                        // Message may have been deleted.
                    }
                }

                pendingVerifications.delete(
                    targetUserId
                );

                const leaderName =
                    (interaction.member &&
                        interaction.member.displayName) ||
                    interaction.user.username;

                console.log(
                    `✅ ${userLabel(targetMember.user, targetMember)} verified by ` +
                    `${leaderName} (${pending.size} screenshot(s))`
                );

            } catch (error) {
                console.error(
                    "❌ Verification failed:",
                    error.message || error
                );

                await interaction.followUp({
                    content:
                        `❌ Verify failed: ${error.message || "Unknown error"}`,
                    flags: 64
                });
            }
        } else {
            // Cancel: only this screenshot.
            pendingVerifications.forEach(
                (set, userId) => {
                    set.delete(messageId);

                    if (set.size === 0) {
                        pendingVerifications.delete(
                            userId
                        );
                    }
                }
            );

            const leaderName =
                (interaction.member &&
                    interaction.member.displayName) ||
                interaction.user.username;

            await interaction.update({
                content:
                    `❌ **Cancelled** by ${leaderName}`,
                components: []
            });

            console.log(
                `❌ Verification cancelled by ${leaderName} ` +
                `in ${channelLabel(interaction.channel)}`
            );
        }
    }
);

// ============================================================
// MESSAGE EVENT
// ============================================================

discordClient.on(
    Events.MessageCreate,
    async message => {

        try {
            // Verification channel takes priority.
            if (
                await handleVerification(
                    message
                )
            ) {
                return;
            }

            // Restricted channels take priority.
            if (
                await handleRestrictedChannel(
                    message
                )
            ) {
                return;
            }

            // Public chat channels next.
            if (
                await handlePublicChat(
                    message
                )
            ) {
                return;
            }

            // Normal translation channels: attach a private
            // translate button instead of posting translations.
            await attachTranslateButton(
                message
            );
        } catch (error) {

            console.error(
                "❌ Message translation error:",
                error
            );
        }
    }
);

// ============================================================
// MESSAGE DELETE EVENT
// ============================================================

discordClient.on(
    Events.MessageDelete,
    async message => {
        if (!message.id) return;

        const reply = translateReplies.get(
            message.id
        );

        if (!reply) return;

        try {
            await reply.delete();
        } catch (error) {
            console.error(
                "❌ Could not delete translate reply:",
                error
            );
        } finally {
            translateReplies.delete(message.id);
        }
    }
);

// ============================================================
// MEMBER EVENTS
// ============================================================

discordClient.on(
    Events.GuildMemberUpdate,
    async (oldMember, newMember) => {

        const oldLanguage =
            getMemberLanguageCode(oldMember);

        const newLanguage =
            getMemberLanguageCode(newMember);

        if (oldLanguage !== newLanguage) {

            if (newLanguage) {
                userLanguageCache.set(
                    newMember.id,
                    newLanguage
                );
            } else {
                userLanguageCache.delete(
                    newMember.id
                );
            }

            console.log(
                `🎭 Role change: ${userLabel(newMember.user, newMember)} ` +
                `language ${oldLanguage || "none"} -> ${newLanguage || "none"}`
            );

            // After onboarding (a language role was picked),
            // send the verification reminder DM if the member
            // still has the New Member role and is NOT yet
            // verified. Verified users also keep the New Member
            // role, so we must ensure they aren't verified.
            if (
                newLanguage &&
                CONFIG.NEW_MEMBER_ROLE_ID &&
                (
                    !CONFIG.VERIFIED_ROLE_ID ||
                    !newMember.roles.cache.has(
                        CONFIG.VERIFIED_ROLE_ID
                    )
                ) &&
                newMember.roles.cache.has(
                    CONFIG.NEW_MEMBER_ROLE_ID
                ) &&
                !verificationDmSent.has(newMember.id)
            ) {
                verificationDmSent.add(
                    newMember.id
                );

                try {
                    await sendVerificationReminder(
                        newMember
                    );
                } catch (error) {
                    console.error(
                        "❌ Verification reminder failed:",
                        error
                    );
                }
            }
        }
    }
);

discordClient.on(
    Events.GuildMemberRemove,
    member => {
        userLanguageCache.delete(
            member.id
        );
    }
);

// ============================================================
// READY
// ============================================================

discordClient.once(
    Events.ClientReady,
    async readyClient => {

        console.log("");
        console.log(
            "======================================"
        );
        console.log(
            "🐦‍🔥 973 TRANSLATOR ONLINE"
        );
        console.log(
            "======================================"
        );
        console.log(
            `Bot: ${readyClient.user.tag}`
        );
        console.log(
            `Guild: ${process.env.GUILD_ID}`
        );
        console.log(
            `Model: ${CONFIG.GEMINI_MODEL}`
        );
        console.log(
            `API Keys: ${geminiApiKeys.length} loaded`
        );
        console.log(
            `Channels: ${CONFIG.TRANSLATION_CHANNELS.join(", ")}`
        );

        try {
            await readyClient.user.setActivity(
                "We rise from the ashes",
                { type: ActivityType.Custom }
            );
        } catch (error) {
            console.error(
                "⚠️ Could not set activity:",
                error
            );
        }
        console.log(
            `Restricted: ${CONFIG.RESTRICTED_CHANNELS.join(", ") || "None"}`
        );
        console.log(
            `Public chat: ${CONFIG.PUBLIC_CHAT_CHANNELS.join(", ") || "None"}`
        );

        try {

            const guild =
                await readyClient.guilds.fetch(
                    process.env.GUILD_ID
                );

            await guild.members.fetch();

            rebuildLanguageCache(
                guild
            );

            await registerCommands();

            console.log(
                "✅ Initialization complete."
            );

        } catch (error) {

            console.error(
                "❌ Initialization failed:",
                error
            );
        }

        console.log("");
    }
);

// ============================================================
// ERROR HANDLERS
// ============================================================

discordClient.on(
    Events.Error,
    error => {
        console.error(
            "❌ Discord client error:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "❌ Unhandled promise rejection:",
            error
        );
    }
);

// ============================================================
// LOGIN
// ============================================================

console.log(
    "🚀 Starting 973 Translator..."
);

discordClient.login(
    process.env.DISCORD_TOKEN
);