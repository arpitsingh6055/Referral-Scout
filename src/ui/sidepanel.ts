import "./styles.css";
import { appRoot, element, errorText } from "./render";
import { loadSettings } from "../storage/settings";
import { readiness } from "../shared/schemas";
const root = appRoot();
root.append(element("h1", "Cold Contact Pro"), element("p", "Set up your profile • Dry run"), element("p", "Start with your CV or enter your details manually. Campaign sending is still under development."));
const button = element("button", "Open settings");
button.addEventListener("click", () => { void chrome.runtime.openOptionsPage().catch(e => root.append(element("p", errorText(e)))); });
root.append(button);
const setup = element("button", "Set up from my CV");
setup.addEventListener("click", () => { void chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") }); });
root.append(setup);
void loadSettings().then(({ profile, campaign }) => {
  const errors = readiness(profile, campaign, false);
  root.append(element("p", errors.length ? `Profile checklist: ${errors.join("; ")}` : "Your profile is complete."));
}).catch(e => root.append(element("p", errorText(e))));
