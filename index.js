require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const { GoogleGenAI } = require("@google/genai");

// ============================================================
// CONFIGURATION
// ============================================================

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
        DE: "🌐 DE"
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
        DE: "German"
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
        DE: "🇩🇪"
    },

    // Channels where automatic translation is enabled.
    TRANSLATION_CHANNELS: [
        process.env.GENERAL_CHANNEL_ID,
        process.env.PINGS_CHANNEL_ID
    ].filter(Boolean),

    // Role that indicates the member is verified.
    //
    // If you want translation BEFORE verification,
    // leave this empty in .env.
    VERIFIED_ROLE_ID: process.env.VERIFIED_ROLE_ID || "",

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
        `🌐 Language cache rebuilt: ${userLanguageCache.size} members`
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
    if (!CONFIG.TRANSLATION_CHANNELS.includes(message.channel.id)) {
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
 * Translate text using Gemini.
 */
async function translateText(
    text,
    sourceLanguage,
    targetLanguage
) {
    const cacheKey =
        `${sourceLanguage}|${targetLanguage}|${text}`;

    if (translationCache.has(cacheKey)) {
        console.log(
            `💾 Cache hit: ${sourceLanguage} -> ${targetLanguage}`
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

    } catch (error) {
        console.error(
            "❌ Could not send translation:",
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
                        `💬 Reply detected → translating to ${targetLang}`
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
                    `💬 Reply to ${repliedMessage.author.username} → translating to ${repliedLang}`
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
                        `📡 Context from recent message → translating to ${targetLang}`
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
            `ℹ️ ${member.user.username} has no language role.`
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
            "ℹ️ No other language groups need translation."
        );

        return;
    }

    console.log(
        `🌐 ${member.user.username} (${sourceLanguage})`
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

    for (const targetLanguageCode of languagesPresent) {
        const targetLanguage =
            getLanguageName(targetLanguageCode);

        try {
            const translated =
                await translateText(
                    message.content,
                    sourceLanguage,
                    targetLanguage
                );

            if (
                !translated ||
                translated.trim() ===
                    message.content.trim()
            ) {
                continue;
            }

            await sendTranslation(
                message,
                targetLanguageCode,
                translated,
                authorLanguageCode
            );

            // Small delay so multiple translations
            // don't hit Discord simultaneously.
            await sleep(250);

        } catch (error) {
            console.error(
                `❌ Translation failed: ${sourceLanguage} -> ${targetLanguage}`,
                error
            );
        }
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
        )
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

        if (!interaction.isChatInputCommand()) {
            return;
        }

        // ====================================================
        // /language
        // ====================================================

        if (interaction.commandName === "language") {

            const languageCode =
                userLanguageCache.get(
                    interaction.user.id
                ) ||
                getMemberLanguageCode(
                    interaction.member
                );

            if (!languageCode) {

                await interaction.reply({
                    content:
                        "❌ You don't currently have a supported language role.",
                    ephemeral: true
                });

                return;
            }

            await interaction.reply({
                content:
                    `🌐 Your language is **${languageCode} — ${getLanguageName(languageCode)}**.`,
                ephemeral: true
            });

            return;
        }

        // ====================================================
        // /translate
        // ====================================================

        if (interaction.commandName === "translate") {

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
                await interaction.reply({
                    content:
                        `❌ Unsupported language code: \`${languageCode}\`\n\n` +
                        `Supported: ${Object.keys(
                            CONFIG.LANGUAGE_NAMES
                        ).join(", ")}`,
                    ephemeral: true
                });

                return;
            }

            await interaction.deferReply({
                ephemeral: true
            });

            try {

                const translated =
                    await translateText(
                        text,
                        "the detected source language",
                        getLanguageName(
                            languageCode
                        )
                    );

                await interaction.editReply({
                    content:
                        `🌐 **${languageCode} — ${getLanguageName(languageCode)}**\n${translated}`
                });

            } catch (error) {

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
                    ephemeral: true
                });

                return;
            }

            try {
                await interaction.guild.members.fetch();

                rebuildLanguageCache(
                    interaction.guild
                );

                await interaction.reply({
                    content:
                        `✅ Language cache rebuilt.\n` +
                        `Members with language roles: **${userLanguageCache.size}**`,
                    ephemeral: true
                });

            } catch (error) {

                console.error(error);

                await interaction.reply({
                    content:
                        "❌ Failed to reload member data.",
                    ephemeral: true
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

            await interaction.reply({
                content:
                    `🐦‍🔥 **973 Translator Status**\n\n` +
                    `Model: \`${CONFIG.GEMINI_MODEL}\`\n` +
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
                    `Translation cache: **${translationCache.size}**`,
                ephemeral: true
            });

            return;
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
            await handleTranslation(
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
// MEMBER EVENTS
// ============================================================

discordClient.on(
    Events.GuildMemberUpdate,
    (oldMember, newMember) => {

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
                `🌐 ${newMember.user.username}: ` +
                `${oldLanguage || "none"} -> ${
                    newLanguage || "none"
                }`
            );
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