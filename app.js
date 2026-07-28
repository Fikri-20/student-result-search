const $ = (selector) => document.querySelector(selector);

const elements = {
  filePicker: $("#filePicker"),
  dropZone: $("#dropZone"),
  loadMessage: $("#loadMessage"),
  stageFileName: $("#stageFileName"),
  detailFileName: $("#detailFileName"),
  stageState: $("#stageState"),
  detailState: $("#detailState"),
  stageProgress: $("#stageProgress"),
  detailProgress: $("#detailProgress"),
  statsSection: $("#statsSection"),
  statTotal: $("#statTotal"),
  statPass: $("#statPass"),
  statSecond: $("#statSecond"),
  statFail: $("#statFail"),
  statAverage: $("#statAverage"),
  statPassRate: $("#statPassRate"),
  statSecondRate: $("#statSecondRate"),
  statFailRate: $("#statFailRate"),
  searchInput: $("#searchInput"),
  clearSearch: $("#clearSearch"),
  searchHint: $("#searchHint"),
  resultsMeta: $("#resultsMeta"),
  searchResults: $("#searchResults"),
  emptySearch: $("#emptySearch"),
  resultTemplate: $("#resultTemplate"),
  recordSection: $("#recordSection"),
  recordCheque: $("#recordCheque"),
  recordFields: $("#recordFields"),
  closeRecord: $("#closeRecord"),
  printRecord: $("#printRecord"),
};

const fieldGroups = [
  {
    title: "بيانات الطالب والمدرسة",
    fields: [
      ["seating_no", "رقم الجلوس"],
      ["arabic_name", "الاسم بالعربية", "wide"],
      ["national_no", "الرقم القومي"],
      ["school_code", "كود المدرسة"],
      ["school_name", "اسم المدرسة", "wide"],
      ["dept_code", "كود الإدارة"],
      ["dept_name", "الإدارة التعليمية"],
      ["moderia", "كود المديرية"],
      ["city_name", "المحافظة"],
      ["male", "كود النوع"],
      ["moslem", "كود الديانة"],
      ["branch_code_new_new", "كود الشعبة"],
      ["control_code", "كود الكنترول"],
      ["std_code", "كود الطالب"],
      ["std_type_code", "كود نوع الطالب"],
      ["std_type", "نوع الطالب"],
    ],
  },
  {
    title: "البيانات الشخصية والإدارية",
    fields: [
      ["year", "سنة الميلاد"],
      ["month", "شهر الميلاد"],
      ["day", "يوم الميلاد"],
      ["nationality", "كود الجنسية"],
      ["lang_1", "اللغة الأولى"],
      ["lang_2", "اللغة الثانية"],
      ["address", "العنوان", "wide"],
      ["city_code", "كود المدينة"],
      ["police_station_code", "كود قسم الشرطة"],
      ["police_station", "قسم الشرطة"],
      ["birth_palace_code", "كود محل الميلاد"],
      ["birth_palace", "محل الميلاد"],
      ["notes", "ملاحظات", "wide"],
    ],
  },
  {
    title: "الدرجات كما وردت في قاعدة البيانات",
    fields: [
      ["s1", "درجة المادة s1"],
      ["s2", "درجة المادة s2"],
      ["m1", "حقل المادة m1"],
      ["m2", "حقل المادة m2"],
      ["s6", "درجة المادة s6"],
      ["s17", "درجة المادة s17"],
      ["s8", "درجة المادة s8"],
      ["s20", "درجة المادة s20"],
      ["s4", "درجة المادة s4"],
      ["s5", "درجة المادة s5"],
      ["s15", "درجة المادة s15"],
      ["total_degree", "المجموع الكلي"],
      ["s10", "درجة المادة s10"],
      ["s14", "درجة المادة s14"],
      ["s3", "درجة المادة s3"],
    ],
  },
  {
    title: "بيانات النتيجة والتنسيق",
    fields: [
      ["no_of_fail", "عدد مواد الرسوب"],
      ["student_case", "كود حالة الطالب"],
      ["Hageb_natega", "حجب النتيجة"],
      ["tanseq_number", "رقم التنسيق"],
      ["year_id", "كود العام"],
      ["year_desc", "وصف العام", "wide"],
    ],
  },
];

const numericFields = new Set([
  "seating_no",
  "national_no",
  "school_code",
  "dept_code",
  "moderia",
  "male",
  "moslem",
  "branch_code_new_new",
  "control_code",
  "std_code",
  "std_type_code",
  "year",
  "month",
  "day",
  "nationality",
  "lang_1",
  "lang_2",
  "city_code",
  "police_station_code",
  "birth_palace_code",
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
]);

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

