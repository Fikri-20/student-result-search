import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const sourceDirectory = resolve(projectDirectory, "..", "csv_exports");
const stagePath = resolve(process.argv[2] || join(sourceDirectory, "Stage_New_Search.csv"));
const detailPath = resolve(process.argv[3] || join(sourceDirectory, "SHREKAT.csv"));
const outputDirectory = resolve(process.argv[4] || join(projectDirectory, "data"));
const recordsDirectory = join(outputDirectory, "records");
const namesDirectory = join(outputDirectory, "names");
const detailBucketsDirectory = join(outputDirectory, ".detail-buckets");

const PUBLIC_RECORD_SCHEMA = [
  "seat",
  "name",
  "schoolIndex",
  "total",
  "statusCode",
  "branchCode",
  "genderCode",
  "s1",
  "s2",
  "m1",
  "m2",
  "s6",
  "s17",
  "s8",
  "s20",
  "s4",
  "s5",
  "s15",
  "s10",
  "s14",
  "s3",
  "studentCase",
  "resultWithheld",
  "yearDescription",
];

class CsvParser {
  constructor(onRow) {
    this.onRow = onRow;
    this.row = [];
    this.field = "";
    this.inQuotes = false;
    this.quotePending = false;
  }

  write(text) {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];

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
        if (character === '"') this.quotePending = true;
        else this.field += character;
        continue;
      }

      if (character === '"') this.inQuotes = true;
      else if (character === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (character === "\n") this.emitRow();
      else if (character !== "\r") this.field += character;
    }
  }

  finish() {
    if (this.quotePending) {
      this.inQuotes = false;
      this.quotePending = false;
    }
    if (this.field.length || this.row.length) this.emitRow();
  }

  emitRow() {
    this.row.push(this.field);
    const completed = this.row;
    this.row = [];
    this.field = "";
    if (completed.length > 1 || completed[0] !== "") this.onRow(completed);
  }
}

async function* csvRows(filePath) {
  const decoder = new TextDecoder("utf-8");
  const pendingRows = [];
  const parser = new CsvParser((row) => pendingRows.push(row));

  for await (const chunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    parser.write(decoder.decode(chunk, { stream: true }));
    while (pendingRows.length) yield pendingRows.shift();
  }

  parser.write(decoder.decode());
  parser.finish();
  while (pendingRows.length) yield pendingRows.shift();
}

function indexHeader(row) {
  return new Map(row.map((field, index) => [field.replace(/^\uFEFF/, ""), index]));
}

function value(row, header, field) {
  const index = header.get(field);
  return index === undefined ? "" : row[index] ?? "";
}

