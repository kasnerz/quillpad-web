// Checkbox notes are stored as markdown task lines in the note's content —
// exactly the format Quillpad's taskListToMd() writes and mdToTaskList() reads.
// That is what lets a checkbox note created here show up as a real task list on
// the phone, even though the Nextcloud Notes API has no field for list-ness.

const TASK_LINE = /^\s*[-+*] *\[([ xX])\] ?(.*)$/;

export function isChecklist(content) {
  let found = false;
  for (const line of (content || "").split("\n")) {
    if (!line.trim()) continue;
    if (!TASK_LINE.test(line)) return false;
    found = true;
  }
  return found;
}

export function parseChecklist(content) {
  const items = [];
  for (const line of (content || "").split("\n")) {
    const match = line.match(TASK_LINE);
    if (match) {
      items.push({ done: match[1].toLowerCase() === "x", text: match[2] });
    } else if (line.trim() && items.length) {
      // Mirrors mdToTaskList: a stray line belongs to the task above it.
      items[items.length - 1].text += " " + line.trim();
    }
  }
  return items;
}

export function serializeChecklist(items) {
  return items
    .map((item) => `- [${item.done ? "x" : " "}] ${item.text.trim()}`)
    .join("\n");
}

// Splitting plain text into tasks, for the "convert to checkboxes" action.
export function textToChecklist(content) {
  return (content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ done: false, text }));
}

export const checklistToText = (items) => items.map((item) => item.text).join("\n");