let searchWorker;
let detailWorker;
let searchReady = false;
let detailReady = false;
let searchTimer = null;
let searchRequestId = 0;
let recordRequestId = 0;
let pendingSeat = null;
let latestResults = new Map();
let selectedSummary = null;

function createSearchWorker() {
  if (searchWorker) searchWorker.terminate();
  searchReady = false;
  searchWorker = new Worker("search-worker.js", { type: "module" });
  searchWorker.addEventListener("message", handleSearchWorkerMessage);
  searchWorker.addEventListener("error", () => setFileError("stage", "تعذر تشغيل فهرس البحث."));
}

function createDetailWorker() {
  if (detailWorker) detailWorker.terminate();
  detailReady = false;
  detailWorker = new Worker("detail-worker.js", { type: "module" });
  detailWorker.addEventListener("message", handleDetailWorkerMessage);
  detailWorker.addEventListener("error", () => setFileError("detail", "تعذر تشغيل فهرس السجلات."));
}

function getFileStateElement(kind) {
  return document.querySelector(`.file-state[data-file="${kind}"]`);
}

function setProgress(kind, progress, label) {
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const progressElement = kind === "stage" ? elements.stageProgress : elements.detailProgress;
  const stateElement = kind === "stage" ? elements.stageState : elements.detailState;
  progressElement.style.width = `${percent}%`;
  stateElement.textContent = label || `${percent}%`;
}

function setFileReady(kind, text = "جاهز") {
  const wrapper = getFileStateElement(kind);
  wrapper.classList.remove("is-error");
  wrapper.classList.add("is-ready");
  setProgress(kind, 1, text);
}

function setFileError(kind, message) {
  const wrapper = getFileStateElement(kind);
  const stateElement = kind === "stage" ? elements.stageState : elements.detailState;
  wrapper.classList.remove("is-ready");
  wrapper.classList.add("is-error");
  stateElement.textContent = "خطأ";
  elements.loadMessage.textContent = message;
}

function statusFromStudentCase(value) {
  const code = Number(value);
  if (code === 1) return { code: 1, label: "ناجح دور أول" };
  if (code === 2) return { code: 2, label: "دور ثان" };
  if (code === 3) return { code: 3, label: "راسب دور أول" };
  return { code: 5, label: "حالة أخرى" };
}

function formatPercent(value) {
  return `${numberFormatter.format(Number(value) || 0)}%`;
}

function formatScore(value) {
  return numberFormatter.format(Number(value) || 0);
}

function percentOf(part, total) {
  if (!total) return "0%";
  return formatPercent((part / total) * 100);
}

function renderStats(stats) {
  elements.statsSection.hidden = false;
  elements.statTotal.textContent = numberFormatter.format(stats.total);
  elements.statPass.textContent = numberFormatter.format(stats.pass);
  elements.statSecond.textContent = numberFormatter.format(stats.second);
  elements.statFail.textContent = numberFormatter.format(stats.fail);
  elements.statAverage.textContent = formatPercent(stats.average);
  elements.statPassRate.textContent = percentOf(stats.pass, stats.total);
  elements.statSecondRate.textContent = percentOf(stats.second, stats.total);
  elements.statFailRate.textContent = percentOf(stats.fail, stats.total);
}

function handleSearchWorkerMessage(event) {
  const message = event.data;

  if (message.type === "progress") {
    setProgress("stage", message.progress, `فهرسة ${Math.round(message.progress * 100)}%`);
    elements.loadMessage.textContent = "جارٍ بناء فهرس الأسماء والأرقام والإحصائيات…";
    return;
  }

  if (message.type === "ready") {
    searchReady = true;
    setFileReady("stage");
    elements.searchInput.disabled = false;
    elements.searchHint.textContent = "اكتب حرفين على الأقل، أو أدخل رقم الجلوس كاملًا.";
    elements.loadMessage.textContent = detailReady
      ? "الملفان جاهزان. يمكنك البحث وفتح السجل الكامل."
      : "البحث جاهز. ملف السجل الكامل قد يواصل الفهرسة في الخلفية.";
    renderStats(message.stats);
    elements.searchInput.focus();
    return;
  }

  if (message.type === "results") {
    if (message.requestId !== searchRequestId) return;
    renderResults(message.results);
    return;
  }

  if (message.type === "error") {
    setFileError("stage", `تعذر قراءة ملف البحث: ${message.message}`);
    return;
  }

  if (message.type === "search-error" && message.requestId === searchRequestId) {
    elements.resultsMeta.textContent = `تعذر إكمال البحث: ${message.message}`;
  }
}

