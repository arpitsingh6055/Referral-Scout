import { z } from 'zod';

const short = z.string().trim().max(500).default('');
const long = z.string().trim().max(3000).default('');
export const aiProfileDraftSchema = z.object({
  schemaVersion: z.literal(3),
  identity: z.object({ fullName: short, email: short, phone: short, city: short, state: short, country: short, profileUrl: short }).default({ fullName: '', email: '', phone: '', city: '', state: '', country: '', profileUrl: '' }),
  education: z.array(z.object({ level: short, institution: short, qualification: short, field: short, startDate: short, endDate: short, grade: short, gradeScale: short })).max(30).default([]),
  employment: z.array(z.object({ employer: short, title: short, location: short, startDate: short, endDate: short, current: z.boolean().default(false), responsibilities: z.array(z.string().max(500)).max(30).default([]), achievements: z.array(z.string().max(500)).max(30).default([]), technologies: z.array(z.string().max(100)).max(60).default([]) })).max(40).default([]),
  projects: z.array(z.object({ name: short, summary: long, role: short, skills: z.array(z.string().max(100)).max(60).default([]), outcomes: z.array(z.string().max(500)).max(30).default([]), links: z.array(z.string().max(500)).max(20).default([]) })).max(50).default([]),
  skills: z.array(z.string().trim().min(1).max(100)).max(150).default([]),
  narrative: z.object({ strengths: long, careerGoal: long }).default({ strengths: '', careerGoal: '' }),
  conflicts: z.array(z.object({ field: short, cvValue: long, linkedinValue: long, resolution: z.string().max(1000).default('CV preferred') })).max(50).default([]),
  missingInformation: z.array(z.string().max(500)).max(50).default([]),
}).passthrough();
export type AiProfileDraft = z.infer<typeof aiProfileDraftSchema>;
