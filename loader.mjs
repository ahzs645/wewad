import { resolve as pathResolve, dirname, extname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  // Only handle relative imports that lack an extension
  if (specifier.startsWith(".") && !extname(specifier)) {
    const parentPath = context.parentURL
      ? fileURLToPath(context.parentURL)
      : process.cwd();
    const parentDir = dirname(parentPath);
    // Try .js extension
    const candidate = pathResolve(parentDir, specifier + ".js");
    if (existsSync(candidate)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidate).href,
      };
    }
    // Try index.js inside directory
    const indexCandidate = pathResolve(parentDir, specifier, "index.js");
    if (existsSync(indexCandidate)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(indexCandidate).href,
      };
    }
  }
  return nextResolve(specifier, context);
}
