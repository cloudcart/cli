export interface TableColumn {
  key: string;
  header: string;
  width?: number;
}

export function printTable(columns: TableColumn[], rows: Record<string, string>[]): void {
  const widths = columns.map((col) => {
    const maxContent = Math.max(col.header.length, ...rows.map((r) => (r[col.key] ?? '').length));
    return col.width ?? maxContent;
  });

  // Header
  const header = columns.map((col, i) => col.header.padEnd(widths[i])).join('  ');
  console.log(header);
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));

  // Rows
  for (const row of rows) {
    const line = columns.map((col, i) => (row[col.key] ?? '').padEnd(widths[i])).join('  ');
    console.log(line);
  }
}
