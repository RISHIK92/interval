// Next calls register() once at server start, and bundles this file for the Edge
// runtime too. Only the dotted `process.env.NEXT_RUNTIME` is replaced at build time, so
// the Edge bundle drops the Node-only module below entirely; anything Node-only here
// would otherwise break that bundle and turn every dev edit into a full page reload.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    registerNode();
  }
}
