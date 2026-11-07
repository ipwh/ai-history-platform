import fs from "node:fs";
import path from "node:path";

export interface ReleaseGateEvidenceOutput {
  jsonPath: string;
  jsonContent: string;
  markdownPath: string;
  markdownContent: string;
}

/**
 * Writes a JSON/Markdown report pair as UTF-8 and never replaces existing evidence.
 */
export function writeReleaseGateEvidence(output: ReleaseGateEvidenceOutput): void {
  const files = [
    { path: path.resolve(output.jsonPath), content: output.jsonContent },
    { path: path.resolve(output.markdownPath), content: output.markdownContent },
  ];
  if (files[0]?.path === files[1]?.path) {
    throw new Error("Release gate JSON and Markdown outputs must use different paths.");
  }
  const existing = files.find((file) => fs.existsSync(file.path));
  if (existing !== undefined) {
    throw new Error(`Release gate evidence output already exists: ${existing.path}`);
  }

  for (const file of files) fs.mkdirSync(path.dirname(file.path), { recursive: true });

  const created: string[] = [];
  try {
    for (const file of files) {
      const descriptor = fs.openSync(file.path, "wx");
      created.push(file.path);
      try {
        fs.writeFileSync(descriptor, file.content, { encoding: "utf8" });
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const filePath of created) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Release gate evidence writing failed and partial output cleanup was incomplete.",
      );
    }
    throw error;
  }
}
