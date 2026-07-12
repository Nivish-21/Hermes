import "dotenv/config";
import { pollTelegramUpdates, registerTelegramCommands } from "../src/channels/telegram.js";

const POLL_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 1_000;

let stopping = false;

function stop(): void {
  stopping = true;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main(): Promise<void> {
  let offset: number | undefined;
  await registerTelegramCommands();
  console.log("Switchboard Telegram commands registered");
  console.log("Switchboard Telegram runner started");

  while (!stopping) {
    try {
      const { nextOffset, runs } = await pollTelegramUpdates(offset, POLL_TIMEOUT_SECONDS);
      offset = nextOffset;
      for (const run of runs) {
        console.log(JSON.stringify({
          runId: run.request.runId,
          requestId: run.request.id,
          taskId: run.result.taskId,
          status: run.result.status,
        }));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown Telegram polling failure";
      console.error("Telegram polling failed", { message });
      await delay(RETRY_DELAY_MS);
    }
  }

  console.log("Switchboard Telegram runner stopped");
}

void main();
