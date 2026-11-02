// Lets a script under Node's type stripping import apps/web/src modules, whose relative
// imports leave off ".ts" (the bundler adds it in the app). Standard library only.
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
