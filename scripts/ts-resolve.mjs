// Lets a script under Node's type stripping import modules whose relative imports leave
// off ".ts" (the bundler adds it in the apps): apps/web/src, and packages/lld's verify
// (P5-W30-S01). Standard library only.
import { register } from "node:module";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try {
        return await next(specifier, context);
      } catch (error) {
        if (!specifier.startsWith(".") || /\\.[cm]?[jt]sx?$/.test(specifier)) throw error;
        for (const suffix of [".ts", ".tsx", "/index.ts"]) {
          try {
            return await next(specifier + suffix, context);
          } catch {}
        }
        throw error;
      }
    }
  `)}`,
);
