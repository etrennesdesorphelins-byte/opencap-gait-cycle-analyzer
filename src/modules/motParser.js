// OpenSim MOTファイルのパーサー。
// ヘッダーは `endheader` 行で終了し、その次の非空行が列名行となる。
// 区切り文字はタブ・複数スペース・単一スペースのいずれも許容するため、
// 空白文字全般 (\s+) で分割する。

function splitFields(line) {
  return line.trim().split(/\s+/).filter((token) => token.length > 0);
}

export function parseMot(text) {
  const lines = text.split(/\r\n|\r|\n/);

  let endHeaderIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().toLowerCase() === 'endheader') {
      endHeaderIndex = i;
      break;
    }
  }

  if (endHeaderIndex === -1) {
    throw new Error('MOTファイルの形式が不正です（endheaderが見つかりません）。');
  }

  const headerLines = lines.slice(0, endHeaderIndex);

  let headerRowIndex = -1;
  for (let i = endHeaderIndex + 1; i < lines.length; i += 1) {
    if (lines[i].trim().length > 0) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('MOTファイルの形式が不正です（列名行が見つかりません）。');
  }

  const headers = splitFields(lines[headerRowIndex]);
  const columns = {};
  headers.forEach((name) => {
    columns[name] = [];
  });

  for (let i = headerRowIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    const tokens = splitFields(line);
    headers.forEach((name, colIdx) => {
      const value = tokens[colIdx] !== undefined ? Number(tokens[colIdx]) : NaN;
      columns[name].push(value);
    });
  }

  const rowCount = columns[headers[0]] ? columns[headers[0]].length : 0;

  return {
    headerLines,
    headers,
    columns,
    rowCount,
  };
}

// 列名は case-insensitive で照合し、元のデータは保持する。
export function getColumn(motData, name) {
  const target = name.toLowerCase();
  const match = motData.headers.find((h) => h.toLowerCase() === target);
  return match ? motData.columns[match] : null;
}

export function hasColumn(motData, name) {
  return getColumn(motData, name) !== null;
}
