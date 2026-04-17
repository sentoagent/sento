import inquirer from "inquirer";
import chalk from "chalk";

export async function collectConfig() {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "agentName",
      message: "Agent name:",
      default: "agent",
      validate: (v) =>
        /^[a-z0-9-]{2,20}$/.test(v) || "Lowercase letters, numbers, and hyphens only (2-20 chars)",
    },
    {
      type: "list",
      name: "channelType",
      message: "Messaging channel:",
      choices: [
        { name: "Discord", value: "discord" },
        { name: "Telegram", value: "telegram" },
        { name: "Slack", value: "slack" },
        { name: "iMessage (macOS only)", value: "imessage" },
      ],
    },
    {
      type: "password",
      name: "botToken",
      message: "Bot token:",
      suffix: chalk.dim(`\n  Discord: discord.com/developers/applications > New App > Bot > Reset Token\n  Required bot permissions: View Channels, Send Messages, Send Messages in Threads,\n  Read Message History, Attach Files, Add Reactions\n  Required intents: Message Content Intent, Server Members Intent\n  (Bot tab > Privileged Gateway Intents > enable both)`),
      mask: "*",
      validate: (v) => v.length > 10 || "Please paste your bot token",
      when: (a) => a.channelType === "discord",
    },
    {
      type: "password",
      name: "botToken",
      message: "Bot token:",
      suffix: chalk.dim(`\n  Telegram: message @BotFather > /newbot > copy the token`),
      mask: "*",
      validate: (v) => v.length > 10 || "Please paste your bot token",
      when: (a) => a.channelType === "telegram",
    },
    {
      type: "password",
      name: "botToken",
      message: "Bot token:",
      suffix: chalk.dim(`\n  Slack: api.slack.com/apps > Create App > OAuth > Bot User Token`),
      mask: "*",
      validate: (v) => v.length > 10 || "Please paste your bot token",
      when: (a) => a.channelType === "slack",
    },
    {
      type: "list",
      name: "discordScope",
      message: "Where should the bot respond?",
      when: (a) => a.channelType === "discord",
      choices: [
        { name: "All channels in a server", value: "server" },
        { name: "Specific channels only", value: "channels" },
      ],
    },
    {
      type: "input",
      name: "guildId",
      message: "Discord server ID:",
      suffix: chalk.dim(`\n  How to get: Discord > Settings > Advanced > turn on Developer Mode\n  Then right-click your server name (top left) > Copy Server ID\n  >`),
      when: (a) => a.discordScope === "server",
      validate: (v) => {
        if (!v.trim()) return "Please enter your Discord server ID";
        if (!/^\d+$/.test(v.trim())) return "Server ID should be numbers only. Right-click server name > Copy Server ID.";
        return true;
      },
      filter: (v) => v.trim(),
    },
    {
      type: "input",
      name: "channelIds",
      message: "Discord channel IDs (comma-separated):",
      suffix: chalk.dim(`\n  How to get: Discord > Settings > Advanced > turn on Developer Mode\n  Then right-click any channel > Copy Channel ID\n  >`),
      when: (a) => a.discordScope === "channels",
      validate: (v) => {
        const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0) return "Add at least one channel ID.";
        if (ids.some((id) => !/^\d+$/.test(id))) return "Channel IDs should be numbers only.";
        return true;
      },
      filter: (v) => v.split(",").map((s) => s.trim()).filter(Boolean),
    },
    {
      type: "confirm",
      name: "discordBotSetup",
      message: "Have you added the bot to your Discord server?",
      suffix: chalk.dim(`\n  If not: Discord Developer Portal > OAuth2 > URL Generator\n  Select "bot" scope, then copy the URL and open it to invite the bot\n  The bot will show offline until you launch the agent at the end\n  >`),
      when: (a) => a.channelType === "discord",
      default: true,
    },
    {
      type: "input",
      name: "telegramChatId",
      message: "Your Telegram chat ID (for Guardian alerts):",
      suffix: chalk.dim(`\n  How to get: message @userinfobot on Telegram, it replies with your ID\n  Guardian uses this to send you alerts when the agent goes down\n  >`),
      when: (a) => a.channelType === "telegram",
      validate: (v) => /^-?\d+$/.test(v.trim()) || "Should be a number (can be negative for groups)",
      filter: (v) => v.trim(),
    },
    {
      type: "input",
      name: "slackChannelId",
      message: "Slack channel ID for Guardian alerts:",
      suffix: chalk.dim(`\n  How to get: right-click a channel > View channel details > scroll to bottom\n  Guardian uses this to send you alerts when the agent goes down\n  >`),
      when: (a) => a.channelType === "slack",
      validate: (v) => v.trim().length > 0 || "Please enter a channel ID",
      filter: (v) => v.trim(),
    },
    {
      type: "password",
      name: "geminiKey",
      message: "Gemini API key (optional, press Enter to skip):",
      suffix: chalk.dim(`\n  For memory embeddings (vector search). Free at aistudio.google.com\n  Without it: keyword search only (still works fine)\n  >`),
      mask: "*",
    },
    {
      type: "input",
      name: "role",
      message: "Agent role (e.g. your bro, marketing assistant, coding buddy):",
      default: "General-purpose assistant",
    },
    {
      type: "input",
      name: "personality",
      message: "Agent personality (e.g. chill and funny, straight to the point):",
      default: "Chill, helpful, keeps it real",
    },
    {
      type: "list",
      name: "language",
      message: "Agent language:",
      choices: [
        { name: "English", value: "English" },
        { name: "Spanish", value: "Spanish" },
        { name: "Chinese", value: "Chinese" },
        { name: "Japanese", value: "Japanese" },
        { name: "Other (type manually)", value: "__other" },
      ],
    },
    {
      type: "input",
      name: "languageCustom",
      message: "Enter language:",
      when: (a) => a.language === "__other",
      validate: (v) => v.trim().length > 0 || "Please enter a language",
    },
    {
      type: "input",
      name: "creatorName",
      message: "Your name (the agent's owner):",
      default: "John Smith",
      validate: (v) => v.trim().length > 0 || "Please enter your name",
    },
    {
      type: "list",
      name: "timezone",
      message: "Your timezone:",
      choices: [
        new inquirer.Separator("── Americas ──"),
        { name: "US Eastern (New York, Miami)", value: "America/New_York" },
        { name: "US Central (Chicago, Dallas)", value: "America/Chicago" },
        { name: "US Mountain (Denver, Phoenix)", value: "America/Denver" },
        { name: "US Pacific (Los Angeles, Seattle)", value: "America/Los_Angeles" },
        { name: "US Alaska", value: "America/Anchorage" },
        { name: "US Hawaii", value: "Pacific/Honolulu" },
        { name: "Canada Atlantic (Halifax)", value: "America/Halifax" },
        { name: "Mexico City", value: "America/Mexico_City" },
        { name: "Colombia (Bogota)", value: "America/Bogota" },
        { name: "Peru (Lima)", value: "America/Lima" },
        { name: "Chile (Santiago)", value: "America/Santiago" },
        { name: "Argentina (Buenos Aires)", value: "America/Argentina/Buenos_Aires" },
        { name: "Brazil (Sao Paulo)", value: "America/Sao_Paulo" },
        { name: "Venezuela (Caracas)", value: "America/Caracas" },
        new inquirer.Separator("── Europe ──"),
        { name: "UK / Ireland (London, Dublin)", value: "Europe/London" },
        { name: "Central Europe (Paris, Berlin, Madrid)", value: "Europe/Paris" },
        { name: "Eastern Europe (Bucharest, Athens)", value: "Europe/Bucharest" },
        { name: "Turkey (Istanbul)", value: "Europe/Istanbul" },
        { name: "Moscow", value: "Europe/Moscow" },
        new inquirer.Separator("── Africa ──"),
        { name: "West Africa (Lagos, Accra)", value: "Africa/Lagos" },
        { name: "East Africa (Nairobi, Addis Ababa)", value: "Africa/Nairobi" },
        { name: "South Africa (Johannesburg)", value: "Africa/Johannesburg" },
        { name: "Egypt (Cairo)", value: "Africa/Cairo" },
        new inquirer.Separator("── Asia ──"),
        { name: "UAE (Dubai)", value: "Asia/Dubai" },
        { name: "India (Mumbai, Delhi)", value: "Asia/Kolkata" },
        { name: "Bangladesh (Dhaka)", value: "Asia/Dhaka" },
        { name: "Thailand (Bangkok)", value: "Asia/Bangkok" },
        { name: "Singapore / Malaysia", value: "Asia/Singapore" },
        { name: "China (Shanghai, Beijing)", value: "Asia/Shanghai" },
        { name: "Hong Kong", value: "Asia/Hong_Kong" },
        { name: "Japan (Tokyo)", value: "Asia/Tokyo" },
        { name: "Korea (Seoul)", value: "Asia/Seoul" },
        { name: "Philippines (Manila)", value: "Asia/Manila" },
        { name: "Indonesia (Jakarta)", value: "Asia/Jakarta" },
        { name: "Pakistan (Karachi)", value: "Asia/Karachi" },
        { name: "Israel (Jerusalem)", value: "Asia/Jerusalem" },
        { name: "Saudi Arabia (Riyadh)", value: "Asia/Riyadh" },
        new inquirer.Separator("── Oceania ──"),
        { name: "Australia Eastern (Sydney, Melbourne)", value: "Australia/Sydney" },
        { name: "Australia Central (Adelaide)", value: "Australia/Adelaide" },
        { name: "Australia Western (Perth)", value: "Australia/Perth" },
        { name: "New Zealand (Auckland)", value: "Pacific/Auckland" },
        new inquirer.Separator("────────────"),
        { name: "Other (type manually)", value: "__other" },
      ],
    },
    {
      type: "input",
      name: "timezoneCustom",
      message: "Enter IANA timezone (e.g. Asia/Taipei):",
      when: (a) => a.timezone === "__other",
      validate: (v) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: v });
          return true;
        } catch {
          return "Invalid timezone. Use IANA format like America/New_York or Asia/Tokyo. Full list: en.wikipedia.org/wiki/List_of_tz_database_time_zones";
        }
      },
    },
  ]);

  // Resolve custom values
  if (answers.timezoneCustom) {
    answers.timezone = answers.timezoneCustom;
  }
  if (answers.languageCustom) {
    answers.language = answers.languageCustom;
  }

  return answers;
}

export async function confirmConfig(config) {
  console.log("");
  console.log(chalk.bold("  Summary:"));
  console.log(`  Agent:       ${config.agentName}`);
  console.log(`  Channel:     ${config.channelType}`);
  console.log(`  Role:        ${config.role}`);
  console.log(`  Personality: ${config.personality}`);
  console.log(`  Language:    ${config.language}`);
  console.log(`  Creator:     ${config.creatorName}`);
  console.log(`  Timezone:    ${config.timezone}`);
  console.log(`  Gemini:      ${config.geminiKey ? "Yes" : "No (keyword search only)"}`);
  console.log("");

  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: "Proceed with setup?",
      default: true,
    },
  ]);

  return proceed;
}
