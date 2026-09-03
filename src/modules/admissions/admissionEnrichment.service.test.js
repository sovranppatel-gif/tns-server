import assert from "node:assert/strict";
import test from "node:test";
import { admissionEnrichmentTestables, findMatch } from "./admissionEnrichment.service.js";

const { buildIndexes, buildPlan, normalizePhone, parseDate } = admissionEnrichmentTestables;

function admission(overrides = {}) {
  return {
    _id: "admission-1",
    admissionId: "ADM-2026-0001",
    applicant: "AMIT JAIN",
    email: "amit@example.com",
    phone: "9098015956",
    studentId: "TNS-2026-00001",
    admissionDate: null,
    city: "",
    details: {},
    ...overrides,
  };
}

test("normalizes supported Indian phone formats and rejects placeholders", () => {
  assert.equal(normalizePhone("91-9098015956").value, "9098015956");
  assert.equal(normalizePhone("+91 9098015956").value, "9098015956");
  assert.equal(normalizePhone("91-").valid, false);
});

test("normalizes valid DD/MM/YYYY dates and rejects invalid dates", () => {
  assert.equal(parseDate("05/12/1989").toISOString(), "1989-12-05T00:00:00.000Z");
  assert.equal(parseDate("31/02/2026"), null);
});

test("uses Student Code before lower-priority matching", () => {
  const indexed = buildIndexes([
    admission({ _id: "code-match", details: { excelStudentCode: "stu-1" } }),
    admission({ _id: "phone-match", details: {}, applicant: "OTHER", phone: "9098015956" }),
  ]);
  const result = findMatch({ studentCode: "stu-1", userId: "", studentId: "", admissionId: "", phone: "9098015956", nameKey: "OTHER", birthDateKey: "" }, indexed);
  assert.equal(result.method, "details.excelStudentCode");
  assert.equal(result.candidates[0]._id, "code-match");
});

test("returns all candidates for ambiguous matching and none for unmatched rows", () => {
  const indexed = buildIndexes([
    admission({ _id: "one", details: {} }),
    admission({ _id: "two", details: {} }),
  ]);
  const ambiguous = findMatch({ studentCode: "", userId: "", studentId: "", admissionId: "", phone: "9098015956", nameKey: "AMIT JAIN", birthDateKey: "" }, indexed);
  assert.equal(ambiguous.candidates.length, 2);
  const unmatched = findMatch({ studentCode: "missing", userId: "", studentId: "", admissionId: "", phone: "", nameKey: "", birthDateKey: "" }, indexed);
  assert.equal(unmatched.candidates.length, 0);
});

test("reports conflicts and preserves existing values in the update plan", () => {
  const existing = admission({ details: { gender: "Male" } });
  const result = buildPlan({
    excelRowNumber: 2,
    studentCode: "stu-1",
    userId: "user-1",
    fullName: "AMIT JAIN",
    birthDate: null,
    birthDateKey: "",
    admissionDate: null,
    phone: "9098015956",
    mobile: { value: "9098015956", valid: true, original: "9098015956" },
    email: "",
    emailRaw: "",
    gender: "Female",
    serial: 1,
    grSr: "",
    currentAddress: "",
    countryCode: "91",
    city: "Narsinghpur",
    country: "India",
    parentsCode: "par-1",
    parentsId: "par-1",
    fatherContact: { value: "", valid: false, original: "91-" },
    motherContact: { value: "", valid: false, original: "91-" },
    fatherOccupation: "",
    motherOccupation: "",
    excelClass: "DCA",
    excelBatch: "Batch A",
    raw: { birthRaw: "", admissionRaw: "" },
  }, existing, "students.xlsx", new Date("2026-09-03T00:00:00.000Z"));
  assert.equal(result.set["details.gender"], undefined);
  assert.equal(result.conflicts[0].field, "details.gender");
  assert.equal(result.set["details.importMeta.excelClass"], "DCA");
  assert.equal(result.set["courseId"], undefined);
});