function numberValue(row, header, field) {
  const parsed = Number(value(row, header, field));
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusCode(description) {
  const status = String(description || "").trim();
  if (status.includes("ناجح")) return 1;
  if (status.includes("دور ثان")) return 2;
  if (status.includes("راسب")) return 3;
  if (status.includes("غياب")) return 4;
  return 5;
}

function normalizeArabic(input) {
  return String(input || "")
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

function namePrefixKey(normalizedName) {
  const prefix = Array.from(normalizedName).slice(0, 3);
  return prefix.map((character) => character.codePointAt(0).toString(16)).join("-") || "other";
}

class NameShardWriter {
  constructor(directory) {
    this.directory = directory;
    this.states = new Map();
    this.bufferedBytes = 0;
  }

  append(normalizedName, seat) {
    const key = namePrefixKey(normalizedName);
    let state = this.states.get(key);
    if (!state) {
      state = {
        path: join(this.directory, `${key}.json`),
        buffer: "",
        bytes: 0,
        entries: 0,
      };
      writeFileSync(state.path, "[");
      this.states.set(key, state);
    }

    const serialized = `${state.entries ? "," : ""}${JSON.stringify([normalizedName, seat])}`;
    state.buffer += serialized;
    state.entries += 1;
    const bytes = Buffer.byteLength(serialized);
    state.bytes += bytes;
    this.bufferedBytes += bytes;

    if (state.bytes >= 256 * 1024) this.flush(state);
    if (this.bufferedBytes >= 24 * 1024 * 1024) this.flushAll();
  }

  flush(state) {
    if (!state.buffer) return;
    appendFileSync(state.path, state.buffer);
    this.bufferedBytes -= state.bytes;
    state.buffer = "";
    state.bytes = 0;
  }

  flushAll() {
    for (const state of this.states.values()) this.flush(state);
  }

  finish() {
    this.flushAll();
    for (const state of this.states.values()) appendFileSync(state.path, "]");
  }
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function closeStream(stream) {
  stream.end();
  await once(stream, "finish");
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(recordsDirectory, { recursive: true });
mkdirSync(namesDirectory, { recursive: true });
mkdirSync(detailBucketsDirectory, { recursive: true });

const detailRows = csvRows(detailPath)[Symbol.asyncIterator]();
const detailHeaderResult = await detailRows.next();
if (detailHeaderResult.done) throw new Error("Detail CSV header is missing.");
const detailHeader = indexHeader(detailHeaderResult.value);
const schools = [];
const schoolIndexes = new Map();

class DetailBucketWriter {
  constructor(directory) {
    this.directory = directory;
    this.buffers = new Map();
    this.bufferedBytes = 0;
  }

  append(prefix, detail) {
    const serialized = `${JSON.stringify(detail)}\n`;
    const current = this.buffers.get(prefix) || "";
    this.buffers.set(prefix, current + serialized);
    this.bufferedBytes += Buffer.byteLength(serialized);
    if (Buffer.byteLength(current) >= 256 * 1024) this.flush(prefix);
    if (this.bufferedBytes >= 24 * 1024 * 1024) this.flushAll();
  }

  flush(prefix) {
    const buffer = this.buffers.get(prefix);
    if (!buffer) return;
    appendFileSync(join(this.directory, `${prefix}.ndjson`), buffer);
    this.bufferedBytes -= Buffer.byteLength(buffer);
    this.buffers.set(prefix, "");
  }

  flushAll() {
    for (const prefix of this.buffers.keys()) this.flush(prefix);
  }
}

function getSchoolIndex(row) {
  const code = String(value(row, detailHeader, "school_code")).trim();
  const name = String(value(row, detailHeader, "school_name")).trim();
  const key = `${code}|${name}`;
  if (schoolIndexes.has(key)) return schoolIndexes.get(key);

  const index = schools.length;
  schools.push([
    code,
    name,
    String(value(row, detailHeader, "dept_code")).trim(),
    String(value(row, detailHeader, "dept_name")).trim(),
    String(value(row, detailHeader, "moderia")).trim(),
    String(value(row, detailHeader, "city_name")).trim(),
  ]);
  schoolIndexes.set(key, index);
  return index;
}

const detailBucketWriter = new DetailBucketWriter(detailBucketsDirectory);
let detailRowsProcessed = 0;

for await (const detailRow of { [Symbol.asyncIterator]: () => detailRows }) {
  const seat = numberValue(detailRow, detailHeader, "seating_no");
  if (!seat) continue;
  const prefix = String(seat).slice(0, 3);
  detailBucketWriter.append(prefix, [
    seat,
    getSchoolIndex(detailRow),
    numberValue(detailRow, detailHeader, "branch_code_new_new"),
    numberValue(detailRow, detailHeader, "male"),
    numberValue(detailRow, detailHeader, "s1"),
    numberValue(detailRow, detailHeader, "s2"),
    numberValue(detailRow, detailHeader, "m1"),
    numberValue(detailRow, detailHeader, "m2"),
    numberValue(detailRow, detailHeader, "s6"),
    numberValue(detailRow, detailHeader, "s17"),
    numberValue(detailRow, detailHeader, "s8"),
    numberValue(detailRow, detailHeader, "s20"),
    numberValue(detailRow, detailHeader, "s4"),
    numberValue(detailRow, detailHeader, "s5"),
    numberValue(detailRow, detailHeader, "s15"),
    numberValue(detailRow, detailHeader, "s10"),
    numberValue(detailRow, detailHeader, "s14"),
    numberValue(detailRow, detailHeader, "s3"),
    numberValue(detailRow, detailHeader, "student_case"),
    numberValue(detailRow, detailHeader, "Hageb_natega"),
    String(value(detailRow, detailHeader, "year_desc")).trim(),
  ]);
  detailRowsProcessed += 1;
  if (detailRowsProcessed % 200_000 === 0) {
    console.log(`Prepared ${detailRowsProcessed.toLocaleString("en-US")} detail rows…`);
  }
}
detailBucketWriter.flushAll();

const stageRows = csvRows(stagePath)[Symbol.asyncIterator]();
const stageHeaderResult = await stageRows.next();
if (stageHeaderResult.done) throw new Error("Summary CSV header is missing.");
const stageHeader = indexHeader(stageHeaderResult.value);
let currentSeatPrefix = "";
let currentSeatRecords = [];
let currentDetails = new Map();
const nameWriter = new NameShardWriter(namesDirectory);
const filterStream = createWriteStream(join(outputDirectory, "filters.json"));
await writeChunk(filterStream, "[");
let filterEntries = 0;
let processed = 0;
let stageOnly = 0;
let totalSum = 0;
let scoredRecords = 0;
const counts = { pass: 0, second: 0, fail: 0, absent: 0, other: 0 };

function flushSeatRecords() {
  if (!currentSeatPrefix || !currentSeatRecords.length) return;
  writeFileSync(
    join(recordsDirectory, `${currentSeatPrefix}.json`),
    JSON.stringify(currentSeatRecords),
  );
  currentSeatRecords = [];
}

function loadDetails(prefix) {
  const path = join(detailBucketsDirectory, `${prefix}.ndjson`);
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
  return new Map(
    content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const detail = JSON.parse(line);
        return [detail[0], detail];
      }),
  );
}

for await (const stageRow of { [Symbol.asyncIterator]: () => stageRows }) {
  const seat = numberValue(stageRow, stageHeader, "seating_no");
  if (!seat) continue;
  const name = String(value(stageRow, stageHeader, "arabic_name")).trim();
  const total = numberValue(stageRow, stageHeader, "total_degree");
  const code = statusCode(value(stageRow, stageHeader, "student_case_desc"));
  const seatPrefix = String(seat).slice(0, 3);

  if (seatPrefix !== currentSeatPrefix) {
    flushSeatRecords();
    currentSeatPrefix = seatPrefix;
    currentDetails = loadDetails(seatPrefix);
  }

  const detail = currentDetails.get(seat);
  if (!detail) stageOnly += 1;
  const schoolIndex = detail?.[1] ?? -1;
  const genderCode = detail?.[3] ?? 0;

  const record = [
    seat,
    name,
    schoolIndex,
    total,
    code,
    detail?.[2] ?? 0,
    genderCode,
    ...(detail ? detail.slice(4) : Array(17).fill(0)),
  ];

  currentSeatRecords.push(record);
  nameWriter.append(normalizeArabic(name), seat);
  await writeChunk(
    filterStream,
    `${filterEntries ? "," : ""}${JSON.stringify([seat, total, code, schoolIndex, genderCode])}`,
  );
  filterEntries += 1;

  if (code === 1) counts.pass += 1;
  else if (code === 2) counts.second += 1;
  else if (code === 3) counts.fail += 1;
  else if (code === 4) counts.absent += 1;
  else counts.other += 1;

  if (total > 0) {
    totalSum += total;
    scoredRecords += 1;
  }

  processed += 1;
  if (processed % 100_000 === 0) console.log(`Processed ${processed.toLocaleString("en-US")} records…`);
}

flushSeatRecords();
nameWriter.finish();
await writeChunk(filterStream, "]");
await closeStream(filterStream);
rmSync(detailBucketsDirectory, { recursive: true, force: true });

const cities = [...new Set(schools.map((school) => school[5]).filter(Boolean))].sort((a, b) =>
  a.localeCompare(b, "ar"),
);
const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  recordSchema: PUBLIC_RECORD_SCHEMA,
  schoolSchema: ["code", "name", "departmentCode", "departmentName", "directorateCode", "city"],
  filterSchema: ["seat", "total", "statusCode", "schoolIndex", "genderCode"],
  stats: {
    total: processed,
    ...counts,
    average: scoredRecords ? (totalSum / scoredRecords / 320) * 100 : 0,
  },
  cities,
  schools,
};
writeFileSync(join(outputDirectory, "catalog.json"), JSON.stringify(catalog));

console.log(`Built ${processed.toLocaleString("en-US")} public records.`);
console.log(`Schools: ${schools.length.toLocaleString("en-US")}`);
console.log(`Unmatched Stage rows: ${stageOnly.toLocaleString("en-US")}`);
console.log(`Prepared detail rows: ${detailRowsProcessed.toLocaleString("en-US")}`);
