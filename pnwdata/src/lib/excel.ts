function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
  const safe = /^[=+\-@]/.test(serialized) ? `'${serialized}` : serialized;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function buildCsv(data: Record<string, unknown>[]): string {
  const headers = [...new Set(data.flatMap((row) => Object.keys(row)))];
  if (headers.length === 0) return "";

  const rows = [headers, ...data.map((row) => headers.map((header) => row[header]))];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function exportToCsv(filename: string, data: Record<string, unknown>[]) {
  const blob = new Blob(["\uFEFF", buildCsv(data)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
