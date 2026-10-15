const FORBIDDEN_CHARS_RE = /[\\/:*?"<>|]/g;

export function sanitizeFilenamePart(name) {
  return name.replace(FORBIDDEN_CHARS_RE, '_');
}

export function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

// [ZIPファイル名]_[MOTファイル名]_[Side].xlsx（sideを省略した場合は [ZIPファイル名]_[MOTファイル名].xlsx）
export function buildExportFilename(zipFileName, motFileName, side) {
  const zipBase = sanitizeFilenamePart(stripExtension(zipFileName));
  const motBase = sanitizeFilenamePart(stripExtension(motFileName));
  return side ? `${zipBase}_${motBase}_${side}.xlsx` : `${zipBase}_${motBase}.xlsx`;
}
