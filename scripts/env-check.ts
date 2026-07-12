import "dotenv/config";

type EnvironmentRequirement = {
  name: string;
  requiredFor: "core" | "research" | "messaging" | "booking" | "publish" | "dashboard" | "deployment";
  required: boolean;
};

const requirements: EnvironmentRequirement[] = [
  { name: "OPENAI_API_KEY", requiredFor: "core", required: true },
  { name: "MANAGER_MODEL_ID", requiredFor: "core", required: true },
  { name: "CHEAP_MODEL_ID", requiredFor: "core", required: false },
  { name: "SWITCHBOARD_MAX_USD_PER_RUN", requiredFor: "core", required: true },
  { name: "SWITCHBOARD_ESTIMATED_MODEL_CALL_USD", requiredFor: "core", required: true },
  { name: "CONVEX_URL", requiredFor: "core", required: true },
  { name: "TRACE_INGEST_KEY", requiredFor: "core", required: true },
  { name: "TELEGRAM_BOT_TOKEN", requiredFor: "messaging", required: true },
  { name: "TELEGRAM_ALLOWED_USERS", requiredFor: "messaging", required: true },
  { name: "ALLOWED_CHANNEL_ID", requiredFor: "messaging", required: true },
  { name: "LINKUP_API_KEY", requiredFor: "research", required: true },
  { name: "CALCOM_API_KEY", requiredFor: "booking", required: true },
  { name: "CALCOM_EVENT_TYPE_ID", requiredFor: "booking", required: true },
  { name: "CALCOM_TIME_ZONE", requiredFor: "booking", required: true },
  { name: "CALCOM_ATTENDEE_NAME", requiredFor: "booking", required: true },
  { name: "CALCOM_ATTENDEE_EMAIL", requiredFor: "booking", required: true },
  { name: "VITE_CONVEX_URL", requiredFor: "dashboard", required: true },
  { name: "DASHBOARD_URL", requiredFor: "dashboard", required: false },
  { name: "FRONTIER_INPUT_USD_PER_MILLION_TOKENS", requiredFor: "dashboard", required: false },
  { name: "FRONTIER_OUTPUT_USD_PER_MILLION_TOKENS", requiredFor: "dashboard", required: false },
  { name: "CLOUDFLARE_API_TOKEN", requiredFor: "publish", required: true },
  { name: "CLOUDFLARE_ACCOUNT_ID", requiredFor: "publish", required: true },
  { name: "CLOUDFLARE_KV_NAMESPACE_ID", requiredFor: "publish", required: true },
  { name: "CLOUDFLARE_PUBLISH_KEY", requiredFor: "publish", required: true },
  { name: "CLOUDFLARE_PUBLISH_LIVE_URL", requiredFor: "publish", required: true },
];

function isConfigured(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") {
    return false;
  }
  return !/^(your_|confirmed_|generate_|configure_)/.test(value.trim());
}

const missing = requirements.filter((requirement) => requirement.required && !isConfigured(process.env[requirement.name]));
const optional = requirements.filter((requirement) => !requirement.required && !isConfigured(process.env[requirement.name]));
const invalid: string[] = [];
const maxRunCost = Number(process.env.SWITCHBOARD_MAX_USD_PER_RUN);
const estimatedCallCost = Number(process.env.SWITCHBOARD_ESTIMATED_MODEL_CALL_USD);
const allowedUsers = (process.env.TELEGRAM_ALLOWED_USERS ?? "").split(",").map((value) => value.trim()).filter((value) => value !== "");

if (Number.isFinite(maxRunCost) && Number.isFinite(estimatedCallCost) && maxRunCost < estimatedCallCost * 2) {
  invalid.push("SWITCHBOARD_MAX_USD_PER_RUN must cover at least the route and review calls");
}
if (isConfigured(process.env.CONVEX_URL) && isConfigured(process.env.VITE_CONVEX_URL) && process.env.CONVEX_URL !== process.env.VITE_CONVEX_URL) {
  invalid.push("CONVEX_URL and VITE_CONVEX_URL must match");
}
if (allowedUsers.length > 0 && !allowedUsers.every((value) => /^\d+$/.test(value))) {
  invalid.push("TELEGRAM_ALLOWED_USERS must contain comma-separated numeric Telegram user IDs");
}
if (isConfigured(process.env.ALLOWED_CHANNEL_ID) && !/^-?\d+$/.test(process.env.ALLOWED_CHANNEL_ID ?? "")) {
  invalid.push("ALLOWED_CHANNEL_ID must be a numeric Telegram chat or channel ID");
}
if (isConfigured(process.env.CALCOM_EVENT_TYPE_ID) && !/^[1-9]\d*$/.test(process.env.CALCOM_EVENT_TYPE_ID ?? "")) {
  invalid.push("CALCOM_EVENT_TYPE_ID must be a positive integer");
}
if (isConfigured(process.env.CALCOM_ATTENDEE_EMAIL) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(process.env.CALCOM_ATTENDEE_EMAIL ?? "")) {
  invalid.push("CALCOM_ATTENDEE_EMAIL must be an email address");
}
if (isConfigured(process.env.CLOUDFLARE_PUBLISH_KEY) && Buffer.byteLength(process.env.CLOUDFLARE_PUBLISH_KEY ?? "", "utf8") > 512) {
  invalid.push("CLOUDFLARE_PUBLISH_KEY must not exceed 512 bytes");
}
if (isConfigured(process.env.CLOUDFLARE_PUBLISH_LIVE_URL)) {
  try {
    if (new URL(process.env.CLOUDFLARE_PUBLISH_LIVE_URL ?? "").protocol !== "https:") {
      invalid.push("CLOUDFLARE_PUBLISH_LIVE_URL must use HTTPS");
    }
  } catch {
    invalid.push("CLOUDFLARE_PUBLISH_LIVE_URL must be a valid URL");
  }
}

if (missing.length > 0) {
  console.error("Missing required environment configuration:");
  for (const requirement of missing) {
    console.error(`- ${requirement.name} (${requirement.requiredFor})`);
  }
}

if (optional.length > 0) {
  console.log("Optional configuration not set:");
  for (const requirement of optional) {
    console.log(`- ${requirement.name} (${requirement.requiredFor})`);
  }
}

if (invalid.length > 0) {
  console.error("Invalid environment configuration:");
  for (const message of invalid) {
    console.error(`- ${message}`);
  }
}

if (missing.length > 0 || invalid.length > 0) {
  process.exitCode = 1;
} else {
  console.log("Required Switchboard environment configuration is present.");
}
