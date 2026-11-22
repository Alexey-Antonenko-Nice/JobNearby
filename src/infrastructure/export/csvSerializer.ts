export type CsvCell = string | number | boolean | null | undefined;

export function formatCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const text = String(value);
  if (/[",\r\n]/u.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function serializeCsv(
  headers: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  options: { readonly includeBom?: boolean } = {},
): Buffer {
  const lines: string[] = [headers.map(formatCsvCell).join(",")];
  for (const row of rows) {
    if (row.length !== headers.length) {
      throw new Error(
        `CSV row column count (${row.length}) does not match header count (${headers.length}).`,
      );
    }
    lines.push(row.map(formatCsvCell).join(","));
  }
  const body = lines.join("\r\n") + "\r\n";
  const prefix = options.includeBom === false ? "" : "\uFEFF";
  return Buffer.from(prefix + body, "utf8");
}
