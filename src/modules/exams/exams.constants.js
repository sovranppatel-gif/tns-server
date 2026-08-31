export const QUESTION_TYPES = [
  "Single Choice",
  "Multiple Choice",
  "True / False",
  "Yes / No",
];

export const QUESTION_DIFFICULTIES = ["Easy", "Medium", "Hard"];

export const QUESTION_STATUSES = ["Active", "Inactive", "Draft"];

export const PAPER_STATUSES = ["Draft", "Published", "Archived"];

export const SCHEDULE_STATUSES = ["Scheduled", "Live", "Completed", "Cancelled"];

export const ASSIGNMENT_STATUSES = [
  "Assigned",
  "Started",
  "Submitted",
  "Expired",
  "Cancelled",
];

export const ATTEMPT_STATUSES = [
  "In Progress",
  "Submitted",
  "Expired",
  "Auto Submitted",
];

export const RESULT_VISIBILITY = [
  "Immediately",
  "After Exam Ends",
  "Manual Release",
];

export const DEFAULT_EXAM_INSTRUCTIONS = [
  "Do not refresh the page unnecessarily.",
  "Submit before the timer expires.",
  "Once submitted, the exam cannot be restarted unless allowed.",
  "Each question may have different marks.",
  "Negative marking may apply.",
];

export function defaultOptionsForType(type) {
  if (type === "True / False") {
    return [
      { key: "True", text: "True" },
      { key: "False", text: "False" },
    ];
  }
  if (type === "Yes / No") {
    return [
      { key: "Yes", text: "Yes" },
      { key: "No", text: "No" },
    ];
  }
  return [
    { key: "A", text: "" },
    { key: "B", text: "" },
    { key: "C", text: "" },
    { key: "D", text: "" },
  ];
}
