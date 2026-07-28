let seats = new Uint32Array();
let totals = new Float32Array();
let statusCodes = new Uint8Array();
let names = [];
let normalizedNames = [];

const STATUS_LABELS = {
  1: "ناجح دور أول",
  2: "دور ثان",
  3: "راسب دور أول",
  4: "غياب كلي",
  5: "حالة أخرى",
};

class CsvStreamParser {
  constructor(onRow) {
    this.onRow = onRow;
    this.row = [];
    this.field = "";
    this.inQuotes = false;
    this.quotePending = false;
  }

  write(text) {
    for (let index = 0; index < text.length; index += 1) {
      let character = text[index];

      if (this.quotePending) {
        if (character === '"') {
          this.field += '"';
          this.quotePending = false;
          continue;
        }

        this.inQuotes = false;
        this.quotePending = false;
      }

      if (this.inQuotes) {
        if (character === '"') {
          this.quotePending = true;
        } else {
          this.field += character;
        }
        continue;
      }

      if (character === '"') {
        this.inQuotes = true;
      } else if (character === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (character === "\n") {
        this.emitRow();
      } else if (character !== "\r") {
        this.field += character;
      }
    }
  }

  finish() {
    if (this.quotePending) {
      this.inQuotes = false;
      this.quotePending = false;
    }

    if (this.field.length || this.row.length) {
      this.emitRow();
    }
  }

  emitRow() {
    this.row.push(this.field);
    const completedRow = this.row;
    this.row = [];
    this.field = "";

    if (completedRow.length > 1 || completedRow[0] !== "") {
      this.onRow(completedRow);
    }
  }
}

function normalizeArabic(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function getStatusCode(value) {
  const status = String(value ?? "").trim();
  if (status.includes("ناجح")) return 1;
  if (status.includes("دور ثان")) return 2;
  if (status.includes("راسب")) return 3;
  if (status.includes("غياب")) return 4;
  return 5;
}

function makeResult(index) {
  const total = Number(totals[index] || 0);
  const statusCode = Number(statusCodes[index] || 5);
  return {
    seat: Number(seats[index]),
    name: names[index],
    total,
    percentage: total > 0 ? Number(((total / 320) * 100).toFixed(2)) : 0,
    statusCode,
    status: STATUS_LABELS[statusCode],
  };
}

function binarySearchSeat(target) {
  let low = 0;
  let high = seats.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const value = seats[middle];
    if (value === target) return middle;
    if (value < target) low = middle + 1;
    else high = middle - 1;
  }

  return -1;
}

function searchRecords(query) {
  const rawQuery = String(query ?? "").trim();
  if (rawQuery.length < 2) return [];

  if (/^\d{6,8}$/.test(rawQuery)) {
    const exactIndex = binarySearchSeat(Number(rawQuery));
    if (exactIndex !== -1) return [makeResult(exactIndex)];
  }

  const compactQuery = normalizeArabic(rawQuery);
  const numericQuery = /^\d+$/.test(rawQuery) ? rawQuery : "";
  const exactMatches = [];
  const prefixMatches = [];
  const containsMatches = [];

  for (let index = 0; index < seats.length; index += 1) {
    if (numericQuery) {
      const seatText = String(seats[index]);
      if (seatText.startsWith(numericQuery)) {
        if (prefixMatches.length < 30) prefixMatches.push(index);
      } else if (containsMatches.length < 30 && seatText.includes(numericQuery)) {
        containsMatches.push(index);
      }
      continue;
    }

    const candidate = normalizedNames[index];
    if (candidate === compactQuery) {
      if (exactMatches.length < 30) exactMatches.push(index);
    } else if (candidate.startsWith(compactQuery)) {
      if (prefixMatches.length < 30) prefixMatches.push(index);
    } else if (containsMatches.length < 30 && candidate.includes(compactQuery)) {
      containsMatches.push(index);
    }
  }

  return [...exactMatches, ...prefixMatches, ...containsMatches]
    .slice(0, 30)
    .map(makeResult);
}

async function loadSearchFile(file) {
  const seatList = [];
  const totalList = [];
  const statusList = [];
  const nameList = [];
  const normalizedList = [];
  const counts = { pass: 0, second: 0, fail: 0, absent: 0, other: 0 };
  let scoreSum = 0;
  let scoredRecords = 0;
  let rowIndex = 0;
  let loadedBytes = 0;
  let lastProgressAt = 0;

  const parser = new CsvStreamParser((row) => {
    if (rowIndex === 0) {
      rowIndex += 1;
      return;
    }

    rowIndex += 1;
    const seat = Number(row[0]);
    if (!Number.isFinite(seat)) return;

    const name = String(row[1] ?? "").trim();
    const total = Number(row[2]) || 0;
    const statusCode = getStatusCode(row[4]);

    seatList.push(seat);
    nameList.push(name);
    normalizedList.push(normalizeArabic(name));
    totalList.push(total);
    statusList.push(statusCode);

    if (statusCode === 1) counts.pass += 1;
    else if (statusCode === 2) counts.second += 1;
    else if (statusCode === 3) counts.fail += 1;
    else if (statusCode === 4) counts.absent += 1;
    else counts.other += 1;

    if (total > 0) {
      scoreSum += total;
      scoredRecords += 1;
    }
  });

  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    loadedBytes += value.byteLength;
    parser.write(decoder.decode(value, { stream: true }));

    const now = Date.now();
    if (now - lastProgressAt > 180) {
      lastProgressAt = now;
      self.postMessage({
        type: "progress",
        progress: Math.min(0.99, loadedBytes / file.size),
      });
    }
  }

  parser.write(decoder.decode());
  parser.finish();

  seats = Uint32Array.from(seatList);
  totals = Float32Array.from(totalList);
  statusCodes = Uint8Array.from(statusList);
  names = nameList;
  normalizedNames = normalizedList;

  const totalRecords = seats.length;
  self.postMessage({
    type: "ready",
    stats: {
      total: totalRecords,
      ...counts,
      average: scoredRecords ? (scoreSum / scoredRecords / 320) * 100 : 0,
    },
  });
}

self.onmessage = async (event) => {
  const message = event.data;

  if (message.type === "load") {
    try {
      await loadSearchFile(message.file);
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message || String(error) });
    }
    return;
  }

  if (message.type === "search") {
    try {
      const results = searchRecords(message.query);
      self.postMessage({ type: "results", requestId: message.requestId, results });
    } catch (error) {
      self.postMessage({
        type: "search-error",
        requestId: message.requestId,
        message: error?.message || String(error),
      });
    }
  }
};
