const $ = (selector) => document.querySelector(selector);

const elements = {
  dataStatus: $("#dataStatus"),
  searchInput: $("#searchInput"),
  clearSearch: $("#clearSearch"),
  searchHint: $("#searchHint"),
  cityFilter: $("#cityFilter"),
  statusFilter: $("#statusFilter"),
  minimumFilter: $("#minimumFilter"),
  genderFilter: $("#genderFilter"),
  schoolFilter: $("#schoolFilter"),
  resetFilters: $("#resetFilters"),
  statTotal: $("#statTotal"),
  statPass: $("#statPass"),
  statSecond: $("#statSecond"),
  statFail: $("#statFail"),
  statAverage: $("#statAverage"),
  statPassRate: $("#statPassRate"),
  statSecondRate: $("#statSecondRate"),
  statFailRate: $("#statFailRate"),
  resultsMeta: $("#resultsMeta"),
  resultCount: $("#resultCount"),
  searchResults: $("#searchResults"),
  pagination: $("#pagination"),
  previousPage: $("#previousPage"),
  currentPage: $("#currentPage"),
  totalPages: $("#totalPages"),
  nextPage: $("#nextPage"),
  emptySearch: $("#emptySearch"),
  resultTemplate: $("#resultTemplate"),
  recordDialog: $("#recordDialog"),
  recordTitle: $("#recordTitle"),
  recordSummary: $("#recordSummary"),
  recordFields: $("#recordFields"),
  closeRecord: $("#closeRecord"),
  printRecord: $("#printRecord"),
};

const filterControls = [
  elements.cityFilter,
  elements.statusFilter,
  elements.minimumFilter,
  elements.genderFilter,
  elements.schoolFilter,
  elements.resetFilters,
];

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const latinNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const PAGE_SIZE = 80;
const recordShardCache = new Map();
const nameShardCache = new Map();

const statusLabels = new Map([
  [1, "ناجح دور أول"],
  [2, "دور ثان"],
  [3, "راسب دور أول"],
  [4, "غياب كلي"],
  [5, "حالة أخرى"],
]);

const gradeFields = [
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
  ["s10", "درجة المادة s10"],
  ["s14", "درجة المادة s14"],
  ["s3", "درجة المادة s3"],
];

let catalog = null;
let recordFields = null;
let schoolFields = null;
let schoolMetadata = [];
let filtersPromise = null;
let searchTimer = null;
let searchVersion = 0;
let paginationState = null;

