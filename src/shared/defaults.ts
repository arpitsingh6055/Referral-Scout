import type { CampaignSettings, Profile } from "./schemas";
export const defaultProfile: Profile = {
  name: "", gmail: "", accountIndex: 0, education: "", target: "Product Management internship; APM, Product Analyst, Product Ops, Business/Growth with product exposure",
  proofPoints: [], resumeUrl: "", availability: "", tone: "concise, specific, respectful, no flattery",
  writingStyle: "Use a warm, direct note: a specific company observation, relevant prior work, the internship interest, and one clear ask. Avoid generic praise."
};
export const defaultCampaign: CampaignSettings = {
  cities: ["Bengaluru", "Delhi NCR", "Hyderabad", "Pune", "Mumbai"], keywords: ["AI", "ML", "GenAI", "SaaS", "fintech", "developer tools"],
  minEmployees: 11, maxEmployees: 500, targetSends: 150, windowStart: "10:00", windowEnd: "17:30", timezone: "Asia/Kolkata", holidays: [],
  mode: "dry-run", allowPatternInferred: false, patternDailyCap: 3, dailyHardCap: 25, searchPageBudget: 10, profilePageBudget: 40,
  optOutPeople: [], optOutDomains: [], alreadyContacted: [], mockMode: false, firstTokenSeconds: 20, totalSeconds: 90, webSeconds: 150
};
