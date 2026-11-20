# 1. Research objectives and problem scope

Four research questions govern this study, and each one carries a condition under which we abandon the idea it tests. The questions are written against two problem statements, not against the extension that already exists.

## The prior build is declared, not hidden

Referral Scout v0.45.5 was working before this exercise started. The solution therefore predates the research, which inverts the order the empathy exercise is built on. Writing the questionnaire from the extension's feature list would produce a set of disguised feature tests: we would confirm the explicit pain points the tool was designed around and learn nothing about the latent needs that sit underneath them.

The build is treated here as a documented assumption set. Three assumptions are embedded in it:

1. Candidates want to know how well they fit a posting before they apply to it.
2. The obstacle to getting a referral is effort, measured in time and repetition.
3. More outreach, better targeted and better written, improves outcomes for the candidate without making the system worse for anyone else.

Each of the research questions below attacks one of these. The falsification criteria are fixed now, before fieldwork, so a finding that contradicts the existing tool cannot be reinterpreted after the fact.

## Problem scope

In scope: candidates in India who search for and pursue roles themselves on LinkedIn, together with the people they contact for referrals.

The journey under study has seven stages: deciding which roles to target, finding openings, judging fit, finding someone to ask at the company, writing the ask, waiting after sending, and tracking what came of it.

Out of scope:

| Excluded | Reason |
| --- | --- |
| Campus placement process | The placement committee controls access, so there is no design freedom, and it is a different system from self-directed search |
| Resume writing, interview performance, salary discussion | These sit after the stages under study |
| Job boards other than LinkedIn | The referral graph is the only reason the site matters here rather than Naukri or Indeed |

The scope is bounded this tightly so that the journey map fits one page and every stage in it is observable inside a ten-minute Look-Ask-Try session.

## The two ideas, written as problem statements

Idea A, fit. A candidate facing several hundred postings cannot tell which ones they are a serious candidate for. They respond either by applying to everything and getting filtered out, or by skipping roles they would in fact have got.

Idea B, access. A referral is the highest-yield route into an interview. The work of obtaining one runs to four separate tasks: identify the right person, write a credible ask, follow up, and remember who answered. Most candidates stop after two or three companies.

Neither statement names a feature, and each rests on an assumption that an interview can break.

## Research questions

### RQ1. At what point does a candidate decide to apply, and what information is in front of them at that moment?

Attacks assumption 1. This determines whether fit assessment has any work to do.

Falsification criterion: if the majority of respondents decide on title and company without opening the full description, and report satisfaction with that approach, then Idea A is not a fit problem. It is a volume problem, and ranking by fit addresses something nobody experiences.

### RQ2. For candidates whose qualification does not predict their target function, how do they choose what to apply for, and what becomes of those applications?

Attacks assumption 1 from the side of the career switcher. This determines whether the switcher is the core user or an edge case, which in turn determines whether fit reasoning should weigh experience above degree.

Falsification criterion: if switchers report the same rate of human response as non-switchers, the degree-filter premise is wrong and the switcher narrative comes out of the problem statement.

### RQ3. At which step does a referral attempt stop: finding the person, writing the ask, sending it, or following up?

Attacks assumption 2. This determines which single step a design should take over, and it supplies the emotional curve of the journey map.

Falsification criterion: if candidates stop because the ask feels humiliating rather than because it consumes time, then compressing the process raises the discomfort instead of relieving it, and the appropriate intervention is a warmer channel or a legitimate pretext for contact.

### RQ4. What does the receiving side experience as outreach volume rises, and is that experience the same for everyone who receives it?

Attacks assumption 3. This determines whether the idea should exist in its present form.

Falsification criterion, first part: if recruiters and hiring managers already ignore most inbound messages, then additional inbound, however well written, does not help the candidate, and the problem has to be addressed on the recruiter's side.

Falsification criterion, second part: unwanted contact on LinkedIn is reported at higher rates by women than by men. If the data reproduces that pattern, a tool that raises cold-contact volume does not affect all recipients equally, and the finding belongs in the results rather than in a limitation note. This is the accommodation requirement from the empathy video applied to our own idea.

## Traceability rule

Every item in the questionnaire must name the research question it serves. An item that cannot be tied to a design decision or to a journey-map stage is deleted at Step 3 rather than carried forward.

## Open before Step 2

1. Confirm the A and B split, or state where the real division sits.
2. Confirm the prior build is being declared in class.
3. State whether Referral Scout was built for the author's own placement season. If so, the author is an extreme user inside the sampling frame and that has to be disclosed in the methodology rather than discovered during analysis.