function normalizeDigits(input) {
  return String(input || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function normalizeArabic(input) {
  return normalizeDigits(input)
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

function normalizeFilterText(input) {
  return normalizeArabic(input).replace(/\u0640/g, "");
}

function namePrefixKey(normalizedName) {
  return Array.from(normalizedName)
    .slice(0, 3)
    .map((character) => character.codePointAt(0).toString(16))
    .join("-");
}

function value(record, field) {
  return record?.[recordFields.get(field)];
}

function schoolValue(school, field) {
  return school?.[schoolFields.get(field)] ?? "";
}

function schoolFor(record) {
  const index = Number(value(record, "schoolIndex"));
  return index >= 0 ? catalog.schools[index] : null;
}

function statusFor(record) {
  const code = Number(value(record, "statusCode"));
  return { code, label: statusLabels.get(code) || "حالة أخرى" };
}

function percentage(total) {
  const score = Number(total);
  return score >= 0 ? (score / 320) * 100 : null;
}

function formatNumber(number) {
  return numberFormatter.format(Number(number) || 0);
}

function formatScore(number) {
  const score = Number(number);
  return score >= 0 ? latinNumberFormatter.format(score) : "—";
}

function formatPercentage(total) {
  const percent = percentage(total);
  return percent === null ? "—" : `${latinNumberFormatter.format(percent)}%`;
}

function rate(part, total) {
  return total ? `${latinNumberFormatter.format((part / total) * 100)}%` : "0%";
}

function renderStats(stats) {
  elements.statTotal.textContent = formatNumber(stats.total);
  elements.statPass.textContent = formatNumber(stats.pass);
  elements.statSecond.textContent = formatNumber(stats.second);
  elements.statFail.textContent = formatNumber(stats.fail);
  elements.statAverage.textContent = `${latinNumberFormatter.format(stats.average)}%`;
  elements.statPassRate.textContent = rate(stats.pass, stats.total);
  elements.statSecondRate.textContent = rate(stats.second, stats.total);
  elements.statFailRate.textContent = rate(stats.fail, stats.total);
}

async function fetchJson(path, allowMissing = false) {
  const response = await fetch(path);
  if (allowMissing && response.status === 404) return [];
  if (!response.ok) throw new Error(`تعذر تحميل ${path} (${response.status})`);
  return response.json();
}

async function getRecordShard(prefix) {
  if (!recordShardCache.has(prefix)) {
    const promise = fetchJson(`data/records/${prefix}.json`).then((records) => ({
      records,
      bySeat: new Map(records.map((record) => [Number(value(record, "seat")), record])),
    }));
    recordShardCache.set(prefix, promise);
  }
  return recordShardCache.get(prefix);
}

async function getNameShard(key) {
  if (!nameShardCache.has(key)) {
    nameShardCache.set(key, fetchJson(`data/names/${key}.json`, true));
  }
  return nameShardCache.get(key);
}

async function getFilterIndex() {
  if (!filtersPromise) filtersPromise = fetchJson("data/filters.json");
  return filtersPromise;
}

async function resolveSeats(seats) {
  const groups = new Map();
  for (const seat of seats) {
    const prefix = String(seat).slice(0, 3);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(Number(seat));
  }

  const resolved = new Map();
  await Promise.all(
    [...groups].map(async ([prefix, groupSeats]) => {
      const shard = await getRecordShard(prefix);
      for (const seat of groupSeats) {
        const record = shard.bySeat.get(seat);
        if (record) resolved.set(seat, record);
      }
    }),
  );
  return seats.map((seat) => resolved.get(Number(seat))).filter(Boolean);
}

function activeFilters() {
  const schoolQuery = normalizeFilterText(elements.schoolFilter.value);
  let schoolMatches = null;
  if (schoolQuery) {
    schoolMatches = new Set();
    schoolMetadata.forEach((school, index) => {
      if (school.searchText.includes(schoolQuery)) schoolMatches.add(index);
    });
  }

  return {
    city: elements.cityFilter.value,
    status: Number(elements.statusFilter.value) || 0,
    minimum: Number(elements.minimumFilter.value) || 0,
    gender: Number(elements.genderFilter.value) || 0,
    schoolMatches,
    any: Boolean(
      elements.cityFilter.value ||
        elements.statusFilter.value ||
        elements.minimumFilter.value ||
        elements.genderFilter.value ||
        schoolQuery
    ),
  };
}

function matchesValues(total, status, schoolIndex, gender, filters) {
  if (filters.status && Number(status) !== filters.status) return false;
  if (filters.gender && Number(gender) !== filters.gender) return false;
  if (filters.minimum && percentage(total) < filters.minimum) return false;
  if (filters.schoolMatches && !filters.schoolMatches.has(Number(schoolIndex))) return false;
  if (filters.city) {
    const school = schoolMetadata[Number(schoolIndex)];
    if (!school || school.cityKey !== filters.city) return false;
  }
  return true;
}

function matchesRecord(record, filters) {
  return matchesValues(
    value(record, "total"),
    value(record, "statusCode"),
    value(record, "schoolIndex"),
    value(record, "genderCode"),
    filters,
  );
}

async function searchBySeat(query) {
  if (query.length < 3) return { records: [], short: true };
  const shard = await getRecordShard(query.slice(0, 3));
  const records = shard.records
    .filter((record) => String(value(record, "seat")).startsWith(query))
    .slice(0, 600);
  return { records, short: false };
}

async function searchByName(query) {
  const normalized = normalizeArabic(query);
  if (Array.from(normalized).length < 3) return { records: [], short: true };
  const entries = await getNameShard(namePrefixKey(normalized));
  const seats = [];
  const seen = new Set();
  for (const [name, seat] of entries) {
    if (!name.startsWith(normalized) || seen.has(seat)) continue;
    seen.add(seat);
    seats.push(seat);
    if (seats.length >= 600) break;
  }
  return { records: await resolveSeats(seats), short: false };
}

async function searchByFilters(filters) {
  elements.resultsMeta.textContent = "جارٍ تحميل فهرس الفلاتر لأول مرة…";
  const index = await getFilterIndex();
  const rankedMatches = [];
  for (const entry of index) {
    const [seat, total, status, schoolIndex, gender] = entry;
    if (!matchesValues(total, status, schoolIndex, gender, filters)) continue;
    rankedMatches.push(entry);
  }
  rankedMatches.sort((first, second) => {
    const scoreDifference = Number(second[1]) - Number(first[1]);
    if (scoreDifference) return scoreDifference;
    return Number(first[0]) - Number(second[0]);
  });
  return rankedMatches.map(([seat]) => seat);
}

function sortRecordsByScore(records) {
  return records.sort((first, second) => {
    const scoreDifference = Number(value(second, "total")) - Number(value(first, "total"));
    if (scoreDifference) return scoreDifference;
    return Number(value(first, "seat")) - Number(value(second, "seat"));
  });
}

function setEmpty(title, message) {
  elements.searchResults.replaceChildren();
  elements.pagination.hidden = true;
  elements.emptySearch.hidden = false;
  elements.emptySearch.querySelector("h3").textContent = title;
  elements.emptySearch.querySelector("p").textContent = message;
  elements.resultCount.hidden = true;
}

function renderResults(records, sortedByScore = false, pageInfo = null) {
  elements.searchResults.replaceChildren();
  if (!records.length) {
    setEmpty("لا توجد نتيجة مطابقة", "جرّب كتابة جزء أطول من الاسم أو غيّر الفلاتر المختارة.");
    elements.resultsMeta.textContent = "لم نعثر على سجلات مطابقة.";
    return;
  }

  elements.emptySearch.hidden = true;
  elements.resultCount.hidden = false;
  const totalResults = pageInfo?.total ?? records.length;
  const offset = pageInfo?.offset ?? 0;
  elements.resultCount.textContent = formatNumber(totalResults);
  elements.resultsMeta.textContent = pageInfo
    ? `عرض ${formatNumber(offset + 1)}–${formatNumber(offset + records.length)} من ${formatNumber(totalResults)} نتيجة، مرتبة حسب المجموع من الأعلى إلى الأقل.`
    : sortedByScore
      ? `عرض ${formatNumber(records.length)} نتيجة مرتبة حسب المجموع من الأعلى إلى الأقل.`
    : `عرض ${formatNumber(records.length)} نتيجة؛ اضغط على أي سجل لعرض التفاصيل.`;
  const fragment = document.createDocumentFragment();

  records.forEach((record, index) => {
    const row = elements.resultTemplate.content.firstElementChild.cloneNode(true);
    const school = schoolFor(record);
    const status = statusFor(record);
    const seat = value(record, "seat");
    const schoolName = schoolValue(school, "name") || "بيانات المدرسة غير متاحة";
    const city = schoolValue(school, "city");

    row.querySelector(".result-index").textContent = String(offset + index + 1).padStart(2, "0");
    row.querySelector(".result-name").textContent = value(record, "name");
    row.querySelector(".result-school").textContent = city ? `${schoolName} · ${city}` : schoolName;
    row.querySelector(".result-seat").textContent = `رقم ${seat}`;
    row.querySelector(".result-score").textContent = `${formatScore(value(record, "total"))} / 320 · ${formatPercentage(value(record, "total"))}`;
    const statusNode = row.querySelector(".result-status");
    statusNode.textContent = status.label;
    statusNode.dataset.status = status.code;
    row.setAttribute("aria-label", `عرض سجل ${value(record, "name")}، رقم الجلوس ${seat}`);
    row.addEventListener("click", () => openRecord(record));
    fragment.append(row);
  });

  elements.searchResults.append(fragment);
}

async function renderFilterPage(page, scrollToResults = false) {
  const state = paginationState;
  if (!state) return;
  const version = searchVersion;
  const pageCount = Math.max(1, Math.ceil(state.seats.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const offset = (safePage - 1) * PAGE_SIZE;

  elements.previousPage.disabled = true;
  elements.nextPage.disabled = true;
  elements.resultsMeta.textContent = "جارٍ تحميل صفحة النتائج…";
  const records = await resolveSeats(state.seats.slice(offset, offset + PAGE_SIZE));
  if (state !== paginationState || version !== searchVersion) return;

  state.page = safePage;
  renderResults(records, true, { total: state.seats.length, offset });
  elements.pagination.hidden = state.seats.length <= PAGE_SIZE;
  elements.currentPage.textContent = formatNumber(safePage);
  elements.totalPages.textContent = formatNumber(pageCount);
  elements.previousPage.disabled = safePage <= 1;
  elements.nextPage.disabled = safePage >= pageCount;

  if (scrollToResults) {
    document.querySelector(".results-section").scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }
}

async function runSearch() {
  if (!catalog) return;
  const version = ++searchVersion;
  const rawQuery = elements.searchInput.value.trim();
  const normalizedDigits = normalizeDigits(rawQuery).replace(/\s+/g, "");
  const numeric = /^\d+$/.test(normalizedDigits);
  const filters = activeFilters();
  paginationState = null;
  elements.pagination.hidden = true;

  elements.clearSearch.hidden = !rawQuery;
  if (!rawQuery && !filters.any) {
    elements.resultsMeta.textContent = "اكتب رقم الجلوس أو الاسم، أو اختر أحد الفلاتر.";
    setEmpty("ابدأ برقم الجلوس أو الاسم", "يمكنك أيضًا استخدام الفلاتر وحدها لاستعراض مجموعة من النتائج.");
    return;
  }

  elements.resultsMeta.textContent = "جارٍ البحث…";
  elements.resultCount.hidden = true;

  try {
    let records;
    let short = false;
    if (!rawQuery) {
      const seats = await searchByFilters(filters);
      if (version !== searchVersion) return;
      paginationState = { seats, page: 1 };
      if (!seats.length) {
        renderResults([], true);
        return;
      }
      await renderFilterPage(1);
      return;
    } else {
      const result = numeric ? await searchBySeat(normalizedDigits) : await searchByName(rawQuery);
      records = result.records;
      short = result.short;
      if (filters.any) records = sortRecordsByScore(
        records.filter((record) => matchesRecord(record, filters)),
      );
    }

    if (version !== searchVersion) return;
    if (short) {
      setEmpty("أكمل عبارة البحث", "أدخل 3 أحرف أو 3 أرقام على الأقل حتى نحدد الجزء المطلوب من الفهرس.");
      elements.resultsMeta.textContent = "عبارة البحث قصيرة جدًا.";
      return;
    }
    renderResults(records.slice(0, PAGE_SIZE), filters.any);
  } catch (error) {
    if (version !== searchVersion) return;
    console.error(error);
    setEmpty("تعذر إكمال البحث", "تحقق من اتصال الإنترنت ثم أعد المحاولة.");
    elements.resultsMeta.textContent = error.message;
  }
}

function queueSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 220);
}

function createSummaryCell(label, content, metric = false) {
  const wrapper = document.createElement("div");
  wrapper.className = `summary-cell${metric ? " metric" : ""}`;
  const labelNode = document.createElement("span");
  const valueNode = document.createElement("strong");
  labelNode.textContent = label;
  valueNode.textContent = content || "—";
  wrapper.append(labelNode, valueNode);
  return wrapper;
}

function displayGrade(rawValue) {
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) && numeric >= 0 ? latinNumberFormatter.format(numeric) : "—";
}

function createFieldGroup(title, fields) {
  const group = document.createElement("section");
  group.className = "field-group";
  const heading = document.createElement("h3");
  const grid = document.createElement("div");
  heading.textContent = title;
  grid.className = "field-grid";

  for (const [label, content, numeric = false] of fields) {
    const field = document.createElement("div");
    field.className = `field-item${numeric ? " numeric" : ""}`;
    const labelNode = document.createElement("span");
    const valueNode = document.createElement("strong");
    labelNode.textContent = label;
    valueNode.textContent = content === "" || content === null || content === undefined ? "—" : content;
    field.append(labelNode, valueNode);
    grid.append(field);
  }

  group.append(heading, grid);
  return group;
}

function openRecord(record) {
  const school = schoolFor(record);
  const status = statusFor(record);
  const total = value(record, "total");
  const genderCode = Number(value(record, "genderCode"));

  elements.recordTitle.textContent = value(record, "name");
  elements.recordSummary.replaceChildren(
    createSummaryCell("اسم الطالب", value(record, "name")),
    createSummaryCell("رقم الجلوس", String(value(record, "seat")), true),
    createSummaryCell("المجموع", `${formatScore(total)} / 320`, true),
    createSummaryCell("النسبة", formatPercentage(total), true),
  );

  const schoolGroup = createFieldGroup("بيانات الطالب والمدرسة", [
    ["حالة النتيجة", status.label],
    ["النوع", genderCode === 1 ? "طالب" : genderCode === 2 ? "طالبة" : "غير مسجل"],
    ["كود الشعبة", formatScore(value(record, "branchCode")), true],
    ["كود المدرسة", schoolValue(school, "code"), true],
    ["اسم المدرسة", schoolValue(school, "name")],
    ["المحافظة", schoolValue(school, "city")],
    ["كود الإدارة", schoolValue(school, "departmentCode"), true],
    ["الإدارة التعليمية", schoolValue(school, "departmentName")],
    ["كود المديرية", schoolValue(school, "directorateCode"), true],
  ]);

  const gradesGroup = createFieldGroup(
    "الدرجات كما وردت في المصدر",
    gradeFields.map(([field, label]) => [label, displayGrade(value(record, field)), true]),
  );

  const resultGroup = createFieldGroup("بيانات النتيجة", [
    ["المجموع الكلي", formatScore(total), true],
    ["النسبة المئوية", formatPercentage(total), true],
    ["كود حالة الطالب", formatScore(value(record, "studentCase")), true],
    ["حجب النتيجة", Number(value(record, "resultWithheld")) ? "محجوبة" : "غير محجوبة"],
    ["وصف العام", value(record, "yearDescription") || "الدور الأول 2026"],
  ]);

  elements.recordFields.replaceChildren(schoolGroup, gradesGroup, resultGroup);
  if (!elements.recordDialog.open) elements.recordDialog.showModal();
}

function resetFilters() {
  elements.cityFilter.value = "";
  elements.statusFilter.value = "";
  elements.minimumFilter.value = "";
  elements.genderFilter.value = "";
  elements.schoolFilter.value = "";
  runSearch();
}

function populateCities() {
  const choices = new Map();
  for (const city of catalog.cities) {
    const key = normalizeFilterText(city);
    const current = choices.get(key);
    if (!current || city.length < current.length) choices.set(key, city);
  }
  const fragment = document.createDocumentFragment();
  [...choices]
    .sort(([, first], [, second]) => first.localeCompare(second, "ar"))
    .forEach(([key, city]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = city;
      fragment.append(option);
    });
  elements.cityFilter.append(fragment);
}

async function initialize() {
  try {
    catalog = await fetchJson("data/catalog.json");
    recordFields = new Map(catalog.recordSchema.map((field, index) => [field, index]));
    schoolFields = new Map(catalog.schoolSchema.map((field, index) => [field, index]));
    schoolMetadata = catalog.schools.map((school) => ({
      cityKey: normalizeFilterText(schoolValue(school, "city")),
      searchText: normalizeFilterText(
        `${schoolValue(school, "name")} ${schoolValue(school, "departmentName")} ${schoolValue(school, "code")}`,
      ),
    }));

    populateCities();
    renderStats(catalog.stats);
    elements.searchInput.disabled = false;
    filterControls.forEach((control) => {
      control.disabled = false;
    });
    elements.dataStatus.classList.add("is-ready");
    elements.dataStatus.lastChild.textContent = `${formatNumber(catalog.stats.total)} سجل جاهز`;
    elements.searchHint.textContent = "اكتب 3 أحرف على الأقل أو رقم الجلوس؛ النتائج تظهر مباشرة.";
    elements.resultsMeta.textContent = "اكتب رقم الجلوس أو الاسم، أو اختر أحد الفلاتر.";
  } catch (error) {
    console.error(error);
    elements.dataStatus.classList.add("is-error");
    elements.dataStatus.lastChild.textContent = "تعذر تحميل البيانات";
    elements.resultsMeta.textContent = "تعذر تجهيز قاعدة البحث. أعد تحميل الصفحة.";
    setEmpty("البيانات غير متاحة", "تعذر تحميل فهرس النتائج من الموقع.");
  }
}

elements.searchInput.addEventListener("input", queueSearch);
elements.schoolFilter.addEventListener("input", queueSearch);
[elements.cityFilter, elements.statusFilter, elements.minimumFilter, elements.genderFilter].forEach(
  (control) => control.addEventListener("change", runSearch),
);
elements.clearSearch.addEventListener("click", () => {
  elements.searchInput.value = "";
  elements.clearSearch.hidden = true;
  elements.searchInput.focus();
  runSearch();
});
elements.resetFilters.addEventListener("click", resetFilters);
elements.previousPage.addEventListener("click", () => {
  if (paginationState) {
    renderFilterPage(paginationState.page - 1, true).catch((error) => {
      console.error(error);
      elements.resultsMeta.textContent = "تعذر تحميل الصفحة السابقة. أعد المحاولة.";
    });
  }
});
elements.nextPage.addEventListener("click", () => {
  if (paginationState) {
    renderFilterPage(paginationState.page + 1, true).catch((error) => {
      console.error(error);
      elements.resultsMeta.textContent = "تعذر تحميل الصفحة التالية. أعد المحاولة.";
    });
  }
});
elements.closeRecord.addEventListener("click", () => elements.recordDialog.close());
elements.recordDialog.addEventListener("click", (event) => {
  if (event.target === elements.recordDialog) elements.recordDialog.close();
});
elements.printRecord.addEventListener("click", () => window.print());

initialize();
