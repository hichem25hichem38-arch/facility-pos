// In-memory stand-in for the platform database client. Shared by the local
// check and the client interop test; never packaged with the Function.
export function fakeDb() {
  const tables = new Map();
  const list = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const pick = (row, columns) =>
    columns === '*' || !columns
      ? { ...row }
      : Object.fromEntries(columns.split(',').map((c) => [c.trim(), row[c.trim()]]));

  function builder(table, mode, values) {
    const filters = [];
    let columns = '*';
    let orderBy = null;
    let ascending = true;
    let maxRows = Infinity;
    const run = () => {
      const data = list(table);
      const match = (row) => filters.every(([key, value]) => row[key] === value);
      if (mode === 'read') {
        const selected = data.filter(match);
        if (orderBy) {
          selected.sort((a, b) => String(a[orderBy]).localeCompare(String(b[orderBy])) * (ascending ? 1 : -1));
        }
        return { data: selected.slice(0, maxRows).map((row) => pick(row, columns)), error: null };
      }
      if (mode === 'insert') {
        const unique = String(values.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
        if (unique.length && data.some((row) => unique.every((key) => row[key] === values.row[key]))) {
          return { data: [], error: null };
        }
        data.push({ ...values.row });
        return { data: [pick(values.row, columns)], error: null };
      }
      if (mode === 'update') {
        const matched = data.filter(match);
        for (const row of matched) Object.assign(row, values.row);
        return { data: matched.map((row) => pick(row, columns)), error: null };
      }
      throw new Error(`unknown mode ${mode}`);
    };
    const chain = {
      eq(key, value) { filters.push([key, value]); return chain; },
      limit(count) { maxRows = count; return chain; },
      order(name, options) { orderBy = String(name); ascending = options?.ascending !== false; return chain; },
      select(names) { if (typeof names === 'string') columns = names; return chain; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return chain;
  }

  return {
    from(table) {
      return {
        select: (columns) => builder(table, 'read', null).select(columns),
        insertIfAbsent: (row, options) => builder(table, 'insert', { row, onConflict: options?.onConflict }),
        insert: (row) => builder(table, 'insert', { row }),
        update: (row) => builder(table, 'update', { row }),
      };
    },
    dump: (table) => list(table).map((row) => ({ ...row })),
  };
}
