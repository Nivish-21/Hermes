/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as dashboard from "../dashboard.js";
import type * as ingest from "../ingest.js";
import type * as operator from "../operator.js";
import type * as requesterActivity from "../requesterActivity.js";
import type * as requests from "../requests.js";
import type * as tasks from "../tasks.js";
import type * as telegramUpdates from "../telegramUpdates.js";
import type * as trace from "../trace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  dashboard: typeof dashboard;
  ingest: typeof ingest;
  operator: typeof operator;
  requesterActivity: typeof requesterActivity;
  requests: typeof requests;
  tasks: typeof tasks;
  telegramUpdates: typeof telegramUpdates;
  trace: typeof trace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
