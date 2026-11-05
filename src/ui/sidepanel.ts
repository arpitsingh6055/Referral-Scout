import "./styles.css";
import { appRoot, element, errorText } from "./render";
import { loadSettings } from "../storage/settings";
import { readiness } from "../shared/schemas";
const root = appRoot();
root.append(element("h1", "Cold Contact Pro"), element("p", "Phase 1 foundation • Dry run"), element("p", "Campaign execution and the dashboard arrive in later phases. Nothing will be sent from this build."));
const button = element("button", "Open settings");
button.addEventListener("click", () => { void chrome.runtime.openOptionsPage().catch(e => root.append(element("p", errorText(e)))); });
root.append(button);
void loadSettings().then(({ profile, campaign }) => {
  const errors = readiness(profile, campaign, false);
  root.append(element("p", errors.length ? `Profile checklist: ${errors.join("; ")}` : "Your profile is complete."));
}).catch(e => root.append(element("p", errorText(e))));
