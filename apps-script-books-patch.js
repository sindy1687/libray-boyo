// ===== Books =====
function writeBooks_(books) {
  const sh = getSheet_('Books');
  sh.clearContents();

  const header = ['id', 'title', 'author', 'coverUrl', 'coverImage', 'genre', 'year', 'copies', 'availableCopies', 'bookIds'];
  const rows = books.map(b => {
    const bookIds = Array.isArray(b.bookIds) ? b.bookIds.join(',') : '';
    const coverUrl = b.coverUrl || '';
    const coverImage = coverUrl ? `=IMAGE("${coverUrl}")` : '';
    return [
      b.id || '',
      b.title || '',
      b.author || '',
      coverUrl,
      coverImage,
      b.genre || '',
      Number(b.year || 0),
      Number(b.copies || 0),
      Number(b.availableCopies || 0),
      bookIds
    ];
  });

  sh.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
}

function readBooks_() {
  const sh = getSheet_('Books');
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];

  const header = values[0];
  const idx = indexMap_(header);

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const id = row[idx.id] || '';
    const title = row[idx.title] || '';
    if (!id && !title) continue;

    const bookIdsCell = row[idx.bookIds] || '';
    const bookIds = String(bookIdsCell).trim()
      ? String(bookIdsCell).split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    const obj = {
      id: String(id),
      title: String(title),
      author: String(row[idx.author] || ''),
      coverUrl: String(row[idx.coverUrl] || ''),
      genre: String(row[idx.genre] || ''),
      year: Number(row[idx.year] || 0),
      copies: Number(row[idx.copies || 0),
      availableCopies: Number(row[idx.availableCopies || 0),
    };
    if (bookIds) obj.bookIds = bookIds;

    out.push(obj);
  }
  return out;
}

function indexMap_(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    map[String(h || '').trim()] = i;
  });

  return {
    id: map.id ?? 0,
    title: map.title ?? 1,
    author: map.author ?? 2,
    coverUrl: map.coverUrl ?? 3,
    coverImage: map.coverImage ?? 4,
    genre: map.genre ?? 5,
    year: map.year ?? 6,
    copies: map.copies ?? 7,
    availableCopies: map.availableCopies ?? 8,
    bookIds: map.bookIds ?? 9,

    bookId: map.bookId ?? 1,
    bookTitle: map.bookTitle ?? 2,
    userId: map.userId ?? 3,
    borrowDate: map.borrowDate ?? 4,
    dueDate: map.dueDate ?? 5,
    returnedAt: map.returnedAt ?? 6,
  };
}
