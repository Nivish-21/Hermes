import "dotenv/config";

type EnvironmentRequirement = {
  name: string;
  requiredFor: "core" | "research" | "messaging" | "dashboard" | "deployment";
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
  { name: "VITE_CONVEX_URL", requiredFor: "dashboard", required: true },
  { name: "FRONTIER_INPUT_USD_PER_MILLION_TOKENS", requiredFor: "dashboard", required: false },
  { name: "FRONTIER_OUTPUT_USD_PER_MILLION_TOKENS", requiredFor: "dashboard", required: false },
  { name: "CLOUDFLARE_API_TOKEN", requiredFor: "deployment", required: false },
  { name: "CLOUDFLARE_ACCOUNT_ID", requiredFor: "deployment", required: false },
];

function isConfigured(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") {
    return false;
  }
  return !/^(your_|confirmed_|generate_|configure_)/.test(value.trim());
}

const missing = requirements.filter((requirement) => requirement.required && !isConfigured(process.env[requirement.name]));
const optional = requirements.filter((requirement) => !requirement.required && !isConfigured(process.env[requirement.name]));

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

if (missing.length > 0) {
  process.exitCode = 1;
} else {
  console.log("Required Switchboard environment configuration is present.");
}
