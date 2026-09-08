// Compact CI/audit output: never dump whole source files from regex assertions.
export default async function* auditReporter(events) {
  for await (const event of events) {
    const data = event.data;
    if (event.type === "test:fail") yield JSON.stringify({
      name: data.name, file: data.file, line: data.line,
      error: String(data.details?.error?.cause?.message || data.details?.error).slice(0, 900),
    }) + "\n";
    if (event.type === "test:summary") yield JSON.stringify(data) + "\n";
    if (event.type === "test:diagnostic" && /^(tests|pass|fail|skipped|duration_ms) /.test(data.message)) yield data.message + "\n";
  }
}
