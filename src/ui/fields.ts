import { element } from "./render";
export type Control = HTMLInputElement | HTMLTextAreaElement;
export function field(parent: HTMLElement, id: string, label: string, value: string | number | boolean, type = "text"): Control {
  const wrapper = element("label"); wrapper.htmlFor = id; wrapper.append(element("span", label));
  const input = type === "textarea" ? element("textarea") : element("input"); input.id = id;
  if (input instanceof HTMLInputElement) { input.type = type; if (type === "checkbox") input.checked = Boolean(value); }
  input.value = String(value); input.autocomplete = "off";
  if (input instanceof HTMLTextAreaElement) input.rows = 3;
  wrapper.append(input); parent.append(wrapper); return input;
}
export const lines = (value: string): string[] => value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
export function proofLines(value: string): { id: string; text: string }[] {
  return lines(value).map(line => {
    const split = line.indexOf("|");
    if (split < 1) throw new Error("Each proof point needs ID | evidence, for example P1 | Built a tool used by 20 teams");
    return { id: line.slice(0, split).trim(), text: line.slice(split + 1).trim() };
  });
}
