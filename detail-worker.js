const DETAIL_FIELDS = [
  "seating_no",
  "arabic_name",
  "school_code",
  "school_name",
  "dept_code",
  "dept_name",
  "moderia",
  "city_name",
  "male",
  "moslem",
  "national_no",
  "branch_code_new_new",
  "control_code",
  "std_code",
  "std_type_code",
  "std_type",
  "year",
  "month",
  "day",
  "nationality",
  "lang_1",
  "lang_2",
  "address",
  "city_code",
  "police_station_code",
  "police_station",
  "birth_palace_code",
  "birth_palace",
  "notes",
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
  "total_degree",
  "s10",
  "s14",
  "s3",
  "no_of_fail",
  "student_case",
  "Hageb_natega",
  "tanseq_number",
  "year_id",
  "year_desc",
];

let detailFile = null;
let seats = new Uint32Array();
let starts = new Uint32Array();
let isReady = false;

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

function findSeat(target) {
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

async function indexDetailFile(file) {
  detailFile = file;
  isReady = false;
  const seatList = [];
  const startList = [];
  const reader = file.stream().getReader();
  let globalOffset = 0;
  let recordStart = 0;
  let rowSeat = 0;
  let rowHasDigits = false;
  let readingSeat = true;
  let inQuotes = false;
  let quotePending = false;
  let lastProgressAt = 0;

  const finishRecord = (nextStart) => {
    if (rowHasDigits) {
      seatList.push(rowSeat);
      startList.push(recordStart);
    }
    recordStart = nextStart;
    rowSeat = 0;
    rowHasDigits = false;
    readingSeat = true;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    for (let index = 0; index < value.length; index += 1) {
      const byte = value[index];
      const absoluteOffset = globalOffset + index;

      if (quotePending) {
        if (byte === 34) {
          quotePending = false;
          continue;
        }
        inQuotes = false;
        quotePending = false;
      }

      if (inQuotes) {
        if (byte === 34) quotePending = true;
        continue;
      }

      if (byte === 34) {
        inQuotes = true;
        continue;
      }

      if (readingSeat) {
        if (byte >= 48 && byte <= 57) {
          rowSeat = rowSeat * 10 + (byte - 48);
          rowHasDigits = true;
        } else if (byte === 44) {
          readingSeat = false;
        }
      }

      if (byte === 10) finishRecord(absoluteOffset + 1);
    }

    globalOffset += value.byteLength;
    const now = Date.now();
    if (now - lastProgressAt > 180) {
      lastProgressAt = now;
      self.postMessage({
        type: "progress",
        progress: Math.min(0.99, globalOffset / file.size),
      });
    }
  }

  if (recordStart < file.size && rowHasDigits) finishRecord(file.size);

  seats = Uint32Array.from(seatList);
  starts = Uint32Array.from(startList);
  isReady = true;
  self.postMessage({ type: "ready", records: seats.length });
}

async function getRecord(seat) {
  if (!isReady || !detailFile) {
    throw new Error("ملف السجل الكامل ما زال قيد الفهرسة.");
  }

  const index = findSeat(Number(seat));
  if (index === -1) throw new Error("لم يُعثر على رقم الجلوس في ملف السجل الكامل.");

  const start = starts[index];
  const end = index + 1 < starts.length ? starts[index + 1] : detailFile.size;
  const text = await detailFile.slice(start, end).text();
  let row = null;
  const parser = new CsvParser((parsedRow) => {
    if (!row) row = parsedRow;
  });
  parser.write(text);
  parser.finish();

  if (!row) throw new Error("تعذر قراءة السجل المطلوب.");

  const record = {};
  DETAIL_FIELDS.forEach((field, fieldIndex) => {
    record[field] = row[fieldIndex] ?? "";
  });
  return record;
}

self.onmessage = async (event) => {
  const message = event.data;

  if (message.type === "load") {
    try {
      await indexDetailFile(message.file);
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message || String(error) });
    }
    return;
  }

  if (message.type === "get") {
    try {
      const record = await getRecord(message.seat);
      self.postMessage({
        type: "record",
        requestId: message.requestId,
        seat: message.seat,
        record,
      });
    } catch (error) {
      self.postMessage({
        type: "record-error",
        requestId: message.requestId,
        message: error?.message || String(error),
      });
    }
  }
};