function handleDetailWorkerMessage(event) {
  const message = event.data;

  if (message.type === "progress") {
    setProgress("detail", message.progress, `فهرسة ${Math.round(message.progress * 100)}%`);
    return;
  }

  if (message.type === "ready") {
    detailReady = true;
    setFileReady("detail");
    elements.loadMessage.textContent = searchReady
      ? "الملفان جاهزان. يمكنك البحث وفتح السجل الكامل."
      : "السجل الكامل جاهز؛ ملف البحث ما زال قيد الفهرسة.";
    if (pendingSeat !== null) {
      const seat = pendingSeat;
      pendingSeat = null;
      requestFullRecord(seat);
    }
    return;
  }

  if (message.type === "record") {
    if (message.requestId !== recordRequestId) return;
    renderFullRecord(message.record);
    return;
  }

  if (message.type === "record-error" && message.requestId === recordRequestId) {
    elements.resultsMeta.textContent = message.message;
    return;
  }

  if (message.type === "error") {
    setFileError("detail", `تعذر قراءة ملف السجل الكامل: ${message.message}`);
  }
}

function handleFiles(files) {
  const csvFiles = [...files].filter((file) => file.name.toLowerCase().endsWith(".csv"));
  const searchFile = csvFiles.find((file) => file.name.toLowerCase().includes("stage_new_search"));
  const fullFile = csvFiles.find((file) => file.name.toLowerCase().includes("shrekat"));

  if (!searchFile && !fullFile) {
    elements.loadMessage.textContent =
      "لم أتعرف على الملفات. اختر Stage_New_Search.csv وSHREKAT.csv.";
    return;
  }

  if (searchFile) {
    createSearchWorker();
    elements.stageFileName.textContent = searchFile.name;
    getFileStateElement("stage").classList.remove("is-ready", "is-error");
    setProgress("stage", 0, "بدء القراءة");
    elements.searchInput.disabled = true;
    searchWorker.postMessage({ type: "load", file: searchFile });
  }

  if (fullFile) {
    createDetailWorker();
    elements.detailFileName.textContent = fullFile.name;
    getFileStateElement("detail").classList.remove("is-ready", "is-error");
    setProgress("detail", 0, "بدء القراءة");
    detailWorker.postMessage({ type: "load", file: fullFile });
  }

  elements.loadMessage.textContent = "بدأت الفهرسة محليًا. يمكنك ترك الصفحة مفتوحة لحظات.";
}

function clearResults(message = "نتيجة البحث ستظهر هنا.") {
  latestResults.clear();
  elements.searchResults.replaceChildren();
  elements.resultsMeta.textContent = "";
  elements.emptySearch.hidden = false;
  elements.emptySearch.querySelector("p").textContent = message;
}

function renderResults(results) {
  elements.searchResults.replaceChildren();
  latestResults = new Map(results.map((result) => [Number(result.seat), result]));

  if (!results.length) {
    elements.resultsMeta.textContent = "لا توجد نتيجة مطابقة.";
    elements.emptySearch.hidden = false;
    elements.emptySearch.querySelector("p").textContent = "جرّب رقم الجلوس أو جزءًا آخر من الاسم.";
    return;
  }

  elements.emptySearch.hidden = true;
  elements.resultsMeta.textContent = `عرض ${numberFormatter.format(results.length)} نتيجة مطابقة`;
  const fragment = document.createDocumentFragment();

  results.forEach((result, index) => {
    const row = elements.resultTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".result-serial").textContent = String(index + 1).padStart(2, "0");
    row.querySelector(".result-name").textContent = result.name;
    row.querySelector(".result-seat").textContent = `رقم الجلوس ${result.seat}`;
    row.querySelector(".result-score").textContent = `${formatScore(result.total)} / 320`;
    const status = row.querySelector(".result-status");
    status.textContent = result.status;
    status.dataset.status = result.statusCode;
    row.setAttribute("aria-label", `فتح السجل الكامل للطالب ${result.name}`);
    row.addEventListener("click", () => selectResult(result));
    fragment.append(row);
  });

  elements.searchResults.append(fragment);
}

function selectResult(result) {
  selectedSummary = result;
  if (!detailReady) {
    pendingSeat = Number(result.seat);
    elements.resultsMeta.textContent =
      "تم اختيار السجل. سيُفتح تلقائيًا عند انتهاء فهرسة SHREKAT.csv.";
    return;
  }
  requestFullRecord(result.seat);
}

function requestFullRecord(seat) {
  if (!detailReady) return;
  recordRequestId += 1;
  elements.resultsMeta.textContent = `جارٍ فتح السجل الكامل لرقم الجلوس ${seat}…`;
  detailWorker.postMessage({ type: "get", requestId: recordRequestId, seat: Number(seat) });
}

function createMetric(label, value, className = "") {
  const metric = document.createElement("div");
  metric.className = `record-metric ${className}`.trim();
  const labelNode = document.createElement("span");
  const valueNode = document.createElement("strong");
  labelNode.textContent = label;
  valueNode.textContent = value;
  metric.append(labelNode, valueNode);
  return metric;
}

function renderFullRecord(record) {
  const total = Number(record.total_degree) || 0;
  const fallbackStatus = statusFromStudentCase(record.student_case);
  const summary =
    selectedSummary && Number(selectedSummary.seat) === Number(record.seating_no)
      ? selectedSummary
      : {
          seat: Number(record.seating_no),
          name: record.arabic_name,
          total,
          percentage: (total / 320) * 100,
          statusCode: fallbackStatus.code,
          status: fallbackStatus.label,
        };

  elements.recordCheque.replaceChildren();
  const identity = document.createElement("div");
  identity.className = "record-identity";
  const name = document.createElement("strong");
  const school = document.createElement("small");
  name.textContent = record.arabic_name || "—";
  school.textContent = record.school_name || "—";
  identity.append(name, school);

  const seatMetric = createMetric("رقم الجلوس", record.seating_no || "—");
  const totalMetric = createMetric("المجموع", `${formatScore(total)} / 320`);
  const percentageMetric = createMetric("النسبة", formatPercent(summary.percentage));
  const statusMetric = createMetric("الحالة", summary.status);
  const statusNode = statusMetric.querySelector("strong");
  statusNode.className = "record-status";
  statusNode.dataset.status = summary.statusCode;
  elements.recordCheque.append(identity, seatMetric, totalMetric, percentageMetric, statusMetric);

  elements.recordFields.replaceChildren();
  const groupsFragment = document.createDocumentFragment();

  fieldGroups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "record-group";
    const heading = document.createElement("h3");
    heading.textContent = group.title;
    const list = document.createElement("dl");
    list.className = "record-grid";

    group.fields.forEach(([key, label, size]) => {
      const field = document.createElement("div");
      field.className = "record-field";
      if (size === "wide") field.classList.add("is-wide");
      if (numericFields.has(key)) field.classList.add("is-number");

      const term = document.createElement("dt");
      const labelNode = document.createElement("span");
      const keyNode = document.createElement("code");
      const value = document.createElement("dd");
      labelNode.textContent = label;
      keyNode.textContent = key;
      value.textContent = String(record[key] ?? "").trim() || "—";
      term.append(labelNode, keyNode);
      field.append(term, value);
      list.append(field);
    });

    section.append(heading, list);
    groupsFragment.append(section);
  });

  elements.recordFields.append(groupsFragment);
  elements.recordSection.hidden = false;
  elements.resultsMeta.textContent = `تم فتح السجل الكامل لرقم الجلوس ${record.seating_no}.`;
  elements.recordSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function queueSearch() {
  const query = elements.searchInput.value.trim();
  elements.clearSearch.hidden = query.length === 0;
  window.clearTimeout(searchTimer);

  if (!query) {
    clearResults();
    return;
  }

  if (!searchReady) {
    clearResults("انتظر حتى ينتهي تحميل ملف البحث.");
    return;
  }

  if (query.length < 2) {
    clearResults("اكتب حرفين على الأقل.");
    return;
  }

  elements.resultsMeta.textContent = "جارٍ البحث…";
  searchTimer = window.setTimeout(() => {
    searchRequestId += 1;
    searchWorker.postMessage({ type: "search", requestId: searchRequestId, query });
  }, 160);
}

elements.filePicker.addEventListener("change", (event) => handleFiles(event.target.files));
elements.searchInput.addEventListener("input", queueSearch);
elements.clearSearch.addEventListener("click", () => {
  elements.searchInput.value = "";
  elements.clearSearch.hidden = true;
  clearResults();
  elements.searchInput.focus();
});
elements.closeRecord.addEventListener("click", () => {
  elements.recordSection.hidden = true;
  elements.searchInput.focus();
});
elements.printRecord.addEventListener("click", () => window.print());

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));

createSearchWorker();
createDetailWorker();
clearResults();
